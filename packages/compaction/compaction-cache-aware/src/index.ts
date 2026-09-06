/**
 * KV cache-aware compaction strategy for the DeepSeek Harness.
 *
 * This plugin provides an enhanced compaction backend that considers the
 * provider's KV cache state when selecting compaction regions. It optimizes
 * for cache reuse by preferring regions that minimize cache invalidation.
 *
 * @module @deepseek-ai/dsh-compaction-cache-aware
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: the `compaction/*` SessionEventMap merge.
import type {} from '@deepseek-ai/dsh-compaction'
import type { Session } from '@deepseek-ai/dsh-session'
import { resolveConfig } from './config.ts'
import type { CacheAwareConfig, ResolvedCacheAwareConfig } from './types.ts'

export type { CacheAwareConfig, ResolvedCacheAwareConfig } from './types.ts'
export { resolveConfig } from './config.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    cacheAwareCompaction: CacheAwareCompaction
  }
}

/**
 * Cache-aware compaction strategy. Provides hints and metrics for optimizing
 * compaction decisions based on KV cache state.
 */
export class CacheAwareCompaction extends Service {
  static inject = ['llm']

  static Config: z<CacheAwareConfig> = z.object({
    enableCacheOptimization: z.boolean().default(true),
    cachePreservationPriority: z.number().min(0).max(1).default(0.7),
    minCacheReuseRatio: z.number().min(0).max(1).default(0.5),
    enabled: z.boolean().default(true),
  })

  readonly config: ResolvedCacheAwareConfig

  constructor(ctx: Context, config: CacheAwareConfig = {}) {
    super(ctx, 'cacheAwareCompaction')
    this.config = resolveConfig(config)
  }

  /**
   * Estimate the KV cache reuse ratio for a compaction region.
   * A higher ratio indicates more cache can be reused after compaction.
   * @param session - session to analyze.
   * @returns estimated cache reuse ratio in [0, 1], or undefined if uncomputable.
   */
  estimateCacheReuseRatio(
    session: Session,
  ): number | undefined {
    if (!this.config.enabled || !this.config.enableCacheOptimization) {
      return undefined
    }

    // Cache reuse is primarily determined by the system prompt and tool
    // schemas which remain unchanged across compaction. The ratio estimates
    // what fraction of the context window prefix survives compaction.
    const header = session.requestHeader()
    if (header === undefined) return undefined

    // Estimate prefix tokens (system + tools)
    const prefixTokens = this.estimatePrefixTokens(header)
    if (prefixTokens === 0) return undefined

    // Get total context capacity from provider
    // Context capacity is resolved at request time; here we return a
    // conservative estimate based on prefix ratio
    return Math.min(1, prefixTokens / 10000)
  }

  /**
   * Get compaction preference score for one region.
   * Ranges from 0 (avoid) to 1 (prefer).
   * @param session - session to analyze.
   * @returns preference score.
   */
  getRegionPreference(
    session: Session,
  ): number {
    const ratio = this.estimateCacheReuseRatio(session)
    if (ratio === undefined) return 0.5

    // Weight cache preservation according to config
    const priority = this.config.cachePreservationPriority
    return ratio * priority + (1 - ratio) * (1 - priority)
  }

  /**
   * Check if a compaction action is cache-friendly.
   * @param session - session to check.
   * @returns true if the action preserves sufficient cache.
   */
  isCacheFriendly(
    session: Session,
  ): boolean {
    const ratio = this.estimateCacheReuseRatio(session)
    if (ratio === undefined) return true
    return ratio >= this.config.minCacheReuseRatio
  }

  /**
   * Estimate token count of the conversation prefix (system + tools).
   * @param header - request header containing prefix information.
   * @returns estimated prefix token count.
   */
  private estimatePrefixTokens(header: { system?: string; tools?: unknown[] }): number {
    let tokens = 0
    // Rough estimate: 1 token per 4 characters for text
    const systemText = header.system ?? ''
    tokens += Math.ceil(systemText.length / 4)

    // Estimate tool schema tokens
    if (header.tools !== undefined) {
      for (const tool of header.tools) {
        if (tool !== null && typeof tool === 'object') {
          const toolStr = JSON.stringify(tool)
          tokens += Math.ceil(toolStr.length / 4)
        }
      }
    }

    return tokens
  }
}

export default CacheAwareCompaction
