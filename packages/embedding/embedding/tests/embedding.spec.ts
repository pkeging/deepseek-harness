import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EmbeddingRuntime, {
  EmbeddingError,
  type EmbeddingProvider,
  type EmbeddingRequest,
  type EmbeddingResult,
} from '@deepseek-ai/dsh-embedding'

/** A scripted embedding provider for contract tests. */
function makeProvider(
  id: string,
  available: boolean,
  embed: (request: EmbeddingRequest) => Promise<EmbeddingResult>,
): EmbeddingProvider {
  return { id, available: () => available, embed: request => embed(request) }
}

const available = true
const unavailable = false

function embeddingResult(vectors: Float32Array[], truncated = false): EmbeddingResult {
  return { vectors, truncated }
}

type EmbeddingConfig = ConstructorParameters<typeof EmbeddingRuntime>[1]

/** Mount an EmbeddingRuntime on a fresh root context with the given config. */
async function mountEmbedding(config: EmbeddingConfig = {}): Promise<{ ctx: Context; embedding: EmbeddingRuntime }> {
  const ctx = new Context()
  await ctx.plugin(EmbeddingRuntime, config)
  return { ctx, embedding: ctx.embedding }
}

describe('EmbeddingRuntime registration', () => {
  it('registers a provider and unregisters it via the returned disposer', async () => {
    const { embedding } = await mountEmbedding()

    const dispose = embedding.registerProvider(makeProvider('hash', available, () =>
      Promise.resolve(embeddingResult([new Float32Array([1, 0, 0])]))))
    await expect(embedding.embed({ texts: ['hello'] })).resolves.toMatchObject({ truncated: false })

    dispose()
    await expect(embedding.embed({ texts: ['hello'] })).rejects.toThrow(
      expect.objectContaining({ code: 'EMBEDDING_PROVIDER_UNAVAILABLE' }),
    )
  })

  it('throws EMBEDDING_DUPLICATE_PROVIDER on a duplicate id', async () => {
    const { embedding } = await mountEmbedding()
    embedding.registerProvider(makeProvider('hash', available, () =>
      Promise.resolve(embeddingResult([new Float32Array([1, 0, 0])]))))
    expect(() => embedding.registerProvider(makeProvider('hash', available, () =>
      Promise.resolve(embeddingResult([new Float32Array([1, 0, 0])])))))
      .toThrow(expect.objectContaining({ code: 'EMBEDDING_DUPLICATE_PROVIDER' }))
  })

  it('disposes provider registrations when the contributing fiber is disposed (HMR safety)', async () => {
    const { ctx, embedding } = await mountEmbedding()
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.embedding.registerProvider(makeProvider('hash', available, () =>
        Promise.resolve(embeddingResult([new Float32Array([1, 0, 0])]))))
    }, { inject: ['embedding'] }))
    await expect(embedding.embed({ texts: ['hello'] })).resolves.toMatchObject({ truncated: false })
    await fiber.dispose()
    await expect(embedding.embed({ texts: ['hello'] })).rejects.toThrow(
      expect.objectContaining({ code: 'EMBEDDING_PROVIDER_UNAVAILABLE' }),
    )
  })
})

