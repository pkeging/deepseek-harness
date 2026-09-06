/**
 * Explicit composite embedding provider for the DeepSeek Harness.
 *
 * The embedding seam deliberately rejects automatic, hidden fallback chains:
 * selection is always one explicitly configured provider, and a missing or
 * ambiguous provider fails loud. This plugin honors that by *composing* a ladder
 * the operator chooses and orders explicitly — it registers a single composite
 * `EmbeddingProvider` whose `order` (e.g. `['api', 'hash']`) lives in its own
 * config, not in registration order. The runtime still selects exactly one
 * provider (`embeddingProvider: 'fallback'`); the degrade path is an internal,
 * operator-authored behavior, so no hidden priority chain is introduced.
 *
 * @module @deepseek-ai/dsh-embedding-fallback
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  EmbeddingError,
  type EmbeddingProvider,
  type EmbeddingRequest,
  type EmbeddingResult,
} from '@deepseek-ai/dsh-embedding'

/** The composite provider's id in `ctx.embedding`. */
export const FALLBACK_PROVIDER_ID = 'fallback'

/** Plugin name registered with Cordis. */
export const name = 'embedding-fallback'
/** Services this plugin requires before it can apply. */
export const inject = ['embedding']

/** Plugin config: the operator-authored candidate ladder. */
export interface EmbeddingFallbackConfig {
  /**
   * Ordered candidate provider ids. The first available candidate is tried; on a
   * runtime failure the next available candidate is tried, in order, until one
   * succeeds or the list is exhausted. Must be non-empty.
   */
  order: string[]
  /** id of the composite provider registered into `ctx.embedding`. Default `'fallback'`. */
  readonly id?: string
}

/** Raw schemastery config schema. */
export const Config = z.object({
  order: z.array(z.string()).min(1),
  id: z.string().default(FALLBACK_PROVIDER_ID),
})

/**
 * Apply the composite fallback provider.
 * @param ctx - the Cordis context the plugin mounts into.
 * @param config - resolved plugin config.
 */
export function apply(ctx: Context, config: EmbeddingFallbackConfig): void {
  const id = config.id ?? FALLBACK_PROVIDER_ID
  const composite: EmbeddingProvider = {
    id,
    available() {
      return config.order.some((candidateId) => {
        const provider = ctx.embedding.providers.get(candidateId)
        return provider !== undefined && provider.available()
      })
    },
    async embed(request: EmbeddingRequest, signal?: AbortSignal): Promise<EmbeddingResult> {
      let lastError: unknown
      for (const candidateId of config.order) {
        const provider = ctx.embedding.providers.get(candidateId)
        if (provider === undefined || !provider.available()) continue
        try {
          return await provider.embed(request, signal)
        } catch (error) {
          lastError = error
        }
      }
      throw lastError instanceof EmbeddingError
        ? lastError
        : new EmbeddingError('all embedding fallback candidates failed', 'EMBEDDING_FALLBACK_EXHAUSTED')
    },
  }
  ctx.embedding.registerProvider(composite)
}

export default { name, inject, Config, apply }
