import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EmbeddingRuntime, {
  EmbeddingError,
  type EmbeddingProvider,
  type EmbeddingRequest,
  type EmbeddingResult,
} from '@deepseek-ai/dsh-embedding'
import * as Fallback from '@deepseek-ai/dsh-embedding-fallback'

/**
 * Behavior suite for the explicit composite embedding provider. The runtime still
 * selects exactly one provider (the composite); this plugin only controls which
 * candidate the composite tries first, via its own explicit `order` config.
 */

function fakeProvider(
  id: string,
  opts: { fail?: boolean; available?: boolean } = {},
): EmbeddingProvider {
  return {
    id,
    available: () => opts.available ?? true,
    async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
      if (opts.fail) throw new Error(`${id} failed`)
      return {
        vectors: request.texts.map(() => new Float32Array([1, 2, 3])),
        truncated: false,
      }
    },
  }
}

function harness(order: string[], providers: EmbeddingProvider[]): EmbeddingRuntime {
  const ctx = new Context()
  const rt = new EmbeddingRuntime(ctx, { embeddingProvider: 'fallback' })
  for (const provider of providers) rt.registerProvider(provider)
  // Function plugin: call apply directly, not ctx.plugin
  Fallback.apply(ctx, { order })
  return rt
}

describe('explicit composite selection', () => {
  it('uses the first available candidate that succeeds', async () => {
    const rt = harness(['api', 'hash'], [fakeProvider('api'), fakeProvider('hash')])
    const result = await rt.embed({ texts: ['hello'] })
    expect(result.vectors).toHaveLength(1)
  })

  it('degrades to the next candidate when the first throws at runtime', async () => {
    const rt = harness(
      ['api', 'hash'],
      [fakeProvider('api', { fail: true }), fakeProvider('hash')],
    )
    const result = await rt.embed({ texts: ['hello'] })
    expect(result.vectors).toHaveLength(1)
  })

  it('skips unavailable candidates without trying them', async () => {
    const rt = harness(
      ['api', 'hash'],
      [fakeProvider('api', { available: false }), fakeProvider('hash')],
    )
    const result = await rt.embed({ texts: ['hello'] })
    expect(result.vectors).toHaveLength(1)
  })

  it('throws EMBEDDING_FALLBACK_EXHAUSTED when every candidate fails', async () => {
    const rt = harness(
      ['api', 'hash'],
      [fakeProvider('api', { fail: true }), fakeProvider('hash', { fail: true })],
    )
    await expect(rt.embed({ texts: ['hello'] })).rejects.toThrow(
      new EmbeddingError('all embedding fallback candidates failed', 'EMBEDDING_FALLBACK_EXHAUSTED'),
    )
  })

  it('reports available() true when at least one candidate is usable', () => {
    const rt = harness(['api', 'hash'], [fakeProvider('api', { available: false }), fakeProvider('hash')])
    expect(rt.providers.get('fallback')?.available()).toBe(true)
  })

  it('reports available() false when no candidate is usable', () => {
    const rt = harness(['api'], [fakeProvider('api', { available: false })])
    expect(rt.providers.get('fallback')?.available()).toBe(false)
  })
})
