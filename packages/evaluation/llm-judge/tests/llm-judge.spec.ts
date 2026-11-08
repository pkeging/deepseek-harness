/**
 * @vitest-environment node
 *
 * Behavior suite for the LLM-as-judge evaluation tool: config validation,
 * JSON extraction (bare, fenced, fragmented), verdict validation, arg errors,
 * and error-path coverage — all driven through direct tool execution against
 * a scripted mock adapter (no agent loop, no network).
 *
 * @module @deepseek-ai/dsh-llm-judge/tests
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId as CallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as LlmJudge from '../src/index.ts'
import type { Config, EvaluationVerdict } from '../src/index.ts'

const testToolSignal = new AbortController().signal

/** One judge response carrying the given verdict as bare JSON. */
function judgeScript(verdict: EvaluationVerdict): StreamChunk[] {
  return textResponse(JSON.stringify(verdict))
}

/** One judge response carrying the given verdict inside markdown fences. */
function fencedJudgeScript(verdict: EvaluationVerdict): StreamChunk[] {
  return textResponse('```json\n' + JSON.stringify(verdict, null, 2) + '\n```')
}

/** Extract the value from a successful tool result, or throw if isError. */
function verdictFrom(result: ToolExecutionResult): EvaluationVerdict {
  if (result.isError) throw new Error(`judge returned error: ${(result.content[0] as { text: string }).text}`)
  return result.value as unknown as EvaluationVerdict
}

/** Mount the real tool registry + LLM runtime + judge plugin; return an executor helper. */
async function mount(
  script: StreamChunk[],
  config: Config = {},
): Promise<{
  ctx: Context
  adapter: MockAdapter
  call: (args: { objective: string; evidence: string; rubric: string }) => Promise<ToolExecutionResult>
}> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(LlmRuntime)
  const resolvedConfig: Config = Object.assign({ provider: 'mock', model: 'mock' }, config)
  await ctx.plugin(LlmJudge, resolvedConfig)
  // Wrap single-entry script so MockAdapter treats it as one response entry
  const adapter = new MockAdapter([script])
  ctx.llm.registerAdapter(['mock'], adapter)
  const counter = { n: 0 }
  const call = (args: { objective: string; evidence: string; rubric: string }) =>
    executeToolFixture(ctx, {
      signal: testToolSignal,
      callId: CallId(`jc-${++counter.n}`),
      name: 'judge',
      arguments: args,
    })
  return { ctx, adapter, call }
}

describe('config validation', () => {
  it('rejects a zero or negative timeoutMs', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LlmRuntime)
    await expect(ctx.plugin(LlmJudge, { timeoutMs: 0 })).rejects.toThrow(/timeoutMs/)
    await expect(ctx.plugin(LlmJudge, { timeoutMs: -1 })).rejects.toThrow(/timeoutMs/)
  })

  it('rejects a zero or negative maxOutputTokens', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LlmRuntime)
    await expect(ctx.plugin(LlmJudge, { maxOutputTokens: 0 })).rejects.toThrow(/maxOutputTokens/)
  })

  it('rejects an empty provider or model string', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LlmRuntime)
    await expect(ctx.plugin(LlmJudge, { provider: '', model: 'x' })).rejects.toThrow(/non-empty strings/)
    await expect(ctx.plugin(LlmJudge, { provider: 'x', model: '' })).rejects.toThrow(/non-empty strings/)
  })

  it('applies defaults when config is empty', async () => {
    const { ctx } = await mount(judgeScript({ score: 5, pass: true, reasoning: 'ok' }))
    expect(ctx).toBeDefined()
  })
})

describe('basic pass/fail verdict', () => {
  it('returns a pass verdict when evidence satisfies the rubric', async () => {
    const { call } = await mount(judgeScript({ score: 9, pass: true, reasoning: 'Meets all criteria' }))
    const result = await call({
      objective: 'Write a poem about nature',
      evidence: 'Roses are red, violets are blue',
      rubric: 'Must mention a flower',
    })
    const v = verdictFrom(result)
    expect(v.score).toBe(9)
    expect(v.pass).toBe(true)
    expect(v.reasoning).toBe('Meets all criteria')
  })

  it('returns a fail verdict when evidence does not satisfy the rubric', async () => {
    const { call } = await mount(judgeScript({ score: 2, pass: false, reasoning: 'Missing key criterion' }))
    const result = await call({
      objective: 'Write a poem about nature',
      evidence: 'The sky is blue',
      rubric: 'Must mention a flower',
    })
    const v = verdictFrom(result)
    expect(v.score).toBe(2)
    expect(v.pass).toBe(false)
  })
})

describe('JSON extraction', () => {
  it('parses bare JSON returned by the model', async () => {
    const { call } = await mount(judgeScript({ score: 7, pass: true, reasoning: 'good work' }))
    const result = await call({ objective: 'x', evidence: 'y', rubric: 'z' })
    const v = verdictFrom(result)
    expect(v.score).toBe(7)
    expect(v.pass).toBe(true)
  })

  it('parses markdown-fenced JSON', async () => {
    const { call } = await mount(fencedJudgeScript({ score: 5, pass: false, reasoning: 'partial' }))
    const result = await call({ objective: 'x', evidence: 'y', rubric: 'z' })
    const v = verdictFrom(result)
    expect(v.score).toBe(5)
    expect(v.pass).toBe(false)
  })

  it('returns an error when the model returns non-JSON text', async () => {
    const { call } = await mount(textResponse('I cannot evaluate this. The evidence is unclear.'))
    const result = await call({ objective: 'x', evidence: 'y', rubric: 'z' })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.type).toBe('text')
    const text = (result.content[0] as { type: 'text'; text: string }).text
    expect(text).toContain('non-JSON text')
  })

  it('returns an error when the model returns malformed JSON', async () => {
    const { call } = await mount(textResponse('{score: broken}'))
    const result = await call({ objective: 'x', evidence: 'y', rubric: 'z' })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.type).toBe('text')
    const text = (result.content[0] as { type: 'text'; text: string }).text
    expect(text).toContain('non-JSON text')
  })
})

