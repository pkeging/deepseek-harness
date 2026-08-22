/**
 * API-based embedding provider implementation.
 * Calls a remote embedding API to produce semantic vectors. The provider takes
 * a thunk for its configuration so settings changes propagate to the next request
 * without re-registration.
 *
 * @module @deepseek-ai/dsh-embedding-api/provider
 */

import { EmbeddingError, type EmbeddingProvider, type EmbeddingRequest, type EmbeddingResult } from '@deepseek-ai/dsh-embedding'

/** Stable provider id for registration into `ctx.embedding`. */
export const API_PROVIDER_ID = 'api'

/** Default DeepSeek embedding API base URL. */
export const DEFAULT_API_BASE_URL = 'https://api.deepseek.com/v1'

/** Default embedding model name. */
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-v3'

/** Config for the API embedding provider. */
export interface ApiEmbeddingProviderConfig {
  /** Literal API key (for testing without the credentials seam). */
  apiKey?: string
  /** Async function that resolves the API key from the credentials seam. */
  resolveApiKey?: () => Promise<string | undefined>
  /** Embedding API base URL. */
  baseURL: string
  /** Embedding model name. */
  model: string
  /** Output vector dimension (optional). */
  dimensions?: number
}

/**
 * Response shape from the embedding API.
 */
interface EmbeddingApiResponse {
  readonly data: ReadonlyArray<{
    readonly index: number
    readonly embedding: readonly number[]
  }>
  readonly model: string
  readonly usage?: {
    readonly prompt_tokens: number
    readonly total_tokens: number
  }
}

/**
 * API-based embedding provider. Calls a remote HTTP API to produce semantic
 * embeddings. Requires a valid API key to be usable.
 */
export class ApiEmbeddingProvider implements EmbeddingProvider {
  readonly id = API_PROVIDER_ID
  private readonly getConfig: () => ApiEmbeddingProviderConfig

  /**
   * Create an API embedding provider.
   * @param getConfig - thunk returning the current request configuration.
   */
  constructor(getConfig: () => ApiEmbeddingProviderConfig) {
    this.getConfig = getConfig
  }

  /**
   * Check if the provider is usable. Returns false when no API key is available.
   * Note: because key resolution is async, this sync check can only confirm
   * that a literal key is configured. The full check happens at embed time.
   */
  available(): boolean {
    const config = this.getConfig()
    return config.apiKey !== undefined && config.apiKey.length > 0
  }

  /**
   * Embed texts through the remote API.
   *
   * @param request - texts to embed.
   * @param signal - optional cancellation signal.
   * @returns embedding vectors, one per input text.
   */
  async embed(request: EmbeddingRequest, signal?: AbortSignal): Promise<EmbeddingResult> {
    const config = this.getConfig()
    const apiKey = await this.resolveKey(config)

    const url = `${config.baseURL.replace(/\/$/, '')}/embeddings`
    const body: Record<string, unknown> = {
      model: config.model,
      input: [...request.texts],
    }
    if (config.dimensions !== undefined) {
      body.dimensions = config.dimensions
    }

    let response: Response
    try {
      const init: RequestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      }
      if (signal !== undefined) {
        init.signal = signal
      }
      response = await fetch(url, init)
    } catch (cause) {
      if (signal?.aborted) {
        throw new EmbeddingError(
          'embedding request was cancelled',
          'EMBEDDING_API_CANCELLED',
        )
      }
      throw new EmbeddingError(
        `embedding API request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        'EMBEDDING_API_NETWORK_ERROR',
      )
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '(no response body)')
      throw new EmbeddingError(
        `embedding API returned ${response.status}: ${text}`,
        'EMBEDDING_API_HTTP_ERROR',
      )
    }

    let data: EmbeddingApiResponse
    try {
      data = await response.json() as EmbeddingApiResponse
    } catch {
      throw new EmbeddingError(
        'embedding API returned invalid JSON',
        'EMBEDDING_API_PARSE_ERROR',
      )
    }

    // Sort by index to guarantee order matches input
    const sorted = [...data.data].sort((a, b) => a.index - b.index)
    const vectors = sorted.map(item => new Float32Array(item.embedding))
    return { vectors, truncated: false }
  }

  /**
   * Resolve the API key from config, preferring async resolution over literal.
   * @param config - current provider config.
   * @returns the API key string.
   */
  private async resolveKey(config: ApiEmbeddingProviderConfig): Promise<string> {
    if (config.resolveApiKey !== undefined) {
      const resolved = await config.resolveApiKey()
      if (resolved !== undefined && resolved.length > 0) return resolved
    }
    if (config.apiKey !== undefined && config.apiKey.length > 0) {
      return config.apiKey
    }
    throw new EmbeddingError(
      'no API key available for embedding provider',
      'EMBEDDING_API_KEY_MISSING',
    )
  }
}
