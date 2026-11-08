/**
 * Configuration vocabulary for the compaction-quality-verify plugin.
 *
 * @module @deepseek-ai/dsh-compaction-quality-verify/types
 */

/** Extractable fact categories to verify after compaction. */
export type FactCategory = 'file-paths' | 'error-messages' | 'numeric-values' | 'decisions'

/** Verification policy for one compaction event. */
export interface CompactionVerifyConfig {
  /**
   * Fact categories to extract and verify. Defaults to all categories.
   */
  factCategories?: FactCategory[]
  /**
   * Minimum summary text length (characters) to consider the summary viable.
   * Defaults to `16`.
   */
  minSummaryLength?: number
  /**
   * Maximum fraction of extracted facts that may be missing from the summary
   * before logging a warning. Defaults to `0.3` (30%).
   */
  maxMissingFactRatio?: number
  /**
   * Whether to run verification at all. Defaults to `true`.
   */
  enabled?: boolean
}

/** Validated, detached, deeply immutable verification configuration. */
export interface ResolvedVerifyConfig {
  readonly factCategories: readonly FactCategory[]
  readonly minSummaryLength: number
  readonly maxMissingFactRatio: number
  readonly enabled: boolean
}

/** One extracted fact and its verification outcome. */
export interface FactCheck {
  /** The fact category. */
  readonly category: FactCategory
  /** The extracted fact text (truncated to 120 chars). */
  readonly fact: string
  /** Whether the fact appears to be preserved in the summary. */
  readonly preserved: boolean
}

/** Result of one compaction quality verification call. */
export interface VerifyResult {
  /** The compaction id this result correlates with. */
  readonly compactionId: string
  /** The number of facts extracted from shadowed messages. */
  readonly factCount: number
  /** The number of facts preserved in the summary. */
  readonly preservedCount: number
  /** The fraction of facts missing from the summary. */
  readonly missingRatio: number
  /** Individual fact check results. */
  readonly facts: readonly FactCheck[]
  /** Warning message, when verification flagged a quality issue. */
  readonly warning?: string
}
