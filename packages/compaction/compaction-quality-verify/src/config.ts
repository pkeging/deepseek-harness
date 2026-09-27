/**
 * Configuration resolution for compaction-quality-verify.
 *
 * @module @deepseek-ai/dsh-compaction-quality-verify/config
 */

import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { CompactionVerifyConfig, ResolvedVerifyConfig } from './types.ts'

/** Fixed default configuration. */
export const DEFAULTS: ResolvedVerifyConfig = deepFreeze({
  factCategories: ['file-paths', 'error-messages', 'numeric-values', 'decisions'],
  minSummaryLength: 16,
  maxMissingFactRatio: 0.3,
  enabled: true,
})

const CONFIG_KEYS: ReadonlySet<string> = new Set([
  'factCategories',
  'minSummaryLength',
  'maxMissingFactRatio',
  'enabled',
])

/**
 * Validate and resolve compaction quality verification configuration.
 * @param config - untrusted plugin configuration.
 * @returns detached immutable resolved config.
 */
export function resolveConfig(config: CompactionVerifyConfig = {}): ResolvedVerifyConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Error(`CompactionVerifyConfig: unknown key "${key}"`)
    }
  }

  const factCategories = config.factCategories ?? DEFAULTS.factCategories
  const minSummaryLength = config.minSummaryLength ?? DEFAULTS.minSummaryLength
  const maxMissingFactRatio = config.maxMissingFactRatio ?? DEFAULTS.maxMissingFactRatio
  const enabled = config.enabled ?? DEFAULTS.enabled

  if (!Number.isInteger(minSummaryLength) || minSummaryLength < 1) {
    throw new Error('CompactionVerifyConfig: minSummaryLength must be a positive integer')
  }
  if (typeof maxMissingFactRatio !== 'number' || maxMissingFactRatio <= 0 || maxMissingFactRatio > 1) {
    throw new Error('CompactionVerifyConfig: maxMissingFactRatio must be in (0, 1]')
  }
  if (!Array.isArray(factCategories) || factCategories.length === 0) {
    throw new Error('CompactionVerifyConfig: factCategories must be a non-empty array')
  }
  for (const cat of factCategories) {
    const validCategories = ['file-paths', 'error-messages', 'numeric-values', 'decisions'] as const
    if (!validCategories.includes(cat as typeof validCategories[number])) {
      throw new Error(`CompactionVerifyConfig: unknown fact category "${cat}"`)
    }
  }

  return deepFreeze({
    factCategories,
    minSummaryLength,
    maxMissingFactRatio,
    enabled,
  })
}
