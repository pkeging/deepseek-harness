import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import GraphEngine, {
  GraphError,
  GraphNodeId,
} from '@deepseek-ai/dsh-graph'
import type { GraphRun, GraphStartRequest } from '@deepseek-ai/dsh-graph'
import { apply } from '../src/index.ts'
import type { GraphNodeProvider, GraphNodeRequest } from '@deepseek-ai/dsh-graph'

/** Stub engine for test setup (same pattern as graph-engine.spec.ts). */
class StubGraphEngine extends GraphEngine {
  override start(_request: GraphStartRequest): GraphRun {
    void _request
    throw new Error('not under test')
  }
}

function fakeAgent(id = 'agent-1'): Agent {
  return { id: SessionId(id) } as unknown as Agent
}

function fakeSubagentProvider() {
  return {
    name: 'test-subagent',
    capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
    inheritsParentContext: false,
    start: vi.fn().mockResolvedValue({
      id: SessionId('child-1'),
      localAgent: undefined,
      result: Promise.resolve({
        output: [{ type: 'text', text: 'node output' }],
        stopReason: 'completed' as const,
      }),
      dispose: vi.fn(),
    }),
  }
}

async function setup(): Promise<{ ctx: Context; subagents: SubagentRuntime; graphEngine: GraphEngine }> {
  const ctx = new Context()
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(StubGraphEngine)
  ctx.subagents.registerProvider(fakeSubagentProvider())
  return { ctx, subagents: ctx.subagents, graphEngine: ctx.graphEngine }
}

describe('graph-node-subagent provider', () => {
  it('registers a provider under "subagent" on ctx.graphEngine.graphNodeProviders', async () => {
    const { ctx } = await setup()
    apply(ctx, { subagentProviderName: 'test-subagent' })
    const provider = ctx.graphEngine.graphNodeProviders.get('subagent')!
    expect(provider).not.toBeNull()
  })

  it('calls ctx.subagents.start with the configured provider name', async () => {
    const { ctx } = await setup()
    apply(ctx, { subagentProviderName: 'test-subagent' })
    const provider = ctx.graphEngine.graphNodeProviders.get('subagent')!
    expect(provider).not.toBeNull()
    const request: GraphNodeRequest = {
      nodeId: GraphNodeId('n1'),
      label: 'Test node',
      inputs: { upstream: { value: 42 } },
      parent: fakeAgent(),
      signal: new AbortController().signal,
    }
    await provider.execute(request)
  })

  it('returns success:true when the subagent completes', async () => {
    const { ctx } = await setup()
    apply(ctx, { subagentProviderName: 'test-subagent' })
    const provider = ctx.graphEngine.graphNodeProviders.get('subagent') as GraphNodeProvider
    const request: GraphNodeRequest = {
      nodeId: GraphNodeId('n1'),
      label: 'Test node',
      inputs: {},
      parent: fakeAgent(),
      signal: new AbortController().signal,
    }
    const result = await provider.execute(request)
    expect(result.success).toBe(true)
    expect(result.output).toBe('node output')
  })

  it('returns success:false and error when the subagent stops with error', async () => {
    const { ctx, subagents } = await setup()
    subagents.registerProvider({
      name: 'failing-provider',
      capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: vi.fn().mockResolvedValue({
        id: SessionId('child-fail'),
        localAgent: undefined,
        result: Promise.resolve({
          output: [],
          stopReason: 'error' as const,
          diagnostic: 'model returned error',
        }),
        dispose: vi.fn(),
      }),
    })
    apply(ctx, { subagentProviderName: 'failing-provider' })
    const provider = ctx.graphEngine.graphNodeProviders.get('subagent') as GraphNodeProvider
    const request: GraphNodeRequest = {
      nodeId: GraphNodeId('n2'),
      label: 'Failing node',
      inputs: {},
      parent: fakeAgent(),
      signal: new AbortController().signal,
    }
    const result = await provider.execute(request)
    expect(result.success).toBe(false)
    expect(result.error).toBe('model returned error')
  })

  it('throws GraphError when the subagent provider is missing', async () => {
    const { ctx } = await setup()
    apply(ctx, { subagentProviderName: 'nonexistent-provider' })
    const provider = ctx.graphEngine.graphNodeProviders.get('subagent') as GraphNodeProvider
    const request: GraphNodeRequest = {
      nodeId: GraphNodeId('n3'),
      label: 'Missing',
      inputs: {},
      parent: fakeAgent(),
      signal: new AbortController().signal,
    }
    await expect(provider.execute(request)).rejects.toThrow(GraphError)
    await expect(provider.execute(request)).rejects.toThrow('no subagent provider registered')
  })

  it('forwards signal abort to the subagent', async () => {
    const { ctx } = await setup()
    const abortController = new AbortController()
    apply(ctx, { subagentProviderName: 'test-subagent' })
    const provider = ctx.graphEngine.graphNodeProviders.get('subagent') as GraphNodeProvider
    const request: GraphNodeRequest = {
      nodeId: GraphNodeId('n4'),
      label: 'Aborted',
      inputs: {},
      parent: fakeAgent(),
      signal: abortController.signal,
    }
    abortController.abort()
    const result = await provider.execute(request)
    expect(result.success).toBe(true)
  })

  it('serializes inputs into the prompt text', async () => {
    const { ctx, subagents } = await setup()
    const mockStart = vi.fn().mockResolvedValue({
      id: SessionId('child-5'),
      localAgent: undefined,
      result: Promise.resolve({
        output: [{ type: 'text', text: 'ok' }],
        stopReason: 'completed' as const,
      }),
      dispose: vi.fn(),
    })
    subagents.registerProvider({
      name: 'inspect-provider',
      capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
      inheritsParentContext: false,
      start: mockStart,
    })
    apply(ctx, { subagentProviderName: 'inspect-provider' })
    const provider = ctx.graphEngine.graphNodeProviders.get('subagent')!
    expect(provider).not.toBeNull()
    const request: GraphNodeRequest = {
      nodeId: GraphNodeId('n5'),
      label: 'Data transform',
      inputs: { source: { url: 'https://example.com' }, count: 10 },
      parent: fakeAgent(),
      signal: new AbortController().signal,
    }
    await provider.execute(request)
    expect(mockStart).toHaveBeenCalledOnce()
    expect(mockStart.mock.calls[0]).toBeDefined()
    const args = mockStart.mock.calls[0]![0] as { prompt: Array<{ type: string; text: string }> }
    expect(args.prompt[0]!.type).toBe('text')
    expect(args.prompt[0]!.text).toContain('Data transform')
    expect(args.prompt[0]!.text).toContain('source')
    expect(args.prompt[0]!.text).toContain('count')
  })
})
