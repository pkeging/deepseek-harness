/**
 * Configuration resolution for cache-aware compaction.
 *
 * @module @deepseek-ai/dsh-compaction-cache-aware/config
 */

import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { CacheAwareConfig, ResolvedCacheAwareConfig } from './types.ts'

/** Fixed default configuration. */
export const DEFAULTS: ResolvedCacheAwareConfig = deepFreeze({
  enableCacheOptimization: true,
  cachePreservationPriority: 0.7,
  minCacheReuseRatio: 0.5,
  enabled: true,
})

const CONFIG_KEYS: ReadonlySet<string> = new Set([
  'enableCacheOptimization',
  'cachePreservationPriority',
  'minCacheReuseRatio',
  'enabled',
])

/**
 * Validate and resolve cache-aware compaction configuration.
 * @param config - untrusted plugin configuration.
 * @returns detached immutable resolved config.
 */
export function resolveConfig(config: CacheAwareConfig = {}): ResolvedCacheAwareConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Error(`CacheAwareConfig: unknown key "${key}"`)
    }
  }

  const enableCacheOptimization = config.enableCacheOptimization ?? DEFAULTS.enableCacheOptimization
  const cachePreservationPriority = config.cachePreservationPriority ?? DEFAULTS.cachePreservationPriority
  const minCacheReuseRatio = config.minCacheReuseRatio ?? DEFAULTS.minCacheReuseRatio
  const enabled = config.enabled ?? DEFAULTS.enabled

  if (typeof cachePreservationPriority !== 'number' || cachePreservationPriority < 0 || cachePreservationPriority > 1) {
    throw new Error('CacheAwareConfig: cachePreservationPriority must be in [0, 1]')
  }
  if (typeof minCacheReuseRatio !== 'number' || minCacheReuseRatio < 0 || minCacheReuseRatio > 1) {
    throw new Error('CacheAwareConfig: minCacheReuseRatio must be in [0, 1]')
  }

  return deepFreeze({
    enableCacheOptimization,
    cachePreservationPriority,
    minCacheReuseRatio,
    enabled,
  })
}
