/**
 * @vitest-environment node
 *
 * Live-daemon e2e for the local Ollama provider.
 *
 * The daemon stands in for a credential: `DSH_OLLAMA_E2E_MODEL` names an
 * already-installed model, and the suite skips without it. Wire mapping is the
 * scripted suite's business; this one proves that a real daemon answers through
 * the runtime, that a real reply streams in as deltas, and that model listing
 * reports what the daemon actually serves.
 *
 * @module @deepseek-ai/dsh-llm-ollama/tests/e2e
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { BlockAssembler, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import * as Ollama from '../src/index.ts'

const BASE_URL = process.env.DSH_OLLAMA_BASE_URL ?? Ollama.DEFAULT_OLLAMA_BASE_URL

/** The gated model name; every case runs only when the environment names one. */
function modelName(): string {
  const model = process.env.DSH_OLLAMA_E2E_MODEL
  if (model === undefined || model.length === 0) throw new Error('DSH_OLLAMA_E2E_MODEL is not set')
  return model
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** Mount the runtime and the plugin against the configured daemon. */
async function harness(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(Ollama, { baseURL: BASE_URL, model: modelName(), timeoutMs: 120_000 })
  return ctx
}

describe.skipIf(process.env.DSH_OLLAMA_E2E_MODEL === undefined)('ollama provider e2e (live daemon)', () => {
  it('lists the daemon models through the route', async () => {
    const ctx = await harness()

    const models = await ctx.llm.listModels(Ollama.OLLAMA_PROVIDER)

    expect(models.length).toBeGreaterThan(0)
    expect(models.map(model => model.id)).toContain(modelName())
    expect(models.every(model => model.provider === Ollama.OLLAMA_PROVIDER)).toBe(true)
    expect(models.every(model => model.inputModalities?.includes('text') === true)).toBe(true)
  })

  it('streams a real reply into one assembled text block', async () => {
    const ctx = await harness()
    const prepared = await ctx.llm.prepareCall({
      provider: Ollama.OLLAMA_PROVIDER,
      model: modelName(),
      maxTokens: 64,
      reasoningEffort: ReasoningEffortId('off'),
    })
    const assembler = new BlockAssembler()
    let deltas = 0

    for await (const chunk of prepared.stream({
      ...prepared.config,
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'Reply with exactly one word: pong' }],
        source: { kind: 'user' },
      })],
    })) {
      if (chunk.type === 'text-delta') deltas += 1
      assembler.push(chunk)
    }

    const text = assembler.blocks()
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
    expect(assembler.finish.kind).toBe('stop')
    expect(deltas).toBeGreaterThan(0)
    expect(text.toLowerCase()).toContain('pong')
    expect(assembler.usage?.inputTokens).toBeGreaterThan(0)
  })

  it('surfaces a thinking model reply in the harness vocabulary', async () => {
    const ctx = await harness()
    const prepared = await ctx.llm.prepareCall({ provider: Ollama.OLLAMA_PROVIDER, model: modelName(), maxTokens: 256 })
    const assembler = new BlockAssembler()
    let reasoning = 0

    for await (const chunk of prepared.stream({
      ...prepared.config,
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'Name the capital of France in one word.' }],
        source: { kind: 'user' },
      })],
    })) {
      if (chunk.type === 'reasoning-delta') reasoning += chunk.text.length
      assembler.push(chunk)
    }

    // A daemon default may reason, answer, or hit the cap on either; the
    // package's own contract is that whatever it did arrives as harness blocks
    // with the daemon's usage attached.
    expect(assembler.blocks().length).toBeGreaterThan(0)
    expect(reasoning + assembler.blocks().filter(block => block.type === 'text').length).toBeGreaterThan(0)
    expect(assembler.usage?.outputTokens).toBeGreaterThan(0)
    expect(['stop', 'max-tokens']).toContain(assembler.finish.kind)
  })
})
