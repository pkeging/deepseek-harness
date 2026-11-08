import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as CircuitBreaker from '@deepseek-ai/dsh-circuit-breaker'
import type { Config } from '@deepseek-ai/dsh-circuit-breaker'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/**
 * Behavior suite for the circuit-breaker guard.
 */

async function harness(config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(CircuitBreaker, config)
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const d = ctx.on('agent/status', ({ agent: s, status: st }) => {
      if (s === agent && st === 'idle') { d(); resolve() }
    })
  })
}

/** All injected-context user messages from the agent's session log. */
function injectedMessages(agent: Agent): { text: string; source: unknown }[] {
  return [...agent.session.snapshotEvents()]
    .filter((e): e is import('@deepseek-ai/dsh-session').SessionEvent<'user/message'> =>
      e.type === 'user/message' && e.data.source.kind !== 'user')
    .map(e => ({
      text: e.data.content.map(block => block.type === 'text' ? block.text : '').join('|'),
      source: e.data.source,
    }))
}

describe('config validation', () => {
  it('rejects failureThreshold below 2 at load time', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(CircuitBreaker, { failureThreshold: 1 as unknown as number }))
      .rejects.toThrow(/failureThreshold/)
  })

  it('rejects windowSize below 3 at load time', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(CircuitBreaker, { windowSize: 1 as unknown as number }))
      .rejects.toThrow(/windowSize/)
  })
})

describe('circuit resets on success', () => {
  it('success after failures clears the chain preventing HALT', async () => {
    const ctx = await harness({ failureThreshold: 3 })
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    let calls = 0
    ctx.tools.register(defineContentToolFixture({
      name: 'edit', description: 'e',
      parameters: { q: { type: 'string', required: true } },
      async execute() {
        calls += 1
        if (calls <= 2) throw new Error('not found')
        return [{ type: 'text', text: 'ok' }]
      },
    }))
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'edit', { q: 'x' }),
      toolCallResponse('c2', 'edit', { q: 'x' }),
      toolCallResponse('c3', 'edit', { q: 'x' }), // succeeds → resets
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(injectedMessages(agent).some(m => m.text.includes('CIRCUIT BREAKER OPEN'))).toBe(false)
  })
})

describe('post-execute blocks when circuit is open', () => {
  it('returns block decision on tool calls after HALT is injected', async () => {
    const dispatched: string[] = []
    const ctx = await harness({ failureThreshold: 2 })
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    ctx.tools.register(defineContentToolFixture({
      name: 'edit', description: 'e',
      parameters: { q: { type: 'string', required: true } },
      async execute() { throw new Error('not found') },
    }))
    ctx.tools.register(defineContentToolFixture({
      name: 'read', description: 'r', parameters: {},
      async execute() {
        dispatched.push('read')
        return [{ type: 'text', text: 'ok' }]
      },
    }))
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'edit', { q: 'x' }),
      toolCallResponse('c2', 'edit', { q: 'x' }),
      toolCallResponse('c3', 'read', {}), // should be blocked
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(dispatched).not.toContain('read')
  })
})

describe('exclude patterns', () => {
  it('excluded tools do not participate in the failure chain', async () => {
    const ctx = await harness({ failureThreshold: 2, exclude: ['other'] })
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    let editCalls = 0
    ctx.tools.register(defineContentToolFixture({
      name: 'edit', description: 'e',
      parameters: { q: { type: 'string', required: true } },
      async execute() {
        editCalls += 1
        throw new Error('not found')
      },
    }))
    ctx.tools.register(defineContentToolFixture({
      name: 'other', description: 'o', parameters: {},
      async execute() { throw new Error('also broken') },
    }))
    const adapter = new MockAdapter([
      toolCallResponse('c1', 'edit', { q: 'x' }),
      toolCallResponse('c2', 'other', {}), // excluded → invisible
      toolCallResponse('c3', 'edit', { q: 'x' }), // 2nd tracked failure → HALT
      textResponse('done'),
    ])
    ctx.llm.registerAdapter(['mock'], adapter)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    // edit was called 2 times (the excluded 'other' call doesn't count; 2 failures trigger HALT)
    expect(editCalls).toBe(2)
  })
})
