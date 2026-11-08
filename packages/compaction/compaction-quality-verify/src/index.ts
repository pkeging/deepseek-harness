/**
 * Compaction quality verification plugin.
 *
 * Listens to `compaction/end` events and verifies that key facts from shadowed
 * messages are preserved in the summary. Logs warnings when fact loss exceeds
 * the configured threshold.
 *
 * @module @deepseek-ai/dsh-compaction-quality-verify
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: the `compaction/*` SessionEventMap merge.
import type {} from '@deepseek-ai/dsh-compaction'
import type { SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import { resolveConfig } from './config.ts'
import type { CompactionVerifyConfig, ResolvedVerifyConfig, VerifyResult } from './types.ts'
import { extractFacts, checkFactPreservation } from './facts.ts'

/** Maximum retained extracted-text entries per session before the oldest are dropped. */
const EVENT_TEXT_LIMIT = 4096

export type { CompactionVerifyConfig, ResolvedVerifyConfig } from './types.ts'
export { resolveConfig } from './config.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    compactionQualityVerify: CompactionQualityVerify
  }
}

/**
 * Quality verification for compaction outcomes. Monitors `compaction/end`
 * events and runs lightweight fact-preservation checks against the summary.
 */
export class CompactionQualityVerify extends Service {
  static inject = ['sessions']

  static Config: z<CompactionVerifyConfig> = z.object({
    factCategories: z.array(z.union(['file-paths', 'error-messages', 'numeric-values', 'decisions'])).default(['file-paths', 'error-messages', 'numeric-values', 'decisions']),
    minSummaryLength: z.number().step(1).min(1).default(16),
    maxMissingFactRatio: z.number().min(0).max(1).default(0.3),
    enabled: z.boolean().default(true),
  })

  readonly config: ResolvedVerifyConfig
  /** Tracks compaction summary events for later verification. */
  private readonly pendingVerifications = new Map<string, { summary: string; shadowedSeqs: SessionSeq[] }>()
  /**
   * Extracted text per committed event, keyed by session then seq. Maintained
   * incrementally so verification reads owned state rather than the deprecated
   * synchronous history readers, and bounded because compaction shadows a
   * recent surface window rather than the whole log.
   */
  private readonly eventTextBySession = new WeakMap<object, Map<SessionSeq, string>>()

  constructor(ctx: Context, config: CompactionVerifyConfig = {}) {
    super(ctx, 'compactionQualityVerify')
    this.config = resolveConfig(config)
    this._registerListeners()
  }

  private _registerListeners(): void {
    const { ctx } = this
    // Retain each committed event's extracted text
    ctx.on('session/event', (session, event): undefined => {
      const text = this._extractEventText(event)
      if (text === undefined) return undefined
      const key = session as unknown as object
      let texts = this.eventTextBySession.get(key)
      if (texts === undefined) {
        texts = new Map()
        this.eventTextBySession.set(key, texts)
      }
      texts.set(event.seq, text)
      while (texts.size > EVENT_TEXT_LIMIT) {
        const oldest = texts.keys().next()
        if (oldest.done === true) break
        texts.delete(oldest.value)
      }
      return undefined
    })

    // Capture summary events for later verification
    ctx.on('session/event', (_session, event): undefined => {
      if (event.type !== 'compaction/summary') return undefined
      const data = event.data
      const summaryText = data.summary.map((b): string => b.type === 'text' ? b.text : '').join('\n')
      this.pendingVerifications.set(data.compactionId, {
        summary: summaryText,
        shadowedSeqs: data.shadowedSeqs,
      })
      return undefined
    })

    // Run verification when compaction ends
    ctx.on('session/event', (_session, event): undefined => {
      if (event.type !== 'compaction/end') return undefined
      if (!this.config.enabled) return undefined

      const data = event.data as { compactionId: string; error?: string }
      if (data.error !== undefined) return undefined

      const pending = this.pendingVerifications.get(data.compactionId)
      if (pending === undefined) return undefined
      this.pendingVerifications.delete(data.compactionId)

      const texts = this.eventTextBySession.get(_session) ?? new Map<SessionSeq, string>()
      const result = this._verify(data.compactionId, pending.summary, pending.shadowedSeqs, texts)
      this._reportResult(result)
      return undefined
    })
  }

