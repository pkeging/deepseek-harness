/**
 * Hash-based embedding provider implementation.
 * Projects tokenized text into a fixed-dimension vector via FNV-1a hash collisions.
 * This is NOT a semantic embedding — it's a deterministic, zero-dependency fallback
 * that preserves rough term-overlap similarity and gives consumers a working
 * embedding pipeline even without API keys or local ML models.
 *
 * @module @deepseek-ai/dsh-embedding-hash/provider
 */

import type {
  EmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResult,
} from '@deepseek-ai/dsh-embedding'

/** Stable provider id for registration into `ctx.embedding`. */
export const HASH_PROVIDER_ID = 'hash'

/** Default output vector dimension. */
export const HASH_EMBEDDING_DIM = 256

/** Config for the hash embedding provider. */
export interface HashEmbeddingProviderConfig {
  /** Output vector dimension. Defaults to {@link HASH_EMBEDDING_DIM}. */
  readonly dimensions?: number
}

/**
 * Hash-based embedding provider. Deterministic, zero-dependency fallback.
 *
 * The embedding algorithm:
 * 1. Tokenize: lowercase, split on whitespace + character bigrams
 * 2. For each token, FNV-1a hash to a dimension index
 * 3. Accumulate +1 at each hit position
 * 4. Apply sqrt normalization (length counteracts document length)
 * 5. L2-normalize the final vector
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly id = HASH_PROVIDER_ID
  private readonly dimensions: number

  /**
   * Create a hash embedding provider.
   * @param config - optional dimension override.
   */
  constructor(config: HashEmbeddingProviderConfig = {}) {
    this.dimensions = config.dimensions ?? HASH_EMBEDDING_DIM
  }

  /** Always available — hash embedding has no external dependencies. */
  available(): boolean {
    return true
  }

  /**
   * Embed texts using hash-based projection. Cancellation is a no-op — hash
   * computation is fast and synchronous.
   *
   * @param request - texts to embed.
   * @param signal - optional cancellation signal (unused, computation is local).
   * @returns embedding vectors, one per input text.
   */
  embed(request: EmbeddingRequest, signal?: AbortSignal): Promise<EmbeddingResult> {
    if (signal?.aborted) {
      // Already aborted before we started — return what we have (none).
      return Promise.resolve({ vectors: [], truncated: true })
    }
    const vectors = request.texts.map(text => this.hashEmbed(text))
    return Promise.resolve({ vectors, truncated: false })
  }

  /**
   * Hash-embed one text string.
   * @param text - input text.
   * @returns normalized embedding vector.
   */
  private hashEmbed(text: string): Float32Array {
    const vec = new Float32Array(this.dimensions)
    const tokens = this.tokenize(text)
    for (const token of tokens) {
      const index = this.fnv1a(token) % this.dimensions
      const current = vec[index] ?? 0
      vec[index] = current + 1
    }
    // Sqrt normalization: dampens the bursty growth of raw counts
    for (let i = 0; i < this.dimensions; i++) {
      const val = vec[i] ?? 0
      vec[i] = Math.sqrt(val)
    }
    // L2 normalize
    return this.normalize(vec)
  }

  /**
   * Tokenize text into a mix of word tokens and character bigrams.
   * Lowercased for case-insensitive matching.
   * @param text - raw input.
   * @returns token array.
   */
  private tokenize(text: string): string[] {
    const lower = text.toLowerCase()
    const tokens: string[] = []
    // Word tokens
    for (const word of lower.split(/\s+/)) {
      if (word.length > 0) tokens.push(word)
    }
    // Character bigrams
    for (let i = 0; i < lower.length - 1; i++) {
      tokens.push(lower.slice(i, i + 2))
    }
    return tokens
  }

  /**
   * FNV-1a hash of a string to a 32-bit unsigned integer.
   * @param str - input string.
   * @returns 32-bit unsigned hash.
   */
  private fnv1a(str: string): number {
    let hash = 0x811c9dc5 // FNV offset basis
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i)
      // Multiply by FNV prime; use >>> 0 to keep unsigned 32-bit
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return hash >>> 0
  }

  /**
   * L2-normalize a vector in place.
   * @param vec - vector to normalize.
   * @returns the same vector, normalized.
   */
  private normalize(vec: Float32Array): Float32Array {
    let norm = 0
    for (let i = 0; i < vec.length; i++) {
      const val = vec[i] ?? 0
      norm += val * val
    }
    norm = Math.sqrt(norm)
    if (norm === 0) return vec
    for (let i = 0; i < vec.length; i++) {
      const val = vec[i] ?? 0
      vec[i] = val / norm
    }
    return vec
  }
}
