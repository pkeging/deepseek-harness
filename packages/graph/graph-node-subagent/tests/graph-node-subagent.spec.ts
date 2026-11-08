import { describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentActivation, SubagentActivationSpec, SubagentResult } from '@deepseek-ai/dsh-subagent'
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

/** One settled activation carrying `result`; `dispose` is observable by the test. */
function activationOf(result: SubagentResult): SubagentActivation & { readonly dispose: Mock } {
  return {
    childId: SessionId('child-1'),
    name: 'agent-1',
    result: Promise.resolve(result),
    dispose: vi.fn(async () => {}),
  }
}

/** The subagent seam the provider sees; every test asserts on this stub. */
function makeStartActivation() {
  return vi.fn(async (_spec: SubagentActivationSpec) => activationOf({
    output: [{ type: 'text', text: 'node output' }],
    stopReason: 'completed',
  }))
}

async function setup(): Promise<{
  ctx: Context
  startActivation: ReturnType<typeof makeStartActivation>
  graphEngine: GraphEngine
}> {
  const ctx = new Context()
  await ctx.plugin(StubGraphEngine)
  const startActivation = makeStartActivation()
  ctx.provide('subagents', { startActivation })
  return { ctx, startActivation, graphEngine: ctx.graphEngine }
}

describe('graph-node-subagent provider', () => {
  it('registers a provider under "subagent" on ctx.graphEngine.graphNodeProviders', async () => {
    const { ctx } = await setup()
    apply(ctx, { subagentProviderName: 'test-subagent' })
    const provider = ctx.graphEngine.graphNodeProviders.get('subagent')!
    expect(provider).not.toBeNull()
  })

  it('starts one caller-delivered activation with the configured provider name', async () => {
    const { ctx, startActivation } = await setup()
    apply(ctx, { subagentProviderName: 'test-subagent' })
    const provider = ctx.graphEngine.graphNodeProviders.get('subagent')!
    expect(provider).not.toBeNull()
    const parent = fakeAgent()
    const signal = new AbortController().signal
    const request: GraphNodeRequest = {
      nodeId: GraphNodeId('n1'),
      label: 'Test node',
      inputs: { upstream: { value: 42 } },
      parent,
      signal,
    }
    await provider.execute(request)
    expect(startActivation).toHaveBeenCalledOnce()
    const spec = startActivation.mock.calls[0]![0]
    expect(spec.provider).toBe('test-subagent')
    expect(spec.label).toBe('Test node')
    expect(spec.parent).toBe(parent)
    expect(spec.signal).toBe(signal)
    expect(spec.delivery).toBe('caller')
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

  it('disposes the exact activation it started', async () => {
    const { ctx, startActivation } = await setup()
    const activation = activationOf({ output: [], stopReason: 'completed' })
    startActivation.mockResolvedValueOnce(activation)
    apply(ctx, { subagentProviderName: 'test-subagent' })
    const provider = ctx.graphEngine.graphNodeProviders.get('subagent') as GraphNodeProvider
    await provider.execute({
      nodeId: GraphNodeId('n1'),
      label: 'Test node',
      inputs: {},
      parent: fakeAgent(),
      signal: new AbortController().signal,
    })
    expect(activation.dispose).toHaveBeenCalledOnce()
  })

  it('returns success:false and error when the subagent stops with error', async () => {
    const { ctx, startActivation } = await setup()
    startActivation.mockResolvedValueOnce(activationOf({
      output: [],
      stopReason: 'error',
      diagnostic: 'model returned error',
    }))
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
    const { ctx, startActivation } = await setup()
    startActivation.mockRejectedValue(new Error('no subagent provider registered'))
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

  it('forwards the node signal to the activation', async () => {
    const { ctx, startActivation } = await setup()
    const abortController = new AbortController()
    apply(ctx, { subagentProviderName: 'test-subagent' })
    const provider = ctx.graphEngine.graphNodeProviders.get('subagent') as GraphNodeProvider
    abortController.abort()
    await provider.execute({
      nodeId: GraphNodeId('n4'),
      label: 'Aborted',
      inputs: {},
      parent: fakeAgent(),
      signal: abortController.signal,
    })
    expect(startActivation.mock.calls[0]![0].signal).toBe(abortController.signal)
  })

  it('serializes inputs into the prompt text', async () => {
    const { ctx, startActivation } = await setup()
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
    expect(startActivation).toHaveBeenCalledOnce()
    const [block] = startActivation.mock.calls[0]![0].prompt
    expect(block?.type).toBe('text')
    if (block?.type !== 'text') throw new Error('expected a text prompt block')
    expect(block.text).toContain('Data transform')
    expect(block.text).toContain('source')
    expect(block.text).toContain('count')
  })
})