describe('verdict validation', () => {
  it('returns an error when score is outside 1-10 (too low)', async () => {
    const { call } = await mount(textResponse(JSON.stringify({ score: 0, pass: true, reasoning: 'low' })))
    const result = await call({ objective: 'x', evidence: 'y', rubric: 'z' })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.type).toBe('text')
    const text = (result.content[0] as { type: 'text'; text: string }).text
    expect(text).toContain('score must be an integer 1-10')
  })

  it('returns an error when score is outside 1-10 (too high)', async () => {
    const { call } = await mount(textResponse(JSON.stringify({ score: 11, pass: true, reasoning: 'high' })))
    const result = await call({ objective: 'x', evidence: 'y', rubric: 'z' })
    expect(result.isError).toBe(true)
    const text = (result.content[0] as { type: 'text'; text: string }).text
    expect(text).toContain('score must be an integer 1-10')
  })

  it('returns an error when pass is not a boolean', async () => {
    const { call } = await mount(textResponse(JSON.stringify({ score: 5, pass: 'yes', reasoning: 'ok' })))
    const result = await call({ objective: 'x', evidence: 'y', rubric: 'z' })
    expect(result.isError).toBe(true)
    const text = (result.content[0] as { type: 'text'; text: string }).text
    expect(text).toContain('pass must be a boolean')
  })

  it('returns an error when reasoning is empty', async () => {
    const { call } = await mount(textResponse(JSON.stringify({ score: 5, pass: true, reasoning: '' })))
    const result = await call({ objective: 'x', evidence: 'y', rubric: 'z' })
    expect(result.isError).toBe(true)
    const text = (result.content[0] as { type: 'text'; text: string }).text
    expect(text).toContain('reasoning must be a non-empty string')
  })
})

describe('arg validation', () => {
  it('returns an error when objective is empty', async () => {
    const { call } = await mount(judgeScript({ score: 5, pass: true, reasoning: 'ok' }))
    const result = await call({ objective: '', evidence: 'x', rubric: 'y' })
    expect(result.isError).toBe(true)
    const text = (result.content[0] as { type: 'text'; text: string }).text
    expect(text).toContain('objective must be a non-empty string')
  })

  it('returns an error when evidence is not a string', async () => {
    const { call } = await mount(judgeScript({ score: 5, pass: true, reasoning: 'ok' }))
    const result = await call({ objective: 'x', evidence: null as unknown as string, rubric: 'y' })
    // Args validation happens before the tool runs; the harness catches schema violations
    expect(result.isError).toBe(true)
  })

  it('returns an error when rubric is empty', async () => {
    const { call } = await mount(judgeScript({ score: 5, pass: true, reasoning: 'ok' }))
    const result = await call({ objective: 'x', evidence: 'y', rubric: '' })
    expect(result.isError).toBe(true)
    const text = (result.content[0] as { type: 'text'; text: string }).text
    expect(text).toContain('rubric must be a non-empty string')
  })

  it('returns an error when args is not an object', async () => {
    const { ctx } = await mount(judgeScript({ score: 5, pass: true, reasoning: 'ok' }))
    const result = await executeToolFixture(ctx, {
      signal: testToolSignal,
      callId: CallId('bad-args'),
      name: 'judge',
      arguments: 'not-an-object',
    })
    expect(result.isError).toBe(true)
  })
})

describe('model integration', () => {
  it('sends the correct provider/model and system prompt to the LLM', async () => {
    const { adapter, call } = await mount(
      judgeScript({ score: 8, pass: true, reasoning: 'nice' }),
      { provider: 'mock', model: 'judge-v1' },
    )
    const result = await call({ objective: 'solve', evidence: 'code', rubric: 'correct' })
    const v = verdictFrom(result)
    expect(v.score).toBe(8)
    expect(adapter.requests).toHaveLength(1)
    const req = adapter.requests[0]!
    expect(req.provider).toBe('mock')
    expect(req.model).toBe('judge-v1')
    expect(req.system).toBe('You are an objective evaluator. Return only valid JSON.')
    expect(req.messages).toHaveLength(1)
    const msg0 = req.messages[0]!
    expect(msg0.content[0]!.type).toBe('text')
    const promptText = (msg0.content[0] as { type: 'text'; text: string }).text
    expect(promptText).toContain('Objective:')
    expect(promptText).toContain('Rubric:')
    expect(promptText).toContain('Evidence:')
    expect(promptText).toContain('solve')
    expect(promptText).toContain('correct')
  })

  it('truncates very long evidence in the prompt', async () => {
    const { adapter, call } = await mount(judgeScript({ score: 5, pass: true, reasoning: 'ok' }))
    const longEvidence = 'x'.repeat(5000)
    await call({ objective: 'obj', evidence: longEvidence, rubric: 'rub' })
    const promptText = (adapter.requests[0]!.messages[0]!.content[0] as { text: string }).text
    expect(promptText).toContain('… [truncated]')
    expect(promptText).not.toContain(longEvidence)
  })
})