  /**
   * Run fact preservation verification for one completed compaction.
   * @param compactionId - identity of the compaction.
   * @param summaryText - the generated summary text.
   * @param shadowedSeqs - surface seqs of shadowed messages.
   * @param eventText - maintained extracted text per event seq for one session.
   * @returns verification result with fact preservation stats.
   */
  private _verify(
    compactionId: string,
    summaryText: string,
    shadowedSeqs: readonly SessionSeq[],
    eventText: ReadonlyMap<SessionSeq, string>,
  ): VerifyResult {
    // Check summary length
    if (summaryText.length < this.config.minSummaryLength) {
      return {
        compactionId,
        factCount: 0,
        preservedCount: 0,
        missingRatio: 1,
        facts: [],
        warning: `Summary too short (${summaryText.length} chars, minimum ${this.config.minSummaryLength})`,
      }
    }

    // Extract facts from shadowed messages
    const shadowedTexts: string[] = []
    for (const seq of shadowedSeqs) {
      const text = eventText.get(seq)
      if (text !== undefined) shadowedTexts.push(text)
    }

    const sourceText = shadowedTexts.join('\n')
    const sourceFacts = extractFacts(sourceText, [...this.config.factCategories])

    // Check preservation
    const preservation = checkFactPreservation(sourceFacts, summaryText)
    type FactItem = { category: 'file-paths' | 'error-messages' | 'numeric-values' | 'decisions'; fact: string; preserved: boolean }
    const facts: FactItem[] = []
    let totalFacts = 0
    let preservedFacts = 0

    for (const [cat, catFacts] of sourceFacts) {
      const stats = preservation.get(cat) ?? { preserved: 0, total: 0 }
      totalFacts += stats.total
      preservedFacts += stats.preserved
      for (const fact of catFacts) {
        const preserved = stats.preserved > 0
        facts.push({ category: cat, fact, preserved })
        if (preserved) stats.preserved -= 1
      }
    }

    const missingRatio = totalFacts > 0 ? 1 - preservedFacts / totalFacts : 0
    const warning = missingRatio > this.config.maxMissingFactRatio
      ? `Fact preservation below threshold: ${(missingRatio * 100).toFixed(0)}% missing (limit ${(this.config.maxMissingFactRatio * 100).toFixed(0)}%)`
      : undefined

    return {
      compactionId,
      factCount: totalFacts,
      preservedCount: preservedFacts,
      missingRatio,
      facts,
      ...(warning !== undefined ? { warning } : {}),
    }
  }

  /**
   * Extract text content from a session event for fact extraction.
   * @param event - session event to extract text from.
   * @returns text content, or undefined if not extractable.
   */
  private _extractEventText(event: SessionEvent): string | undefined {
    switch (event.type) {
      case 'assistant/message':
        return event.data.message.content.map((b): string => b.type === 'text' ? b.text : '').join('\n')
      case 'user/message':
        return event.data.content.map((b): string => b.type === 'text' ? b.text : '').join('\n')
      case 'tool/result':
        // ToolResultMessage.content is [ToolResultBlock], extract text from block.content
        return event.data.message.content.map((b): string => b.type === 'text' ? b.text : '').join('\n')
      default:
        return undefined
    }
  }

  /**
   * Report verification result to logger.
   * @param result - verification outcome.
   */
  private _reportResult(result: VerifyResult): void {
    const { ctx } = this
    if (result.warning !== undefined) {
      ctx.logger.warn(
        `compaction-quality-verify [${result.compactionId}]: ${result.warning}`
        + ` (facts: ${result.preservedCount}/${result.factCount} preserved, missing ${(result.missingRatio * 100).toFixed(0)}%)`,
      )
    } else {
      ctx.logger.info(
        `compaction-quality-verify [${result.compactionId}]: OK`
        + ` (facts: ${result.preservedCount}/${result.factCount} preserved)`,
      )
    }
  }
}

export default CompactionQualityVerify
