/**
 * @vitest-environment node
 *
 * Behavior suite for the local Ollama provider.
 *
 * Each case mounts the real `llm` service with the plugin and drives a real
 * request through the runtime, so what is asserted is the adapter's wire
 * behavior against a scripted daemon rather than its internals.
 *
 * @module @deepseek-ai/dsh-llm-ollama/tests
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ReasoningEffortId as EffortId, StreamChunk } from '@deepseek-ai/dsh-llm'
import * as Ollama from '../src/index.ts'
import { closeDaemons, daemon, textLines, thinkingLines, toolCallLine } from './daemon.ts'

afterEach(async () => {
  await closeDaemons()
})

const MODEL = 'test-model'

/** One plain user turn, as the loop would assemble it. */
function userTurn(text: string): ReturnType<typeof createUserMessage> {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

/** Mount the runtime and the plugin against one daemon. */
async function harness(baseURL: string, overrides: Partial<Ollama.OllamaConfig> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(Ollama, { ...overrides, baseURL, model: MODEL })
  return ctx
}

/** Drive one request through the runtime and collect its chunks. */
async function run(ctx: Context, text = 'hi', reasoningEffort?: EffortId): Promise<StreamChunk[]> {
  const prepared = await ctx.llm.prepareCall({
    provider: Ollama.OLLAMA_PROVIDER,
    model: MODEL,
    ...reasoningEffort === undefined ? {} : { reasoningEffort },
  })
  const chunks: StreamChunk[] = []
  for await (const chunk of prepared.stream({ ...prepared.config, messages: [userTurn(text)] })) {
    chunks.push(chunk)
  }
  return chunks
}

/** The terminal outcome of one request, which is how a consumer observes a provider failure. */
async function finishOf(ctx: Context, text = 'hi'): Promise<StreamChunk | undefined> {
  return (await run(ctx, text)).at(-1)
}

describe('ollama provider', () => {
  it('streams a text reply into the harness chunk vocabulary', async () => {
    const server = await daemon([{ events: textLines('hel', 'lo') }])
    const ctx = await harness(server.url)

    const chunks = await run(ctx)

    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'hel' },
      { type: 'text-delta', index: 0, text: 'lo' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'hello' } },
      { type: 'usage', usage: { inputTokens: 7, outputTokens: 2 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    expect(server.paths).toEqual(['/api/chat'])
  })

  it('sends the configured model, streaming flag, and harness attribution', async () => {
    const server = await daemon([{ events: textLines('ok') }])
    const ctx = await harness(server.url, { maxTokens: 64, keepAlive: '5m' })

    await run(ctx, 'the prompt')

    expect(server.requests[0]).toMatchObject({
      model: MODEL,
      stream: true,
      keep_alive: '5m',
      options: { num_predict: 64 },
      messages: [{ role: 'user', content: 'the prompt' }],
    })
    // The seam requires every provider request to carry attribution.
    expect(server.headers[0]?.['user-agent']).toBeDefined()
  })

  it('maps a length stop reason to max-tokens', async () => {
    const server = await daemon([{
      events: [`${JSON.stringify({
        message: { role: 'assistant', content: 'truncated' },
        done: true,
        done_reason: 'length',
        prompt_eval_count: 1,
        eval_count: 1,
      })}\n`],
    }])
    const ctx = await harness(server.url)

    const chunks = await run(ctx)

    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'max-tokens' } })
  })

  it('surfaces tool calls as tool-call blocks and finishes on them', async () => {
    const server = await daemon([{
      events: [
        toolCallLine([{ name: 'read_file', arguments: { path: 'a.txt' } }]),
        `${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 3, eval_count: 4 })}\n`,
      ],
    }])
    const ctx = await harness(server.url)

    const chunks = await run(ctx)

    const call = chunks.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
    expect(call).toMatchObject({
      type: 'block-end',
      block: { type: 'tool-call', name: 'read_file', arguments: '{"path":"a.txt"}' },
    })
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
  })

  it('streams a thinking model reasoning before its answer', async () => {
    const server = await daemon([{ events: thinkingLines(['pon', 'dering'], ['pon', 'g']) }])
    const ctx = await harness(server.url)

    const chunks = await run(ctx)

    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'pon' },
      { type: 'reasoning-delta', index: 0, text: 'dering' },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: 'pon' },
      { type: 'text-delta', index: 1, text: 'g' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'pondering' } },
      { type: 'block-end', index: 1, block: { type: 'text', text: 'pong' } },
      { type: 'usage', usage: { inputTokens: 11, outputTokens: 5 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('declares the two thinking efforts and defaults to the daemon default', async () => {
    const server = await daemon([{ events: textLines('ok') }])
    const ctx = await harness(server.url)

    const info = await ctx.llm.resolveModelInfo(Ollama.OLLAMA_PROVIDER, MODEL)

    expect(info.reasoning?.efforts.map(effort => effort.id)).toEqual(['off', 'default'])
    expect(info.reasoning?.defaultEffort).toBe('default')
    expect(server.paths).toEqual([])
  })

  it('turns thinking off only when the request selects the off effort', async () => {
    const off = await daemon([{ events: textLines('ok') }])
    const offCtx = await harness(off.url)
    const defaulted = await daemon([{ events: textLines('ok') }])
    const defaultCtx = await harness(defaulted.url)

    await run(offCtx, 'hi', ReasoningEffortId('off'))
    await run(defaultCtx)

    expect(off.requests[0]).toMatchObject({ think: false })
    // The daemon's own default stays in force when no effort is selected.
    expect(defaulted.requests[0]).not.toHaveProperty('think')
  })

  it('reports an in-band error line as a terminal failure', async () => {
    const server = await daemon([{ events: [`${JSON.stringify({ error: 'model not found' })}\n`] }])
    const ctx = await harness(server.url)

    await expect(finishOf(ctx)).resolves.toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { code: 'SERVER', message: 'Ollama reported: model not found' } },
    })
  })

  it('classifies a rejected request by status', async () => {
    const server = await daemon([{ status: 404 }, { status: 500 }])
    const ctx = await harness(server.url)

    await expect(finishOf(ctx)).resolves.toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { code: 'INVALID_REQUEST', status: 404 } },
    })
    await expect(finishOf(ctx)).resolves.toMatchObject({
      type: 'finish',
      reason: { kind: 'error', failure: { code: 'SERVER', status: 500 } },
    })
  })

  it('lists the daemon models as text-only routes', async () => {
    const server = await daemon([{
      body: JSON.stringify({
        models: [
          { name: 'llama3.2:latest', details: { parameter_size: '3B' } },
          { name: 'qwen2.5-coder:7b' },
        ],
      }),
    }])
    const ctx = await harness(server.url)

    const models = await ctx.llm.listModels(Ollama.OLLAMA_PROVIDER)

    expect(models).toEqual([
      { provider: 'ollama', id: 'llama3.2:latest', name: 'llama3.2:latest (3B)', inputModalities: ['text'] },
      { provider: 'ollama', id: 'qwen2.5-coder:7b', name: 'qwen2.5-coder:7b', inputModalities: ['text'] },
    ])
    expect(server.paths).toEqual(['/api/tags'])
  })
})
