/**
 * Intent-guard service definition (`ctx.intentGuard`): drift detection seam
 * over goal declarations and step histories. L1 behavior patterns (repetition,
 * loop) and L2 semantic divergence (embedding cosine) are reported as
 * {@link DriftSignal} attached to step context.
 *
 * @module @deepseek-ai/dsh-intent-guard
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Stable branded id for one intent node. */
export type IntentNodeId = string & { __brand: 'IntentNodeId' }

/** Machine-routable drift classification. */
export type DriftKind =
  | 'semantic-divergence'
  | 'tool-mismatch'
  | 'pattern-repetition'
  | 'goal-regression'

/** One drift signal detected at a step boundary. */
export interface DriftSignal {
  /** Stable code for programmatic routing. */
  readonly code: string
  /** Human- and model-readable explanation. */
  readonly message: string
  /** Severity 0鈥?; 0 = no drift, 1 = hard block. */
  readonly severity: number
  readonly kind: DriftKind
}

/** Result of one drift detection pass. */
export interface DriftResult {
  /** null when no drift was detected above the silent threshold. */
  readonly signal: DriftSignal | null
  /** Whether the caller should ask the user for clarification. */
  readonly askUser: boolean
}

/** Intent guard error with a machine-routable code. */
export class IntentGuardError extends HarnessError {}

/**
 * The intent-guard service. Registered as `ctx.intentGuard`.
 */
export class IntentGuardService extends Service {
  static readonly inject = ['agents']

  private readonly _providers: IntentGuardProvider[] = []

  constructor(ctx: Context) {
    super(ctx, 'intentGuard')
  }

  /**
   * Register one drift detector provider. Providers run in registration order;
   * the first to return a non-null signal wins.
   * @param provider - the detection provider.
   * @returns disposer called on fiber unload.
   */
  registerProvider(provider: IntentGuardProvider): () => void {
    this._providers.push(provider)
    return () => {
      const idx = this._providers.indexOf(provider)
      if (idx !== -1) this._providers.splice(idx, 1)
    }
  }

  /** Read-only view of registered providers. */
  get providers(): ReadonlyArray<IntentGuardProvider> {
    return this._providers
  }

  /**
   * Run all registered providers against one step. Returns the first drift
   * signal (or null if none fired above the silent threshold).
   * @param agent - the calling agent.
   * @param step - the step record to evaluate.
   * @param signal - optional cancellation.
   * @returns the first provider's drift result; `askUser` is set once its
   *   severity reaches the confirmation threshold, and `signal` stays null when
   *   no provider detected drift.
   */
  async observe(agent: Agent, step: StepRecord, signal?: AbortSignal): Promise<DriftResult> {
    for (const provider of this._providers) {
      try {
        const result = await provider.detect(agent, step, signal)
        if (result !== null) {
          return { signal: result, askUser: result.severity >= 0.7 }
        }
      } catch {
        // Provider failure is contained 鈥?move to the next provider.
        continue
      }
    }
    return { signal: null, askUser: false }
  }

  /**
   * Read the current goal objective for one agent, if any is declared.
   * Uses duck-typing to avoid a hard dependency on dsh-goal.
   * @param agent - the agent to inspect.
   * @returns the objective string or undefined when no goal is active.
   */
  getGoalObjective(agent: Agent): string | undefined {
    const goals = this.ctx.get('goals') as { get(a: Agent): { objective?: string } | undefined } | undefined
    if (goals === undefined) return undefined
    const view = goals.get(agent)
    return view?.objective
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    intentGuard: IntentGuardService
  }
}

/** One step record observed by drift detectors. */
export interface StepRecord {
  /** Step number within the current turn (monotonic). */
  readonly step: number
  /** Tool name called in this step, if any. */
  readonly toolName?: string
  /** Canonical arguments string (deep-sorted JSON). */
  readonly arguments?: string
  /** Whether the tool call succeeded. */
  readonly success: boolean
  /** Textual summary of what the step accomplished (for embedding). */
  readonly summary?: string
  /** Timestamp in epoch ms. */
  readonly timestamp: number
}

/**
 * One drift detection provider. Registered with `ctx.intentGuard.registerProvider`.
 */
export interface IntentGuardProvider {
  /** Stable provider id (for diagnostics). */
  readonly id: string
  /**
   * Detect drift for one step. Return null when the step is within tolerance.
   */
  detect(agent: Agent, step: StepRecord, signal?: AbortSignal): Promise<DriftSignal | null>
}

export default IntentGuardService
