/**
 * Static rule-based evaluator provider for `ctx.evaluator`.
 *
 * Implements a deterministic rule engine (no LLM calls) that classifies
 * agent trajectory health based on tool-use patterns, failure rates, and
 * goal alignment heuristics.
 *
 * @module @deepseek-ai/dsh-evaluator-static
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { EvaluatorProvider, EvaluationRequest, EvaluationResult } from '@deepseek-ai/dsh-evaluator'
// Ensure the evaluator service augmentation is visible in this compilation unit.
import type {} from '@deepseek-ai/dsh-evaluator'

export const name = 'evaluator-static'

/** Services injected. */
export const inject = ['evaluator']

export interface Config {
  /** Consecutive failure ratio threshold for "progress-stalled" (default 0.5). */
  failureRatioThreshold?: number
  /** Minimum steps to evaluate (default 3). */
  minSteps?: number
  /** Tool names that always indicate stall when repeated consecutively (default ['read', 'grep']). */
  loopSignals?: string[]
}

export const Config: z<Config> = z.object({
  failureRatioThreshold: z.number().min(0).max(1).default(0.5),
  minSteps: z.number().step(1).min(1).default(3),
  loopSignals: z.array(z.string()).default(['read', 'grep', 'search']),
})

/**
 * Static rule-based evaluator provider.
 *
 * Implements three rules:
 * 1. High failure ratio 鈫?`progress-stalled`
 * 2. Repeated loop-signal tool 鈫?`approach-error`
 * 3. All-success with summaries 鈫?`progress-ok`
 */
export class EvaluatorStaticProvider implements EvaluatorProvider {
  readonly id = 'static'

  private readonly failureThreshold: number
  private readonly minSteps: number
  private readonly loopTools: Set<string>

  constructor(config: Config) {
    this.failureThreshold = config.failureRatioThreshold ?? 0.5
    this.minSteps = config.minSteps ?? 3
    this.loopTools = new Set(config.loopSignals ?? ['read', 'grep', 'search'])
  }

  /**
   * Synchronous evaluation 鈥?returns a resolved promise to satisfy the
   * EvaluatorProvider interface which requires `Promise<EvaluationResult>`.
   */
  // oxlint-disable-next-line require-await
  async evaluate(request: EvaluationRequest, signal?: AbortSignal): Promise<EvaluationResult> {
    if (signal?.aborted) throw new DOMException('cancelled', 'AbortError')

    const steps = request.steps
    if (steps.length === 0) {
      return { category: 'uncertain', explanation: 'No steps recorded yet; cannot evaluate.' }
    }

    // Rule 1: failure ratio
    const failures = steps.filter((s: { success: boolean }) => !s.success).length
    const failureRatio = failures / steps.length
    if (failureRatio >= this.failureThreshold && steps.length >= this.minSteps) {
      return {
        category: 'progress-stalled',
        explanation: `Failure ratio ${failureRatio.toFixed(2)} exceeds threshold ${this.failureThreshold}. ${failures}/${steps.length} recent steps failed. Reassess your approach.`,
        progressScore: Math.max(0, 1 - failureRatio),
        suggestion: 'Switch strategy. Review error messages from failed steps before proceeding.',
      }
    }

    // Rule 2: tool-loop detection
    const recentTools = steps.slice(-5).map((s: { toolName?: string }) => s.toolName).filter((t): t is string => t !== undefined)
    const lastTool = recentTools[recentTools.length - 1]
    if (lastTool !== undefined && this.loopTools.has(lastTool)) {
      const consecutiveSame = recentTools.filter((t: string) => t === lastTool).length
      if (consecutiveSame >= 3) {
        return {
          category: 'approach-error',
          explanation: `Repeated "${lastTool}" ${consecutiveSame} times in last ${recentTools.length} steps. This indicates a loop 鈥?the tool is not advancing the goal.`,
          progressScore: 0.2,
          suggestion: `Stop calling "${lastTool}". Try a different tool or gather more information before proceeding.`,
        }
      }
    }

    // Rule 3: clean progress
    if (steps.length >= this.minSteps && failures === 0) {
      const hasSummary = steps.some((s: { summary?: string }) => s.summary && s.summary.length > 0)
      if (hasSummary) {
        return {
          category: 'progress-ok',
          explanation: 'All recent steps succeeded with summaries. Trajectory looks healthy.',
          progressScore: 0.9,
        }
      }
    }

    // Default: uncertain
    return {
      category: 'uncertain',
      explanation: `Evaluated ${steps.length} steps; failure ratio ${failureRatio.toFixed(2)}. No clear signal 鈥?continue but stay alert.`,
      progressScore: 1 - failureRatio,
    }
  }
}

/**
 * Install the static evaluator provider on `ctx.evaluator`.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved: Config = {
    failureRatioThreshold: config.failureRatioThreshold ?? 0.5,
    minSteps: config.minSteps ?? 3,
    loopSignals: config.loopSignals ?? ['read', 'grep', 'search'],
  }
  ctx.evaluator.registerProvider(new EvaluatorStaticProvider(resolved))
}