describe('EmbeddingRuntime execution resolution', () => {
  it('throws EMBEDDING_PROVIDER_UNAVAILABLE when nothing is registered', async () => {
    const { embedding } = await mountEmbedding()
    await expect(embedding.embed({ texts: ['q'] })).rejects.toThrow(
      expect.objectContaining({ code: 'EMBEDDING_PROVIDER_UNAVAILABLE' }),
    )
  })

  it('throws EMBEDDING_PROVIDER_UNAVAILABLE when providers exist but none are usable', async () => {
    const { embedding } = await mountEmbedding()
    embedding.registerProvider(makeProvider('hash', unavailable, () =>
      Promise.resolve(embeddingResult([new Float32Array([1, 0, 0])]))))
    await expect(embedding.embed({ texts: ['q'] })).rejects.toThrow(
      expect.objectContaining({ code: 'EMBEDDING_PROVIDER_UNAVAILABLE' }),
    )
  })

  it('throws EMBEDDING_PROVIDER_CONFIGURED_MISSING for an unregistered configured id', async () => {
    const { embedding } = await mountEmbedding({ embeddingProvider: 'api' })
    embedding.registerProvider(makeProvider('hash', available, () =>
      Promise.resolve(embeddingResult([new Float32Array([1, 0, 0])]))))
    await expect(embedding.embed({ texts: ['q'] })).rejects.toThrow(
      expect.objectContaining({ code: 'EMBEDDING_PROVIDER_CONFIGURED_MISSING' }),
    )
  })

  it('throws EMBEDDING_PROVIDER_CONFIGURED_UNAVAILABLE for an unusable configured id', async () => {
    const { embedding } = await mountEmbedding({ embeddingProvider: 'hash' })
    embedding.registerProvider(makeProvider('hash', unavailable, () =>
      Promise.resolve(embeddingResult([new Float32Array([1, 0, 0])]))))
    await expect(embedding.embed({ texts: ['q'] })).rejects.toThrow(
      expect.objectContaining({ code: 'EMBEDDING_PROVIDER_CONFIGURED_UNAVAILABLE' }),
    )
  })

  it('throws EMBEDDING_PROVIDER_AMBIGUOUS rather than picking by order', async () => {
    const { embedding } = await mountEmbedding()
    embedding.registerProvider(makeProvider('hash', available, () =>
      Promise.resolve(embeddingResult([new Float32Array([1, 0, 0])]))))
    embedding.registerProvider(makeProvider('api', available, () =>
      Promise.resolve(embeddingResult([new Float32Array([0, 1, 0])]))))
    await expect(embedding.embed({ texts: ['q'] })).rejects.toThrow(
      expect.objectContaining({ code: 'EMBEDDING_PROVIDER_AMBIGUOUS' }),
    )
  })

  it('runs the configured provider even when another usable provider is registered', async () => {
    const { embedding } = await mountEmbedding({ embeddingProvider: 'api' })
    embedding.registerProvider(makeProvider('hash', available, () =>
      Promise.resolve(embeddingResult([new Float32Array([1, 0, 0])]))))
    embedding.registerProvider(makeProvider('api', available, () =>
      Promise.resolve(embeddingResult([new Float32Array([0, 1, 0])]))))
    const result = await embedding.embed({ texts: ['q'] })
    expect(result.vectors[0]![1]).toBe(1)
  })

  it('ignores unusable providers when auto-selecting', async () => {
    const { embedding } = await mountEmbedding()
    embedding.registerProvider(makeProvider('hash', available, () =>
      Promise.resolve(embeddingResult([new Float32Array([1, 0, 0])]))))
    embedding.registerProvider(makeProvider('api', unavailable, () =>
      Promise.resolve(embeddingResult([new Float32Array([0, 1, 0])]))))
    await expect(embedding.embed({ texts: ['q'] })).resolves.toMatchObject({ truncated: false })
  })

  it('does not let registration order change auto-selection', async () => {
    const a = await mountEmbedding()
    a.embedding.registerProvider(makeProvider('hash', unavailable, () =>
      Promise.resolve(embeddingResult([new Float32Array([1, 0, 0])]))))
    a.embedding.registerProvider(makeProvider('api', available, () =>
      Promise.resolve(embeddingResult([new Float32Array([0, 1, 0])]))))
    const resultA = await a.embedding.embed({ texts: ['q'] })
    expect(resultA.vectors[0]![1]).toBe(1)

    const b = await mountEmbedding()
    b.embedding.registerProvider(makeProvider('api', available, () =>
      Promise.resolve(embeddingResult([new Float32Array([0, 1, 0])]))))
    b.embedding.registerProvider(makeProvider('hash', unavailable, () =>
      Promise.resolve(embeddingResult([new Float32Array([1, 0, 0])]))))
    const resultB = await b.embedding.embed({ texts: ['q'] })
    expect(resultB.vectors[0]![1]).toBe(1)
  })

  it('propagates the abort signal to the provider', async () => {
    const { embedding } = await mountEmbedding()
    const seen: (AbortSignal | undefined)[] = []
    embedding.registerProvider({
      id: 'hash',
      available: () => available,
      embed: (_request, signal) => { seen.push(signal); return Promise.resolve(embeddingResult([new Float32Array([1, 0, 0])])) },
    })
    const controller = new AbortController()
    await embedding.embed({ texts: ['q'] }, controller.signal)
    expect(seen[0]).toBe(controller.signal)
  })
})

describe('EmbeddingRuntime vector count enforcement', () => {
  it('returns truncated=false when provider returns exact count', async () => {
    const { embedding } = await mountEmbedding()
    embedding.registerProvider(makeProvider('hash', available, request =>
      Promise.resolve(embeddingResult(
        request.texts.map(() => new Float32Array([1, 0, 0])),
      ))))
    const result = await embedding.embed({ texts: ['a', 'b'] })
    expect(result.vectors).toHaveLength(2)
    expect(result.truncated).toBe(false)
  })

  it('returns truncated=true and pads with zeros when provider under-returns', async () => {
    const { embedding } = await mountEmbedding()
    embedding.registerProvider(makeProvider('hash', available, () =>
      Promise.resolve(embeddingResult([new Float32Array([1, 0, 0])]))))
    const result = await embedding.embed({ texts: ['a', 'b', 'c'] })
    expect(result.vectors).toHaveLength(3)
    expect(result.truncated).toBe(true)
    expect(result.vectors[2]).toEqual(new Float32Array([0, 0, 0]))
  })

  it('returns truncated=true when provider over-returns', async () => {
    const { embedding } = await mountEmbedding()
    embedding.registerProvider(makeProvider('hash', available, () =>
      Promise.resolve(embeddingResult([
        new Float32Array([1, 0, 0]),
        new Float32Array([0, 1, 0]),
        new Float32Array([0, 0, 1]),
      ]))))
    const result = await embedding.embed({ texts: ['a'] })
    expect(result.vectors).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })
})

describe('EmbeddingError', () => {
  it('is a HarnessError carrying its code', () => {
    const error = new EmbeddingError('boom', 'EMBEDDING_PROVIDER_UNAVAILABLE')
    expect(error.code).toBe('EMBEDDING_PROVIDER_UNAVAILABLE')
    expect(error.name).toBe('EmbeddingError')
  })
})
