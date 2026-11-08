import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EmbeddingRuntime from '@deepseek-ai/dsh-embedding'
import * as hashPlugin from '@deepseek-ai/dsh-embedding-hash'
import { HashEmbeddingProvider,
  HASH_EMBEDDING_DIM,
  HASH_PROVIDER_ID,
} from '@deepseek-ai/dsh-embedding-hash'

describe('HashEmbeddingProvider', () => {
  it('is always available', () => {
    const provider = new HashEmbeddingProvider()
    expect(provider.available()).toBe(true)
  })

  it('has the correct stable id', () => {
    const provider = new HashEmbeddingProvider()
    expect(provider.id).toBe(HASH_PROVIDER_ID)
  })

  it('embeds a single text into a vector of the configured dimension', async () => {
    const provider = new HashEmbeddingProvider({ dimensions: 128 })
    const result = await provider.embed({ texts: ['hello world'] })
    expect(result.vectors).toHaveLength(1)
    expect(result.vectors[0]!.length).toBe(128)
    expect(result.truncated).toBe(false)
  })

  it('embeds multiple texts into vectors of the same length', async () => {
    const provider = new HashEmbeddingProvider({ dimensions: 64 })
    const result = await provider.embed({ texts: ['foo', 'bar', 'baz'] })
    expect(result.vectors).toHaveLength(3)
    for (const vec of result.vectors) {
      expect(vec.length).toBe(64)
    }
  })

  it('produces deterministic results for the same input', async () => {
    const provider = new HashEmbeddingProvider({ dimensions: 256 })
    const result1 = await provider.embed({ texts: ['hello world'] })
    const result2 = await provider.embed({ texts: ['hello world'] })
    expect(result1.vectors[0]).toEqual(result2.vectors[0])
  })

  it('produces different results for different inputs', async () => {
    const provider = new HashEmbeddingProvider({ dimensions: 256 })
    const result1 = await provider.embed({ texts: ['hello'] })
    const result2 = await provider.embed({ texts: ['goodbye'] })
    // Vectors should differ (with overwhelming probability)
    let diff = 0
    for (let i = 0; i < result1.vectors[0]!.length; i++) {
      if (result1.vectors[0]![i] !== result2.vectors[0]![i]) diff++
    }
    expect(diff).toBeGreaterThan(0)
  })

  it('handles empty text gracefully', async () => {
    const provider = new HashEmbeddingProvider({ dimensions: 64 })
    const result = await provider.embed({ texts: [''] })
    expect(result.vectors).toHaveLength(1)
    expect(result.vectors[0]!.length).toBe(64)
    // Empty text produces zero vector
    for (let i = 0; i < 64; i++) {
      expect(result.vectors[0]![i]).toBe(0)
    }
  })

  it('uses the default dimension when none specified', async () => {
    const provider = new HashEmbeddingProvider()
    const result = await provider.embed({ texts: ['test'] })
    expect(result.vectors[0]!.length).toBe(HASH_EMBEDDING_DIM)
  })

  it('propagates abort signal (returns truncated when aborted)', async () => {
    const provider = new HashEmbeddingProvider()
    const controller = new AbortController()
    controller.abort()
    const result = await provider.embed({ texts: ['hello'] }, controller.signal)
    expect(result.vectors).toHaveLength(0)
    expect(result.truncated).toBe(true)
  })
})

describe('HashEmbeddingProvider registration', () => {
  it('registers into ctx.embedding through the Cordis plugin', async () => {
    const ctx = new Context()
    await ctx.plugin(EmbeddingRuntime, {})
    await ctx.plugin(hashPlugin, { dimensions: 64 })
    // Should be able to embed through the runtime
    const result = await ctx.embedding.embed({ texts: ['test'] })
    expect(result.vectors).toHaveLength(1)
    expect(result.vectors[0]!.length).toBe(64)
  })

  it('auto-selects hash provider when it is the only registered usable provider', async () => {
    const ctx = new Context()
    await ctx.plugin(EmbeddingRuntime, {})
    await ctx.plugin(hashPlugin, {})
    const result = await ctx.embedding.embed({ texts: ['hello', 'world'] })
    expect(result.vectors).toHaveLength(2)
    expect(result.truncated).toBe(false)
  })
})
