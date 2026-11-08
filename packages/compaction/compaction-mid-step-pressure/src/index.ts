/**
 * Mid-step compaction pressure trigger.
 *
 * The basic engine checks pressure at step boundaries and after an overflow
 * error, so a burst of large parallel tool results inflates the durable request
 * between two boundaries without being observed. This plugin counts completed
 * tool results per agent and asks the compaction engine for one `pressure`
 * check once the batch reaches the configured size, so the burst is compacted
 * before the next request carries it.
 *
 * Mounting the plugin is the opt-in: an operator who does not want mid-step
 * checks leaves it out of the composition instead of setting a boolean.
 *
 * @module @deepseek-ai/dsh-compaction-mid-step-pressure
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
// Type-only: the `compaction` service and its `CompactionAgentContext` type.
import type {} from '@deepseek-ai/dsh-compaction'
// Type-only: makes `tools/result` available on `ctx.on()`.
import type {} from '@deepseek-ai/dsh-tools'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'compaction-mid-step-pressure'

/** Services this plugin injects. */
export const inject = ['compaction']

/** Mid-step pressure trigger configuration. */
export interface Config {
  /**
   * Completed tool results counted per agent before one pressure check runs.
   * Defaults to `3`, the batch size at which parallel calls typically push the
   * durable request past a step boundary's worth of growth.
   */
  threshold?: number
}

export const Config: z<Config> = z.object({
  threshold: z.number().step(1).min(1),
})

/**
 * Install the mid-step pressure trigger.
 * @param ctx - plugin context supplying the compaction service and logger.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const threshold = config.threshold ?? 3
  /** Completed tool results counted since the last check, per agent. */
  const resultCount = new WeakMap<Agent, number>()

  // A finished turn starts counting again, so a burst never spans two turns.
  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'idle') resultCount.delete(agent)
  })

  ctx.on('tools/result', (exec): undefined => {
    const agent = exec.agent
    if (agent === undefined) return undefined
    const count = (resultCount.get(agent) ?? 0) + 1
    if (count < threshold) {
      resultCount.set(agent, count)
      return undefined
    }
    resultCount.delete(agent)
    void checkPressure(ctx, agent)
    return undefined
  })
}

/**
 * Ask the compaction engine for one pressure check on behalf of one agent.
 * Never throws into the emitting listener, so the tool result always settles:
 * a failure warns and the turn continues. An agent whose route carries no
 * pressure configuration warns on every check rather than staying silent,
 * because mounting this trigger without a pressure policy is a composition
 * mistake the operator needs to see.
 * @param ctx - context owning the compaction service.
 * @param agent - agent whose completed result batch triggered the check.
 */
async function checkPressure(ctx: Context, agent: Agent): Promise<void> {
  try {
    const result = await ctx.compaction.compactIfNeeded(
      { session: agent.session, options: agent.options },
      'pressure',
      new AbortController().signal,
    )
    if (result === null) return
    ctx.logger.info(
      `compaction (mid-step pressure): shadowed ${result.shadowedSeqs.length} surface nodes `
      + `(seqs ${result.shadowedRange.start}-${result.shadowedRange.end}, `
      + `~${result.shadowedTokenCount} tokens)`,
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    ctx.logger.warn(`mid-step compaction failed: ${message}; continuing the turn`)
  }
}
