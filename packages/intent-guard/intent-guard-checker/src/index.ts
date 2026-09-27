/**
 * Intent-guard checker provider: L1 behavior pattern detector (tool repetition,
 * consecutive failure chain) and L2 semantic drift detector (embedding cosine
 * similarity against goal declaration).
 *
 * @module @deepseek-ai/dsh-intent-guard-checker
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A message injected by a guard plugin rather than produced by the user or the model. */
    plugin: { kind: 'plugin'; plugin: string }
  }
}
import type { PostToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
// Re-import types from source to avoid cross-package resolution during standalone check.
import type { EmbeddingRequest } from '@deepseek-ai/dsh-embedding'

export const name = 'intent-guard-checker'

/** Services this plugin injects. */
export const inject = ['intentGuard', 'embedding']

export interface Config {
  /** L1: consecutive identical tool calls to trigger a repetition signal (default 3). */
  repetitionThreshold?: number
  /** L1: consecutive tool failures to trigger a failure-chain signal (default 5). */
  failureThreshold?: number
  /** L2: cosine similarity threshold below which divergence is flagged (default 0.65). */
  semanticDivergenceThreshold?: number
  /** L2: minimum steps between embedding calls (default 5). */
  embedSamplingInterval?: number
  /** Tool-name wildcard patterns to exclude from L1 detection. */
  excludeTools?: string[]
}

export const Config: z<Config> = z.object({
  repetitionThreshold: z.number().step(1).min(2).default(3),
  failureThreshold: z.number().step(1).min(2).default(5),
  semanticDivergenceThreshold: z.number().min(0).max(1).default(0.65),
  embedSamplingInterval: z.number().step(1).min(1).default(5),
  excludeTools: z.array(z.string()).default([]),
})

const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'intent-guard-checker' }

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortJsonValue(record[key])
    }
    return sorted
  }
  return value
}

function canonicalize(args: unknown): string {
  return JSON.stringify(sortJsonValue(args))
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`)
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`)
}

interface AgentState {
  lastCallKey: string
  lastCallCount: number
  consecutiveFailures: number
  lastEmbedStep: number
  goalText?: string
  goalVector?: Float32Array
}

/**
 * Install the intent-guard checker provider.
 *
 * L1 listens on `tools/post-execute` to track repetition and failure chains.
 * L2 listens on `agent/turn-stopping` to run embedding-based semantic drift
 * detection every N steps and inject context when drift exceeds threshold.
 */
export function apply(ctx: Context, config: Config): void {
  const divergenceThreshold = config.semanticDivergenceThreshold as number
  const embedInterval = config.embedSamplingInterval as number
  const excludePatterns = (config.excludeTools as string[]).map(wildcardToRegExp)

  const states = new WeakMap<Agent, AgentState>()

  function tracked(toolName: string): boolean {
    return !excludePatterns.some(p => p.test(toolName))
  }

  function getOrInit(agent: Agent): AgentState {
    let s = states.get(agent)
    if (s === undefined) {
      s = { lastCallKey: '', lastCallCount: 0, consecutiveFailures: 0, lastEmbedStep: 0 }
      states.set(agent, s)
    }
    return s
  }

  // L1: observe tool executions for repetition and failure chains
  ctx.on('tools/post-execute', async (exec: ToolExecution, _result: unknown, next: () => Promise<PostToolDecision>): Promise<PostToolDecision> => {
    if (!exec.agent || !tracked(exec.name)) return next()
    const s = getOrInit(exec.agent)
    const isFailure = (typeof _result === 'object' && _result !== null && 'isError' in _result) ? (_result as { isError?: boolean }).isError === true : false

    if (isFailure) {
      s.consecutiveFailures += 1
    } else {
      s.consecutiveFailures = 0
    }

    const key = JSON.stringify([exec.name, canonicalize(exec.arguments)])
    if (key === s.lastCallKey) {
      s.lastCallCount += 1
    } else {
      s.lastCallKey = key
      s.lastCallCount = 1
    }

    return next()
  })

  // L2: semantic drift detection at turn boundary
  ctx.on('agent/turn-stopping', async (payload: { agent: Agent; turn: number; signal: AbortSignal }) => {
    const agent = payload.agent
    const s = getOrInit(agent)

    // Sample embeddings every N steps
    const step = s.lastEmbedStep + 1
    if (step % embedInterval !== 0) {
      s.lastEmbedStep = step
      return
    }
    s.lastEmbedStep = step

    // Get goal objective via duck-typed ctx.intentGuard
    const intentGuard = ctx.get('intentGuard') as { getGoalObjective(a: Agent): string | undefined } | undefined
    const goalText = intentGuard?.getGoalObjective(agent)
    if (goalText === undefined) return

    if (s.goalText !== goalText) {
      s.goalText = goalText
      delete s.goalVector
    }

    const stepSummary = buildStepSummary(s)
    if (stepSummary === undefined) return

    let goalVec = s.goalVector
    let stepVec: Float32Array | undefined

    try {
      const embSvc = ctx.get('embedding') as { embed(req: EmbeddingRequest): Promise<{ vectors: Float32Array[] }> } | undefined
      if (embSvc === undefined) return

      if (goalVec === undefined) {
        const goalResult = await embSvc.embed({ texts: [goalText] })
        goalVec = goalResult.vectors[0] ?? new Float32Array(0)
        s.goalVector = goalVec
      }
      const stepResult = await embSvc.embed({ texts: [stepSummary] })
      stepVec = stepResult.vectors[0]
    } catch {
      return
    }

    if (goalVec.length === 0 || stepVec === undefined || stepVec.length === 0) return

    const similarity = cosineSimilarity(goalVec, stepVec)
    if (similarity >= divergenceThreshold) return

    const driftMsg = createUserMessage({
      content: [{
        type: 'text',
        text: '[INTENT DRIFT DETECTED] Your recent actions have diverged semantically from your declared goal. '
          + `Cosine similarity: ${similarity.toFixed(3)} (threshold: ${divergenceThreshold}). `
          + `Current goal: "${goalText}". Consider whether your current approach still serves the original objective.`,
      }],
      source: { ...PLUGIN_SOURCE, form: 'notice', summary: 'intent-drift' },
    })

    // Inject drift notice into the next step via agent.inject
    agent.inject(driftMsg)
    return
  })

  // Reset on user interjection
  ctx.on('agent/pre-step', async ({ agent, messages }: { agent: Agent; messages: UserMessage[]; turn: number; signal: AbortSignal }, next: () => Promise<PreStepDecision>): Promise<PreStepDecision> => {
    if (messages.some(m => m.source.kind === 'user')) {
      const s = states.get(agent)
      if (s) {
        s.lastCallKey = ''
        s.lastCallCount = 0
        s.consecutiveFailures = 0
      }
    }
    return next()
  })
}

function buildStepSummary(state: AgentState): string | undefined {
  const parts: string[] = []
  if (state.lastCallCount > 1) {
    const toolName = state.lastCallKey.split(',')[0]?.replace(/"/g, '') ?? '?'
    parts.push(`repeated ${toolName} ${state.lastCallCount} times`)
  }
  if (state.consecutiveFailures > 0) {
    parts.push(`${state.consecutiveFailures} consecutive failures`)
  }
  return parts.length > 0 ? parts.join('; ') : undefined
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    // ArrayAccess on typed arrays is typed as T | undefined in strict TS,
    // but iterating within bounds is safe at runtime.
    const av: number = a[i] as number
    const bv: number = b[i] as number
    dot += av * bv
    normA += av * av
    normB += bv * bv
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
