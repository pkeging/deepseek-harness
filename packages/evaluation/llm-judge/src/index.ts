/**
 * LLM-as-judge evaluation tool for the DeepSeek Harness.
 *
 * Registers one `judge` tool that accepts an objective, evidence, and rubric,
 * dispatches a single model call, and returns a structured verdict containing
 * a numeric score, pass/fail decision, and plain-text reasoning. The judge
 * prompt instructs the model to return strictly valid JSON so the harness can
 * parse the result without ambiguity.
 *
 * This plugin closes the evaluator gap left by `tool-ralph` (which reports
 * completion via worker self-declaration) by offering an external LLM verdict
 * that can be used in post-hoc analysis or as a judgment step in a custom
 * workflow.
 *
 * @module @deepseek-ai/dsh-llm-judge
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage, BlockAssembler, type FinishReason } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { deadline, MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

export const name = 'llm-judge'
export const inject = ['llm', 'tools']

/**
 * Rubric format: newline-delimited criteria lines. Each line is evaluated
 * independently; the model uses the full list to form its verdict.
 */
export type Rubric = string

/** Plugin configuration. */
export interface Config {
  /**
   * Per-judge-call timeout in milliseconds (default 30 000). The judge makes
   * one synchronous model call; the deadline wraps the entire call.
   */
  timeoutMs?: number
  /**
   * Maximum output tokens for the judge response (default 1024). The model
   * returns a short JSON verdict; 1024 is ample for score, pass/fail, and
   * reasoning.
   */
  maxOutputTokens?: number
  /**
   * Optional explicit provider/model override. When absent the tool falls
   * back to the `deepseek` provider and `deepseek-chat` model.
   */
  provider?: string
  /**
   * Optional explicit model id paired with `provider`.
   */
  model?: string
}

/** Raw schemastery config schema. */
export const Config = z.object({
  timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(30_000),
  maxOutputTokens: z.number().step(1).min(1).default(1024),
  provider: z.string(),
  model: z.string(),
})

/** Verdict returned by the judge tool. */
export interface EvaluationVerdict {
  /** Numeric score from 1 (poor) to 10 (excellent). */
  score: number
  /** Whether the evidence satisfies the rubric. */
  pass: boolean
  /** Human-readable justification for the score and pass/fail decision. */
  reasoning: string
}

/** Resolved config with all fields populated. */
interface ResolvedConfig {
  readonly timeoutMs: number
  readonly maxOutputTokens: number
  readonly provider: string
  readonly model: string
}

/** Validate that a candidate is a bounded positive integer. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`llm-judge: ${name} must be a positive integer, got ${value}`)
  }
}

/** Resolve and validate config; throws on misconfiguration. */
function resolveConfig(config: Config): ResolvedConfig {
  const timeoutMs = config.timeoutMs ?? 30_000
  const maxOutputTokens = config.maxOutputTokens ?? 1024
  const provider = config.provider ?? 'deepseek'
  const model = config.model ?? 'deepseek-chat'
  assertPositiveInteger('timeoutMs', timeoutMs)
  assertPositiveInteger('maxOutputTokens', maxOutputTokens)
  if (provider.length === 0 || model.length === 0) {
    throw new Error('llm-judge: provider and model must be non-empty strings')
  }
  return { timeoutMs, maxOutputTokens, provider, model }
}

/** Translate terminal finish reasons into an auxiliary-call failure. */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens':
      return new Error('llm-judge: output reached maxOutputTokens')
    case 'tool-calls':
      return new Error('llm-judge: judge model unexpectedly requested a tool')
    default:
      return new Error(`llm-judge: unsupported finish reason "${String((finish as { kind?: unknown }).kind)}"`)
  }
}

/** Extract the `objective`, `evidence`, and `rubric` args from the tool call. */
function parseArgs(raw: unknown): { objective: string; evidence: string; rubric: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('llm-judge: args must be an object')
  }
  const obj = raw as Record<string, unknown>
  const objective = obj['objective']
  const evidence = obj['evidence']
  const rubric = obj['rubric']
  if (typeof objective !== 'string' || objective.length === 0) {
    throw new Error('llm-judge: objective must be a non-empty string')
  }
  if (typeof evidence !== 'string') {
    throw new Error('llm-judge: evidence must be a string')
  }
  if (typeof rubric !== 'string' || rubric.length === 0) {
    throw new Error('llm-judge: rubric must be a non-empty string')
  }
  return { objective, evidence, rubric }
}

/**
 * Frame the judge prompt. The model is instructed to return valid JSON only,
 * never markdown fences or explanatory prose.
 */
function judgePrompt({ objective, evidence, rubric }: {
  objective: string
  evidence: string
  rubric: string
}): string {
  return [
    'You are an objective evaluator. Assess whether the evidence satisfies the rubric relative to the objective.',
    '',
    'Objective:',
    objective,
    '',
    'Rubric:',
    rubric,
    '',
    'Evidence:',
    evidence.length > 4000 ? evidence.slice(0, 4000) + '… [truncated]' : evidence,
    '',
    'Return ONLY a JSON object with exactly these three keys — no markdown, no explanation, no trailing text:',
    '{ "score": <integer 1-10>, "pass": <boolean>, "reasoning": "<brief justification>" }',
  ].join('\n')
}

