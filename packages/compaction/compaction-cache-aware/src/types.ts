/**
 * Configuration vocabulary for the cache-aware compaction plugin.
 *
 * @module @deepseek-ai/dsh-compaction-cache-aware/types
 */

/**
 * Configuration for KV cache-aware compaction strategy.
 */
export interface CacheAwareConfig {
  /**
   * Enable cache optimization heuristics. Defaults to `true`.
   */
  enableCacheOptimization?: boolean
  /**
   * Priority weight for cache preservation (0 = ignore cache, 1 = maximize cache).
   * Defaults to `0.7`.
   */
  cachePreservationPriority?: number
  /**
   * Minimum cache reuse ratio to consider a region cache-friendly.
   * Defaults to `0.5`.
   */
  minCacheReuseRatio?: number
  /**
   * Whether to run cache-aware checks at all. Defaults to `true`.
   */
  enabled?: boolean
}

/**
 * Validated, immutable cache-aware configuration.
 */
export interface ResolvedCacheAwareConfig {
  readonly enableCacheOptimization: boolean
  readonly cachePreservationPriority: number
  readonly minCacheReuseRatio: number
  readonly enabled: boolean
}
