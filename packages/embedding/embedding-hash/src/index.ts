/**
 * Hash-based embedding provider for `ctx.embedding`.
 * A zero-dependency fallback: tokenizes the input and projects tokens into a
 * fixed-dimension vector via hash collisions. Not semantically meaningful —
 * useful as a test harness, a development fallback, or when no other embedding
 * backend is available.
 *
 * @module @deepseek-ai/dsh-embedding-hash
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-embedding'
import {
  HashEmbeddingProvider,
  HASH_EMBEDDING_DIM,
} from './provider.ts'

export {
  HashEmbeddingProvider,
  HASH_EMBEDDING_DIM,
  HASH_PROVIDER_ID,
} from './provider.ts'
export type { HashEmbeddingProviderConfig } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'embedding-hash'

/** The embedding seam this provider registers into. */
export const inject = ['embedding']

/** Plugin config (all optional — `apply` fills defaults). */
export interface Config {
  /** Output vector dimension. Must be a positive integer. Defaults to 256. */
  dimensions?: number
}

export const Config: z<Config> = z.object({
  dimensions: z.number().step(1).min(1).default(HASH_EMBEDDING_DIM),
})

/** Register the hash embedding provider with `ctx.embedding`. */
export function apply(ctx: Context, config: Config): void {
  const dimensions = config.dimensions ?? HASH_EMBEDDING_DIM
  ctx.embedding.registerProvider(new HashEmbeddingProvider({ dimensions }))
}
