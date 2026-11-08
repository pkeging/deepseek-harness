/**
 * Circuit-breaker guard plugin: detects consecutive failure patterns and forces
 * strategy change or halts the loop.
 *
 * Unlike `repeat-tool-reminder` (advisory only), this plugin can **block**
 * repeated failures and inject a mandatory context shift.
 *
 * @module @deepseek-ai/dsh-circuit-breaker
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageSource } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A message injected by a guard plugin rather than produced by the user or the model. */
    plugin: { kind: 'plugin'; plugin: string }
  }
}
import type { ToolExecution } from '@deepseek-ai/dsh-tools'

export const name = 'circuit-breaker'

/**
 * Plugin config. All fields are validated fail-loud at load time.
 */
export interface Config {
  /**
   * Consecutive-failure count that triggers a HALT (default 5).
   * When reached, the next tool call is blocked and a mandatory context shift
   * is injected.
   */
  failureThreshold?: number
  /**
   * Window of steps to consider for failure counting (default 10).
   * A failure older than `windowSize` steps does not count.
   */
  windowSize?: number
  /**
   * Tool-name patterns to track; empty means every tool is tracked.
   */
  include?: string[]
  /**
   * Tool-name patterns transparent to the chain (neither count nor reset).
   */
  exclude?: string[]
}

export const Config: z<Config> = z.object({
  failureThreshold: z.number().step(1).min(2).default(5),
  windowSize: z.number().step(1).min(3).default(10),
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
})

const PLUGIN_SOURCE: MessageSource = { kind: 'plugin', plugin: 'circuit-breaker' }

/**
 * A failure record: tool name and canonical arguments.
 */
interface FailureRecord {
  toolName: string
  canonicalArgs: string
}

/**
 * Per-agent failure chain state.
 */
interface ChainState {
  failures: FailureRecord[]
  halted: boolean
}

/**
 * Compile a `*`-wildcard pattern to an anchored RegExp.
 */
function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`)
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`)
}

/**
 * Deep key-sort of a parsed-JSON value for canonicalization.
 */
function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortJsonValue(record[key])
    }
    return sorted
  }
  return value
}

/**
 * Canonical string form of a call's arguments.
 */
function canonicalize(argumentsValue: unknown): string {
  return JSON.stringify(sortJsonValue(argumentsValue))
}

/**
 * Install the circuit-breaker listeners.
 */
export function apply(ctx: Context, config: Config): void {
  const failureThreshold = config.failureThreshold as number
  const includePatterns = (config.include as string[]).map(wildcardToRegExp)
  const excludePatterns = (config.exclude as string[]).map(wildcardToRegExp)

  /** Per-agent failure chain state, keyed by agent.id (Cordis events use different object instances per callback). */
  const chains = new Map<string, ChainState>()

  /** Whether a tool participates in the chain. */
  function tracked(toolName: string): boolean {
    if (includePatterns.length > 0 && !includePatterns.some(p => p.test(toolName))) return false
    return !excludePatterns.some(p => p.test(toolName))
  }

  /**
   * Check if the agent's circuit is open (halted).
   */
  function isHalted(agent: Agent): boolean {
    const state = chains.get(agent.id)
    return state?.halted ?? false
  }

  /**
   * Observe a tool execution result. If it's a failure, increment the counter.
   * If failures reach threshold, open the circuit.
   */
  function observe(exec: ToolExecution, isFailure: boolean): UserMessage | undefined {
    if (!exec.agent) return undefined
    if (!tracked(exec.name)) return undefined

    const canonical = canonicalize(exec.arguments)
    const prev = chains.get(exec.agent.id)
    const state = prev ?? { failures: [], halted: false }

    if (isFailure) {
      state.failures.push({
        toolName: exec.name,
        canonicalArgs: canonical,
      })
      chains.set(exec.agent.id, state)

      // Check if threshold reached
      if (state.failures.length >= failureThreshold && !state.halted) {
        state.halted = true
        chains.set(exec.agent.id, state)

        return createUserMessage({
          content: [{
            type: 'text',
            text: `[CIRCUIT BREAKER OPEN] You have failed ${state.failures.length} consecutive times on tool "${exec.name}". `
              + 'This indicates a broken approach. STOP repeating the same action. '
              + 'Read the file again, verify the exact variable name or path, and try a different strategy. '
              + 'Do not call this tool again until you have changed your approach.',
          }],
          source: { ...PLUGIN_SOURCE, form: 'notice', summary: 'circuit-breaker: HALT' },
        })
      }
    } else {
      // Success resets the chain
      if (state.halted) {
        state.halted = false
      }
      state.failures = []
      chains.set(exec.agent.id, state)
    }

    return undefined
  }

  /**
   * On pre-execute, block tool calls when the circuit is already open.
   */
  ctx.on('tools/pre-execute', async (exec: ToolExecution, next: () => Promise<import('@deepseek-ai/dsh-tools').PreToolDecision>): Promise<import('@deepseek-ai/dsh-tools').PreToolDecision> => {
    const halted = exec.agent ? isHalted(exec.agent) : false
    if (exec.agent && halted) {
      return {
        kind: 'deny',
        reason: `Circuit breaker is open for agent "${exec.agent.id}". Do not call tools until you change strategy.`,
      }
    }
    return next()
  })

  /**
   * On post-execute, check if the result indicates failure and act accordingly.
   */
  ctx.on('tools/post-execute', async (exec: ToolExecution, result: import('@deepseek-ai/dsh-tools').ToolExecutionResult, next: () => Promise<import('@deepseek-ai/dsh-tools').PostToolDecision>): Promise<import('@deepseek-ai/dsh-tools').PostToolDecision> => {
    const isFailure = result.isError
    const reminder = observe(exec, isFailure)
    const downstream = await next()

    if (!reminder) return downstream
    if (downstream.kind === 'block') {
      return {
        kind: 'block',
        feedback: downstream.feedback,
        additionalContexts: [reminder, ...(downstream.additionalContexts ?? [])],
      }
    }
    return {
      ...downstream,
      additionalContexts: [reminder, ...(downstream.additionalContexts ?? [])],
    }
  })

  /**
   * A user interjection changes context; reset the chain.
   */
  ctx.on('agent/pre-step', ({ agent, messages }: { agent: Agent; messages: import('@deepseek-ai/dsh-session').UserMessage[] }, next: () => Promise<import('@deepseek-ai/dsh-agent').PreStepDecision>): Promise<import('@deepseek-ai/dsh-agent').PreStepDecision> => {
    if (messages.some((m: import('@deepseek-ai/dsh-session').UserMessage) => m.source.kind === 'user')) {
      const state = chains.get(agent.id)
      if (state) {
        state.halted = false
        state.failures = []
      }
    }
    return next()
  })

  /**
   * Clean up chain state when an agent goes idle.
   */
  ctx.on('agent/status', ({ agent, status }: { agent: Agent; status: string }) => {
    if (status === 'idle') {
      chains.delete(agent.id)
    }
  })
}
