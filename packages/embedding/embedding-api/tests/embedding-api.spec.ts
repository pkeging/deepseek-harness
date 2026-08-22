import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import EmbeddingRuntime from '@deepseek-ai/dsh-embedding'
import * as apiPlugin from '@deepseek-ai/dsh-embedding-api'
import {
  ApiEmbeddingProvider,
  API_PROVIDER_ID,
  DEFAULT_API_BASE_URL,
  DEFAULT_EMBEDDING_MODEL,
} from '@deepseek-ai/dsh-embedding-api'
import type { ApiEmbeddingProviderConfig } from '@deepseek-ai/dsh-embedding-api'

/** Minimal valid embedding API response. */
function apiResponse(vectors: number[][]): Response {
  const data = vectors.map((embedding, index) => ({ index, embedding }))
  return new Response(JSON.stringify({ data, model: DEFAULT_EMBEDDING_MODEL }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** Create an API embedding provider over a fixed config. */
function makeProvider(config: ApiEmbeddingProviderConfig): ApiEmbeddingProvider {
  return new ApiEmbeddingProvider(() => config)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ApiEmbeddingProvider', () => {
  it('has the correct stable id', () => {
    const provider = makeProvider({ baseURL: DEFAULT_API_BASE_URL, model: DEFAULT_EMBEDDING_MODEL })
    expect(provider.id).toBe(API_PROVIDER_ID)
  })

  it('returns available=false when no API key is configured', () => {
    const provider = makeProvider({ baseURL: DEFAULT_API_BASE_URL, model: DEFAULT_EMBEDDING_MODEL })
    expect(provider.available()).toBe(false)
  })

  it('returns available=true when a literal API key is configured', () => {
    const provider = makeProvider({
      baseURL: DEFAULT_API_BASE_URL,
      model: DEFAULT_EMBEDDING_MODEL,
      apiKey: 'test-key',
    })
    expect(provider.available()).toBe(true)
  })

  it('embeds texts via the HTTP API', async () => {
    const provider = makeProvider({
      baseURL: 'https://api.test/v1',
      model: 'text-embedding-v3',
      apiKey: 'test-key',
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(apiResponse([
      [1, 0, 0],
      [0, 1, 0],
    ])))

    const result = await provider.embed({ texts: ['hello', 'world'] })
    expect(result.vectors).toHaveLength(2)
    expect(result.vectors[0]).toEqual(new Float32Array([1, 0, 0]))
    expect(result.vectors[1]).toEqual(new Float32Array([0, 1, 0]))
  })

  it('throws EMBEDDING_API_HTTP_ERROR on non-2xx responses', async () => {
    const provider = makeProvider({
      baseURL: 'https://api.test/v1',
      model: 'text-embedding-v3',
      apiKey: 'test-key',
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('{"error":"invalid model"}', { status: 400, headers: { 'content-type': 'application/json' } }),
    ))

    await expect(provider.embed({ texts: ['hello'] })).rejects.toThrow(
      expect.objectContaining({ code: 'EMBEDDING_API_HTTP_ERROR' }),
    )
  })

  it('throws EMBEDDING_API_NETWORK_ERROR on fetch failure', async () => {
    const provider = makeProvider({
      baseURL: 'https://api.test/v1',
      model: 'text-embedding-v3',
      apiKey: 'test-key',
    })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))

    await expect(provider.embed({ texts: ['hello'] })).rejects.toThrow(
      expect.objectContaining({ code: 'EMBEDDING_API_NETWORK_ERROR' }),
    )
  })

  it('throws EMBEDDING_API_CANCELLED when signal aborts', async () => {
    const provider = makeProvider({
      baseURL: 'https://api.test/v1',
      model: 'text-embedding-v3',
      apiKey: 'test-key',
    })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')))

    const controller = new AbortController()
    controller.abort()
    await expect(provider.embed({ texts: ['hello'] }, controller.signal)).rejects.toThrow(
      expect.objectContaining({ code: 'EMBEDDING_API_CANCELLED' }),
    )
  })

  it('throws EMBEDDING_API_KEY_MISSING when no key is available', async () => {
    const provider = makeProvider({
      baseURL: 'https://api.test/v1',
      model: 'text-embedding-v3',
    })

    await expect(provider.embed({ texts: ['hello'] })).rejects.toThrow(
      expect.objectContaining({ code: 'EMBEDDING_API_KEY_MISSING' }),
    )
  })

  it('resolves API key from async resolver', async () => {
    const provider = makeProvider({
      baseURL: 'https://api.test/v1',
      model: 'text-embedding-v3',
      resolveApiKey: async () => 'resolved-key',
    })

    const fetchMock = vi.fn().mockResolvedValue(apiResponse([[1, 0, 0]]))
    vi.stubGlobal('fetch', fetchMock)

    const result = await provider.embed({ texts: ['hello'] })
    expect(result.vectors).toHaveLength(1)
    expect(result.truncated).toBe(false)
    expect(fetchMock).toHaveBeenCalled()
  })

  it('sends dimensions parameter when configured', async () => {
    const provider = makeProvider({
      baseURL: 'https://api.test/v1',
      model: 'text-embedding-v3',
      apiKey: 'test-key',
      dimensions: 1024,
    })

    const fetchMock = vi.fn().mockResolvedValue(apiResponse([new Array<number>(1024).fill(1)]))
    vi.stubGlobal('fetch', fetchMock)
    await provider.embed({ texts: ['hello'] })

    const callArgs = fetchMock.mock.calls[0] as [string, { body: string }]
    const body = JSON.parse(callArgs[1].body) as Record<string, unknown>
    expect(body.dimensions).toBe(1024)
    expect(body.model).toBe('text-embedding-v3')
    expect(body.input).toEqual(['hello'])
  })
})

describe('ApiEmbeddingProvider registration', () => {
  it('registers into ctx.embedding through the Cordis plugin', async () => {
    const ctx = new Context()
    await ctx.plugin(EmbeddingRuntime, { embeddingProvider: API_PROVIDER_ID })
    await ctx.plugin(apiPlugin, {
      apiKey: 'test-key',
      baseURL: 'https://api.test/v1',
      model: 'text-embedding-v3',
    })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(apiResponse([[1, 0, 0], [0, 1, 0]])))

    const result = await ctx.embedding.embed({ texts: ['hello', 'world'] })
    expect(result.vectors).toHaveLength(2)
  })
})
