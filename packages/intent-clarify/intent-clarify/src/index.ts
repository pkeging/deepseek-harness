/**
 * Intent-clarify plugin: at turn boundaries, detects whether the agent's
 * recent trajectory has drifted from its declared goal and proactively
 * initiates a bidirectional clarification with the human user.
 *
 * Unlike intent-guard (which is advisory and inline), intent-clarify acts
 * as a **gating** plugin: when drift severity exceeds the confirmation
 * threshold, it pauses the next step and asks the user whether to continue
 * or adjust the goal.
 *
 * @module @deepseek-ai/dsh-intent-clarify
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type { StepRecord } from '@deepseek-ai/dsh-intent-guard'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A message injected by a guard plugin rather than produced by the user or the model. */
    plugin: { kind: 'plugin'; plugin: string }
  }
}
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

export const name = 'intent-clarify'

/** Services injected. */
export const inject = ['intentGuard']

export interface Config {
  /**
   * Drift severity threshold that triggers user clarification (default 0.6).
   * Below this value, drift is only logged as context; above it, the agent
   * is paused and asked to confirm whether to continue.
   */
  clarificationThreshold?: number
  /**
   * Minimum steps to accumulate before running a clarification check
   * (default 3 鈥?avoids noise on short sessions).
   */
  minStepsBeforeCheck?: number
  /**
   * If true, skip clarification when no goal is declared (default true).
   */
  skipWhenNoGoal?: boolean
}

export const Config: z<Config> = z.object({
  clarificationThreshold: z.number().min(0).max(1).default(0.6),
  minStepsBeforeCheck: z.number().step(1).min(1).default(3),
  skipWhenNoGoal: z.boolean().default(true),
})

const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'intent-clarify' }

/** Per-agent state: tracks steps since last clarification check. */
interface AgentState {
  stepsSinceLastCheck: number
  recentToolNames: string[]
}

/**
 * Install the intent-clarify plugin.
 *
 * Listens on `agent/turn-stopping` to run a drift check after each turn.
 * When drift exceeds the threshold, injects a model-visible message that
 * prompts the agent to call `ask_user_question` to clarify with the human.
 */
export function apply(ctx: Context, config: Config): void {
  const threshold = config.clarificationThreshold as number
  const minSteps = config.minStepsBeforeCheck as number
  const skipWhenNoGoal = config.skipWhenNoGoal as boolean

  const states = new WeakMap<Agent, AgentState>()

  ctx.on('tools/post-execute', (_exec: ToolExecution, _result: import('@deepseek-ai/dsh-tools').ToolExecutionResult, next: () => Promise<import('@deepseek-ai/dsh-tools').PostToolDecision>): Promise<import('@deepseek-ai/dsh-tools').PostToolDecision> => {
    void next()
    return Promise.resolve({ kind: 'accept' as const })
  })

  // Reset on user interjection
  ctx.on('agent/pre-step', async ({ agent, messages }, next: () => Promise<PreStepDecision>): Promise<PreStepDecision> => {
    if (messages.some(m => m.source.kind === 'user')) {
      states.delete(agent)
    }
    return next()
  })

  // Main check at turn boundary
  ctx.on('agent/turn-stopping', async ({ agent }) => {
    const s = states.get(agent) ?? { stepsSinceLastCheck: 0, recentToolNames: [] }
    if (s.stepsSinceLastCheck < minSteps) {
      return
    }

    // Skip if no goal declared
    const goalObjective = ctx.intentGuard.getGoalObjective(agent)
    if (skipWhenNoGoal && goalObjective === undefined) {
      states.set(agent, { ...s, stepsSinceLastCheck: 0 })
      return
    }

    // Run drift detection with a synthetic step summarizing recent activity
    const recentTools = [...s.recentToolNames].slice(-5).join(', ')
    const syntheticStep: StepRecord = {
      step: s.stepsSinceLastCheck,
      success: true,
      summary: `Recent tools: ${recentTools || 'none'}. Last ${minSteps} steps completed.`,
      timestamp: Date.now(),
    }

    const result = await ctx.intentGuard.observe(agent, syntheticStep)
    states.set(agent, { stepsSinceLastCheck: 0, recentToolNames: [] })

    if (result.signal === null) return
    if (result.signal.severity < threshold) return

    // Drift detected above threshold 鈥?inject clarification prompt
    const clarifyMsg = createUserMessage({
      content: [{
        type: 'text',
        text: '[INTENT CLARIFICATION REQUIRED] Your recent actions show significant drift from your declared goal.\n\n'
          + `Goal: "${goalObjective ?? ' (none declared)'}"\n`
          + `Drift type: ${result.signal.kind}\n`
          + `Severity: ${result.signal.severity.toFixed(2)}\n\n`
          + 'Before proceeding, use ask_user_question to clarify with the human:\n'
          + '1. Is the current goal still valid, or should it be updated?\n'
          + '2. Should you change your approach?\n'
          + 'Do NOT continue until this clarification is resolved.',
      }],
      source: { ...PLUGIN_SOURCE, form: 'notice', summary: 'intent-clarify' },
    })

    // Inject via agent.pre-step would be too late; instead we append to the
    // current step's outbox so it reaches the model in the next request.
    // The loop's agent/inject mechanism handles this.
    agent.inject(clarifyMsg)
    return
  })
}
