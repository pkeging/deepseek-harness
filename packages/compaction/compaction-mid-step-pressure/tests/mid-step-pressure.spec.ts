/**
 * @vitest-environment node
 *
 * Behavior suite for the mid-step pressure trigger: batch counting, the
 * threshold crossing that asks for one check, the counter reset after that
 * check, and the per-agent isolation that keeps one agent's burst from
 * compacting another agent's session.
 *
 * The compaction service is a stub, so these assertions cover this package's
 * trigger decisions. The engine's own pressure behavior is covered by
 * `dsh-compaction-basic`.
 *
 * @module @deepseek-ai/dsh-compaction-mid-step-pressure/tests
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { CompactionEngine } from '@deepseek-ai/dsh-compaction'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as MidStepPressure from '../src/index.ts'

/** An agent stand-in: the trigger only keys a WeakMap by object identity. */
function fakeAgent(id: string): Agent {
  return { id: SessionId(id) } as unknown as Agent
}

/** A completed-call stand-in carrying only the owner the trigger reads. */
function execution(agent: Agent): ToolExecution {
  return { agent } as unknown as ToolExecution
}

/** One completed tool result for `agent`, as the runtime emits it. */
function reportResult(ctx: Context, agent: Agent): void {
  ctx.emit('tools/result', execution(agent), {} as unknown as ToolExecutionResult)
}

/** Mount the trigger over a stub compaction service. */
async function harness(threshold: number): Promise<{
  ctx: Context
  compactIfNeeded: ReturnType<typeof vi.fn>
}> {
  const ctx = new Context()
  const compactIfNeeded = vi.fn(async () => null)
  ctx.provide('compaction', { compactIfNeeded } as unknown as CompactionEngine)
  await ctx.plugin(MidStepPressure, { threshold })
  return { ctx, compactIfNeeded }
}

describe('mid-step pressure trigger', () => {
  it('asks for one pressure check when a batch reaches the threshold', async () => {
    const { ctx, compactIfNeeded } = await harness(3)
    const agent = fakeAgent('a1')

    reportResult(ctx, agent)
    reportResult(ctx, agent)
    expect(compactIfNeeded).not.toHaveBeenCalled()

    reportResult(ctx, agent)
    await vi.waitFor(() => { expect(compactIfNeeded).toHaveBeenCalledTimes(1) })
    expect(compactIfNeeded.mock.calls[0]?.[1]).toBe('pressure')
  })

  it('counts the next batch from zero after a check', async () => {
    const { ctx, compactIfNeeded } = await harness(2)
    const agent = fakeAgent('a1')

    reportResult(ctx, agent)
    reportResult(ctx, agent)
    await vi.waitFor(() => { expect(compactIfNeeded).toHaveBeenCalledTimes(1) })

    // One more result is the first of a new batch, not the second of the old one.
    reportResult(ctx, agent)
    expect(compactIfNeeded).toHaveBeenCalledTimes(1)
    reportResult(ctx, agent)
    await vi.waitFor(() => { expect(compactIfNeeded).toHaveBeenCalledTimes(2) })
  })

  it('keeps one agent burst from triggering a check for another agent', async () => {
    const { ctx, compactIfNeeded } = await harness(3)
    const first = fakeAgent('a1')
    const second = fakeAgent('a2')

    reportResult(ctx, first)
    reportResult(ctx, second)
    reportResult(ctx, first)
    reportResult(ctx, second)
    expect(compactIfNeeded).not.toHaveBeenCalled()

    reportResult(ctx, first)
    await vi.waitFor(() => { expect(compactIfNeeded).toHaveBeenCalledTimes(1) })
    expect(compactIfNeeded.mock.calls[0]?.[0]).toMatchObject({ session: first.session })
  })

  it('restarts counting when the agent goes idle', async () => {
    const { ctx, compactIfNeeded } = await harness(3)
    const agent = fakeAgent('a1')

    reportResult(ctx, agent)
    reportResult(ctx, agent)
    ctx.emit('agent/status', { agent, status: 'idle' })
    reportResult(ctx, agent)
    reportResult(ctx, agent)
    expect(compactIfNeeded).not.toHaveBeenCalled()

    reportResult(ctx, agent)
    await vi.waitFor(() => { expect(compactIfNeeded).toHaveBeenCalledTimes(1) })
  })

  it('ignores results with no owning agent', async () => {
    const { ctx, compactIfNeeded } = await harness(1)
    ctx.emit('tools/result', execution(undefined as unknown as Agent), {} as unknown as ToolExecutionResult)
    expect(compactIfNeeded).not.toHaveBeenCalled()
  })
})