/**
 * Extract JSON from model text. Handles bare JSON, markdown-fenced JSON
 * (```json … ``` or ``` … ```), and text that happens to contain JSON.
 * Returns null when no JSON object can be extracted.
 */
function extractJson(text: string): string | null {
  // Trim leading/trailing whitespace
  const trimmed = text.trim()
  // Try the whole text first (fast path for clean JSON responses)
  try {
    JSON.parse(trimmed)
    return trimmed
  } catch { /* fall through */ }
  // Strip markdown fences if present
  const fenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  try {
    JSON.parse(fenced)
    return fenced
  } catch { /* fall through */ }
  // Last resort: find the first `{` … matching `}`
  const open = trimmed.indexOf('{')
  if (open === -1) return null
  let depth = 0
  for (let i = open; i < trimmed.length; i++) {
    if (trimmed[i] === '{') depth++
    else if (trimmed[i] === '}') {
      depth--
      if (depth === 0) {
        const candidate = trimmed.slice(open, i + 1)
        try {
          JSON.parse(candidate)
          return candidate
        } catch { /* fall through */ }
      }
    }
  }
  return null
}

/**
 * Validate one verdict object against the schema contract.
 * Returns the parsed verdict or throws.
 */
function validateVerdict(raw: unknown): EvaluationVerdict {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('llm-judge: verdict is not an object')
  }
  const v = raw as Record<string, unknown>
  const score = v['score']
  const pass = v['pass']
  const reasoning = v['reasoning']
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 10) {
    throw new Error(`llm-judge: score must be an integer 1-10, got ${String(score)}`)
  }
  if (typeof pass !== 'boolean') {
    throw new Error('llm-judge: pass must be a boolean')
  }
  if (typeof reasoning !== 'string' || reasoning.length === 0) {
    throw new Error('llm-judge: reasoning must be a non-empty string')
  }
  return { score, pass, reasoning }
}

/**
 * Apply the judge tool to the given context.
 * @param ctx - Cordis context exposing `llm` and `tools` services.
 * @param config - resolved plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'judge',
    description:
      'Evaluate whether evidence satisfies a rubric relative to an objective. '
      + 'Returns a structured verdict with score (1-10), pass/fail, and reasoning. '
      + 'Use after a task completes to produce an independent quality assessment.',
    parameters: {
      objective: {
        type: 'string',
        required: true,
        description: 'The task or goal being evaluated.',
      },
      evidence: {
        type: 'string',
        required: true,
        description: 'The agent\'s output, transcript, or artifact to evaluate.',
      },
      rubric: {
        type: 'string',
        required: true,
        description: 'Newline-delimited criteria the evidence is measured against.',
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(rawArgs): Promise<JsonValue> {
      const { objective, evidence, rubric } = parseArgs(rawArgs)
      const prompt = judgePrompt({ objective, evidence, rubric })
      const messages: Message[] = [createUserMessage({
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'user' },
      })]
      const system = 'You are an objective evaluator. Return only valid JSON.'
      using callDeadline = deadline(undefined, resolved.timeoutMs, 'LLM_JUDGE_TIMEOUT')
      const assembler = new BlockAssembler()
      for await (const chunk of ctx.llm.stream({
        provider: resolved.provider,
        model: resolved.model,
        messages,
        system,
        maxTokens: resolved.maxOutputTokens,
        signal: callDeadline.signal,
      })) {
        callDeadline.signal.throwIfAborted()
        assembler.push(chunk)
      }
      callDeadline.signal.throwIfAborted()
      const terminalError = finishError(assembler.finish)
      if (terminalError !== undefined) throw terminalError
      const blocks = assembler.blocks()
      if (blocks.some(block => block.type === 'tool-call')) {
        throw new Error('llm-judge: judge model unexpectedly requested a tool call')
      }
      const text = blocks
        .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
        .map(block => block.text)
        .join('')
      const json = extractJson(text)
      if (json === null) {
        throw new Error(
          `llm-judge: model returned non-JSON text (${text.length} chars); `
          + 'expected a JSON object with score, pass, and reasoning',
        )
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(json)
      } catch {
        throw new Error(`llm-judge: model returned invalid JSON: ${json.slice(0, 200)}`)
      }
      return validateVerdict(parsed) as unknown as JsonValue
    },
    presentCall(args: { objective: string; evidence: string; rubric: string }): ToolCallView {
      return { card: 'generic', title: 'judge', rawInput: args.objective }
    },
    presentResult(_args: unknown, value: unknown): ToolResultView {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return { card: 'generic', title: 'judge' }
      }
      const v = value as Record<string, unknown>
      const score = v['score']
      const pass = v['pass']
      const reasoning = v['reasoning']
      if (typeof score === 'number' && typeof pass === 'boolean' && typeof reasoning === 'string') {
        return {
          card: 'generic',
          title: 'judge',
          content: [{ type: 'text', text: `Score: ${score}/10 · ${pass ? 'PASS' : 'FAIL'} · ${reasoning}` }],
        }
      }
      return { card: 'generic', title: 'judge' }
    },
  }))
}
