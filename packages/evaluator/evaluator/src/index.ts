/**
 * Evaluator service definition (`ctx.evaluator`): external evaluator seam
 * with independent context from the main agent.
 *
 * @module @deepseek-ai/dsh-evaluator
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Stable error class. */
export class EvaluatorError extends HarnessError {}

/** Machine-routable evaluation category. */
export type EvalCategory =
  | 'progress-ok'
  | 'progress-stalled'
  | 'goal-drift'
  | 'approach-error'
  | 'context-missing'
  | 'uncertain'

/** One external evaluation result. */
export interface EvaluationResult {
  /** Category classification. */
  readonly category: EvalCategory
  /** Human- and model-readable explanation. */
  readonly explanation: string
  /** Numerical progress score 0鈥?; null when indeterminate. */
  readonly progressScore?: number
  /** Suggested action for the agent (optional). */
  readonly suggestion?: string
}

/**
 * Step record as seen by the evaluator (minimal, stripped of internals).
 */
export interface EvalStepRecord {
  /** Tool name called. */
  readonly toolName?: string
  /** Whether the call succeeded. */
  readonly success: boolean
  /** One-line summary of what the step did. */
  readonly summary?: string
}

/**
 * Evaluation request. Carries only what the evaluator needs, never the full
 * agent context, to preserve independence.
 */
export interface EvaluationRequest {
  /** Goal objective text (from ctx.goals). */
  readonly goal: string
  /** Recent step history (last N steps). */
  readonly steps: readonly EvalStepRecord[]
  /** How many recent steps to include (default 10). */
  readonly windowSize?: number
}

/**
 * External evaluator provider. Registered with `ctx.evaluator.registerProvider`.
 * Must NOT depend on ctx.agent or ctx.tools directly 鈥?only on the explicit
 * request payload.
 */
export interface EvaluatorProvider {
  /** Stable provider id. */
  readonly id: string
  /**
   * Evaluate one request. Must not access the calling agent's live state.
   * @param request - the evaluation payload.
   * @param signal - optional cancellation.
   * @returns the evaluation result.
   */
  evaluate(request: EvaluationRequest, signal?: AbortSignal): Promise<EvaluationResult>
}

/**
 * The evaluator service. Registered as `ctx.evaluator`.
 *
 * Unlike `ctx.intentGuard` (which runs inline with the loop), the evaluator
 * is designed to run in a SEPARATE context 鈥?optionally using a different
 * model, seed, or even a non-LLM rule engine 鈥?so its judgment is independent
 * of the primary agent's reasoning chain.
 */
export class EvaluatorService extends Service {
  static readonly inject = []

  private readonly _providers: EvaluatorProvider[] = []

  constructor(ctx: Context) {
    super(ctx, 'evaluator')
  }

  /**
   * Register one evaluator provider. First provider wins on evaluate() calls;
   * additional providers can be registered for A/B testing.
   * @param provider - provider added to this runtime's registration order.
   * @returns disposer that removes the provider from this runtime.
   */
  registerProvider(provider: EvaluatorProvider): () => void {
    this._providers.push(provider)
    return () => {
      const idx = this._providers.indexOf(provider)
      if (idx !== -1) this._providers.splice(idx, 1)
    }
  }

  /** Read-only view of registered providers. */
  get providers(): ReadonlyArray<EvaluatorProvider> {
    return this._providers
  }

  /**
   * Run the primary evaluator against one request.
   * @param request - the evaluation payload.
   * @param signal - optional cancellation.
   * @returns the evaluation result.
   * @throws EvaluatorError when no provider is registered.
   */
  async evaluate(request: EvaluationRequest, signal?: AbortSignal): Promise<EvaluationResult> {
    if (this._providers.length === 0) {
      throw new EvaluatorError('no evaluator provider is registered', 'EVALUATOR_NO_PROVIDER')
    }
    // Use the first registered provider; in future versions this could
    // support weighted voting across providers.
    const first = this._providers[0]
    if (first === undefined) {
      // Guard against concurrent modification between length check and access.
      throw new EvaluatorError('no evaluator provider is registered', 'EVALUATOR_NO_PROVIDER')
    }
    return first.evaluate(request, signal)
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    evaluator: EvaluatorService
  }
}

export default EvaluatorService
