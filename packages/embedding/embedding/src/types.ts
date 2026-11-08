/**
 * Vocabulary for the embedding capability seam (`ctx.embedding`).
 * Provides text-to-vector embeddings for semantic search, memory, knowledge bases,
 * and other consumers that need similarity computation.
 *
 * @module @deepseek-ai/dsh-embedding/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * What one embedding backend is asked to embed. Each request carries one or more
 * text strings; a consumer may issue several requests.
 */
export interface EmbeddingRequest {
  /** One or more text strings to embed. */
  readonly texts: readonly string[]
}

/**
 * Normalized embedding result. Each text in the request produces one Float32Array vector
 * at the corresponding index. `truncated` is set by the seam when the provider
 * returned fewer vectors than requested.
 */
export interface EmbeddingResult {
  /** Embedding vectors in the same order as the input texts. */
  readonly vectors: readonly Float32Array[]
  /** True when the seam dropped vectors because the provider over-or-under-returned. */
  readonly truncated: boolean
}

/**
 * One embedding backend. Registered with `ctx.embedding.registerProvider`.
 * `id` is a stable string, unique within the embedding capability kind.
 */
export interface EmbeddingProvider {
  readonly id: string
  /** Cheap local usability check; must not make network calls. */
  available(): boolean
  /**
   * Embed one or more text strings. Honor `signal` for cancellation.
   * @param request - the texts to embed.
   * @param signal - optional cancellation signal.
   * @returns the embedding vectors.
   */
  embed(request: EmbeddingRequest, signal?: AbortSignal): Promise<EmbeddingResult>
}

/**
 * Typed embedding error with a machine-routable, open-string `code` and chained `cause`.
 * Consumers must tolerate provider-specific codes. Shared codes cover unavailable,
 * missing, ambiguous, or duplicate providers, cancellation, and provider failure.
 */
export class EmbeddingError extends HarnessError {}
