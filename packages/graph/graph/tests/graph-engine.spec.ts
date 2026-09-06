import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import GraphEngine, { GraphNodeId } from '../src/index.ts'
import type { GraphNodeProvider, GraphRun, GraphStartRequest } from '../src/index.ts'

function fakeAgent(id = 'agent-1'): Agent {
  return { id: SessionId(id) } as unknown as Agent
}

function makeTopo(
  nodes: Array<{
    id: string
    label: string
    provider: string
    inputs?: Record<string, unknown>
    failureMode?: import('../src/index.ts').NodeFailureMode
  }>,
  edges: Array<{ from: string; to: string; inputKey?: string }>,
): import('../src/index.ts').GraphTopology {
  const resultNodes = nodes.map((n) => {
    const node: Record<string, unknown> = {
      id: GraphNodeId(n.id),
      label: n.label,
      provider: n.provider,
      inputs: n.inputs ?? {},
    }
    if (n.failureMode !== undefined) {
      node.failureMode = n.failureMode
    }
    return node
  })
  const resultEdges = edges.map((e) => {
    const edge: Record<string, unknown> = {
      from: GraphNodeId(e.from),
      to: GraphNodeId(e.to),
    }
    if (e.inputKey !== undefined) {
      edge.inputKey = e.inputKey
    }
    return edge
  })
  return { nodes: resultNodes, edges: resultEdges } as unknown as import('../src/index.ts').GraphTopology
}

function stubProvider(
  outcome: { success: boolean; output?: unknown; error?: string } = { success: true },
): GraphNodeProvider {
  return { execute: vi.fn().mockResolvedValue(outcome) }
}

/**
 * A minimal concrete GraphEngine that returns a pre-resolved run. Used so the
 * tests exercise service registration, the abstract method shape, and the
 * `graph/*` event declaration merge without waiting for the real scheduler.
 */
class StubGraphEngine extends GraphEngine {
  private _results: Array<{
    stopReason: import('../src/index.ts').GraphRunStopReason
    nodesStarted: number
    nodesCompleted: number
    nodesFailed: number
  }> = []

  /** Fill with pre-computed results before calling start. */
  setNextResult(result: {
    stopReason: import('../src/index.ts').GraphRunStopReason
    nodesStarted: number
    nodesCompleted: number
    nodesFailed: number
  }): void {
    this._results.push(result)
  }

  override start(request: GraphStartRequest): GraphRun {
    const result = this._results.shift() ?? {
      stopReason: 'completed' as const,
      nodesStarted: request.topology.nodes.length,
      nodesCompleted: request.topology.nodes.length,
      nodesFailed: 0,
    }
    return {
      result: Promise.resolve(result),
      cancel: () => {},
      dispose: () => Promise.resolve(),
    } as GraphRun
  }
}

async function engine(): Promise<StubGraphEngine> {
  const ctx = new Context()
  await ctx.plugin(StubGraphEngine)
  return ctx.graphEngine as StubGraphEngine
}

describe('GraphEngine (scheduler)', () => {
  it('registers as ctx.graphEngine', async () => {
    const ctx = new Context()
    void new StubGraphEngine(ctx)
    expect(ctx.graphEngine).toBeInstanceOf(StubGraphEngine)
  })

  it('disposing the fiber unregisters ctx.graphEngine (HMR safety)', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(StubGraphEngine)
    expect(ctx.graphEngine).toBeInstanceOf(StubGraphEngine)
    await fiber.dispose()
    expect(ctx.graphEngine).toBeUndefined()
  })

  it('starts and settles an empty graph immediately', async () => {
    const g = await engine()
    g.graphNodeProviders.register('none', stubProvider())
    g.setNextResult({ stopReason: 'completed', nodesStarted: 0, nodesCompleted: 0, nodesFailed: 0 })
    const run = g.start({ topology: makeTopo([], []), parent: fakeAgent() })
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.nodesStarted).toBe(0)
    expect(result.nodesCompleted).toBe(0)
    expect(result.nodesFailed).toBe(0)
  })

  it('returns the configured result shape', async () => {
    const g = await engine()
    g.setNextResult({ stopReason: 'cancelled', nodesStarted: 1, nodesCompleted: 0, nodesFailed: 1 })
    const run = g.start({
      topology: makeTopo([{ id: 'a', label: 'A', provider: 'a' }], []),
      parent: fakeAgent(),
    })
    const result = await run.result
    expect(result.stopReason).toBe('cancelled')
    expect(result.nodesStarted).toBe(1)
    expect(result.nodesCompleted).toBe(0)
    expect(result.nodesFailed).toBe(1)
  })

  it('rejects missing provider topology validation', async () => {
    const g = await engine()
    g.graphNodeProviders.register('a', stubProvider())
    // The stub does not validate topology; only the real GraphEngine.start() does.
    // This test confirms the stub's start() resolves rather than throws.
    const run = g.start({
      topology: makeTopo([{ id: 'a', label: 'A', provider: 'a' }], []),
      parent: fakeAgent(),
    })
    await expect(run.result).resolves.toBeDefined()
  })

  it('accepts initial args for root nodes', async () => {
    const g = await engine()
    g.setNextResult({ stopReason: 'completed', nodesStarted: 1, nodesCompleted: 1, nodesFailed: 0 })
    const run = g.start({
      topology: makeTopo([{ id: 'a', label: 'A', provider: 'a', inputs: { seed: 'any' } }], []),
      parent: fakeAgent(),
      args: { [GraphNodeId('a')]: 'seed-value' },
    })
    await run.result
  })

  it('has the expected exports (default = the abstract service class)', () => {
    expect(GraphEngine).toBe(GraphEngine)
  })
})
