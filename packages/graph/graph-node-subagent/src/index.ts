/**
 * Graph node provider backed by `ctx.subagents`. Each node execution becomes
 * one one-shot subagent delegation whose prompt carries the upstream node
 * outputs (JSON-serialized, one key per input) plus the node label.
 *
 * Registers itself on `ctx.graphEngine.graphNodeProviders` under the name
 * `'subagent'`. The subagent provider name used for
 * `ctx.subagents.startActivation()` is configurable via
 * {@link Config.subagentProviderName} (default: `'spawn'`).
 *
 * @module @deepseek-ai/dsh-graph-node-subagent
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SubagentActivation, SubagentResult } from '@deepseek-ai/dsh-subagent'
import type { GraphNodeProvider, GraphNodeRequest, GraphNodeResult } from '@deepseek-ai/dsh-graph'
import { GraphError } from '@deepseek-ai/dsh-graph'

export const name = 'graph-node-subagent'
export const inject = ['graphEngine', 'subagents']

/** Config for the subagent-backed graph node provider. */
export interface Config {
  /**
   * Name of the subagent provider to use for `ctx.subagents.startActivation()`.
   * Must be registered before this plugin applies. Defaults to `'spawn'`.
   */
  subagentProviderName: string
}

const DEFAULT_PROVIDER_NAME = 'spawn'

/**
 * Format a node's upstream inputs as a human-readable prompt block.
 * Each input key gets its own JSON-serialized section.
 */
function formatInputs(nodeLabel: string, inputs: Record<string, unknown>): string {
  const lines = [`Task: ${nodeLabel}`]
  const keys = Object.keys(inputs)
  if (keys.length > 0) {
    lines.push('')
    lines.push('Upstream inputs:')
    for (const key of keys) {
      const value = inputs[key]
      if (value === undefined || value === null) {
        lines.push(`\`${key}\`: (absent)`)
      } else {
        lines.push(`\`${key}\`: ${JSON.stringify(value, null, 2)}`)
      }
    }
  }
  return lines.join('\n')
}

/**
 * Extract text content from a subagent result's assistant output blocks.
 * Returns the concatenated text, or an empty string when no text is present.
 */
function extractText(result: SubagentResult): string {
  const textParts: string[] = []
  for (const block of result.output) {
    if (block.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text)
    }
  }
  return textParts.join('\n')
}

/**
 * One-shot subagent-backed {@link GraphNodeProvider}.
 *
 * Errors from the subagent seam (missing provider, capability mismatch, etc.)
 * are treated as fatal graph errors because they signal a configuration mistake,
 * not a recoverable node failure. Child-level model errors (stopReason !==
 * `'completed'`) become a `GraphNodeResult` with `success: false` so the
 * graph scheduler can apply the node's failure mode.
 */
class SubagentGraphNodeProvider implements GraphNodeProvider {
  constructor(
    private readonly subagentProviderName: string,
    private readonly ctx: Context,
  ) {}

  async execute(request: GraphNodeRequest): Promise<GraphNodeResult> {
    const promptText = formatInputs(request.label, request.inputs)
    const prompt: ContentBlock[] = [{ type: 'text', text: promptText }]
    const signal = request.signal

    let activation: SubagentActivation
    try {
      activation = await this.ctx.subagents.startActivation({
        provider: this.subagentProviderName,
        label: request.label,
        prompt,
        parent: request.parent,
        signal,
        // A graph node is a caller, not a model-facing step: only this provider
        // consumes the result.
        delivery: 'caller',
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      throw new GraphError(`subagent node ${JSON.stringify(request.nodeId)}: ${message}`, 'MISSING_PROVIDER')
    }

    try {
      const result = await activation.result
      const success = result.stopReason === 'completed'
      const nodeResult: import('@deepseek-ai/dsh-graph').GraphNodeResult = { success }
      if (success) nodeResult.output = extractText(result)
      else if (result.diagnostic) nodeResult.error = result.diagnostic
      return nodeResult
    } finally {
      await activation.dispose()
    }
  }
}

/**
 * Apply the subagent-backed graph node provider.
 *
 * @param ctx - Cordis context carrying `graphEngine` and `subagents`.
 */
export function apply(ctx: Context, config: Config = { subagentProviderName: DEFAULT_PROVIDER_NAME }): void {
  const provider = new SubagentGraphNodeProvider(
    config.subagentProviderName,
    ctx,
  )
  ctx.graphEngine.graphNodeProviders.register('subagent', provider)
}
