/**
 * Model-facing intent-guard tool: lets the agent explicitly query drift status.
 *
 * @module @deepseek-ai/dsh-tool-intent-guard
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { StepRecord } from '@deepseek-ai/dsh-intent-guard'

export const name = 'tool-intent-guard'

/** Services this plugin injects. */
export const inject = ['tools', 'intentGuard']

export interface Config {
  /** Whether to enable the model-facing tool (default true). */
  enabled?: boolean
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
})

export function apply(ctx: Context, config: Config): void {
  if (!(config.enabled as boolean)) return

  const guard = ctx.get('intentGuard')
  if (guard === undefined) return

  ctx.tools.register(defineTool({
    name: 'intent_guard',
    description: [
      'Query the current intent drift status for your active goal.',
      'Returns the goal objective (if any), the latest drift signal (if detected),',
      'and a recommendation on whether to continue or adjust your approach.',
      'Use this when you suspect your actions may have drifted from the original goal,',
      'or after completing a major sub-task to verify alignment.',
    ].join(' '),
    parameters: {
      step_summary: {
        type: 'string',
        required: true,
        description: 'A one-sentence summary of what you just accomplished in this step.',
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          has_goal: { type: 'boolean' },
          goal_objective: { type: 'string' },
          drift_detected: { type: 'boolean' },
          drift_kind: { type: 'string' },
          drift_message: { type: 'string' },
          drift_severity: { type: 'number' },
          recommendation: { type: 'string' },
        },
        required: ['has_goal', 'drift_detected', 'recommendation'],
        additionalProperties: false,
      },
      render(_args, value) {
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
      },
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        return { has_goal: false, drift_detected: false, recommendation: 'No agent context available.' }
      }

      const goalObjective = guard.getGoalObjective(agent)
      const step: StepRecord = {
        step: 0,
        success: true,
        summary: args.step_summary,
        timestamp: Date.now(),
      }

      const result = await guard.observe(agent, step)

      if (!result.signal) {
        return {
          has_goal: goalObjective !== undefined,
          ...goalObjective === undefined ? {} : { goal_objective: goalObjective },
          drift_detected: false,
          recommendation: goalObjective
            ? 'Your recent step aligns with your goal. Continue.'
            : 'No active goal declared. Create one with /goal if needed.',
        }
      }

      const signal = result.signal
      const recommendation = signal.severity >= 0.7
        ? 'STOP and reassess. Your actions have significantly diverged from your goal. Consider clearing and re-declaring your objective.'
        : signal.severity >= 0.4
          ? 'CAUTION: moderate drift detected. Review your recent steps against the goal before proceeding.'
          : 'Mild drift. Monitor but continue — adjust if drift increases.'

      return {
        has_goal: goalObjective !== undefined,
        ...goalObjective === undefined ? {} : { goal_objective: goalObjective },
        drift_detected: true,
        drift_kind: signal.kind,
        drift_message: signal.message,
        drift_severity: signal.severity,
        recommendation,
      }
    },
  }))
}
