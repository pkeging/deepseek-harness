/**
 * Model-facing evaluator query tool: lets the agent explicitly request
 * an external evaluation of its current trajectory.
 *
 * @module @deepseek-ai/dsh-tool-evaluator
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { EvalStepRecord } from '@deepseek-ai/dsh-evaluator'

export const name = 'tool-evaluator'

/** Services this plugin injects. */
export const inject = ['tools', 'evaluator']

export interface Config {
  /** Window of recent steps to include in the evaluation (default 10). */
  windowSize?: number
  /** Whether to enable the tool (default true). */
  enabled?: boolean
}

export const Config: z<Config> = z.object({
  windowSize: z.number().step(1).min(1).default(10),
  enabled: z.boolean().default(true),
})

export function apply(ctx: Context, config: Config): void {
  if (!(config.enabled as boolean)) return

  const evaluator = ctx.get('evaluator')
  if (evaluator === undefined) return

  const windowSize = config.windowSize as number

  ctx.tools.register(defineTool({
    name: 'query_evaluator',
    description: [
      'Request an external evaluation of your current trajectory against your declared goal.',
      'The evaluator uses an INDEPENDENT analysis (not your own reasoning) to classify',
      'whether you are making progress, stalled, or drifting.',
      'Use this when you want an unbiased second opinion on your approach,',
      'or when you suspect your actions may have diverged from the goal.',
    ].join(' '),
    parameters: {
      recent_steps: {
        type: 'array',
        required: true,
        description: 'Recent tool calls you want evaluated. Each entry has tool_name, success, and summary.',
        items: {
          type: 'object',
          properties: {
            tool_name: { type: 'string' },
            success: { type: 'boolean' },
            summary: { type: 'string' },
          },
          required: ['success'],
          additionalProperties: false,
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          explanation: { type: 'string' },
          progress_score: { type: 'number' },
          suggestion: { type: 'string' },
        },
        required: ['category', 'explanation'],
        additionalProperties: false,
      },
      render(_args, value) {
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
      },
    },
    async execute(args, exec) {
      const agent = exec.agent

      const steps = ((args.recent_steps as Array<Record<string, unknown>>).map(s => ({
        toolName: s.tool_name as string | undefined,
        success: Boolean(s.success),
        summary: s.summary as string | undefined,
      })) as unknown as EvalStepRecord[])

      // Pull the goal from ctx.goals if available
      const goals = ctx.get('goals') as { get(a: Agent): { objective?: string } | undefined } | undefined
      const goalObjective = goals
        ? goals.get(agent ?? {} as Agent)?.objective
        : undefined

      const goal = goalObjective ?? 'No goal declared.'

      const result = await evaluator.evaluate({
        goal,
        steps: steps.slice(-windowSize),
        windowSize,
      })

      return result
    },
  }))
}
