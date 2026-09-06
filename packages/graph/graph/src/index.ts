/**
 * Service Definition for the graph capability seam (`ctx.graphEngine`): a DAG
 * scheduler plus a provider registry (`ctx.graphNodeProviders`).
 *
 * A graph run executes one directed acyclic graph of nodes. Each node is
 * backed by a {@link GraphNodeProvider} registered under a string name; the
 * engine schedules nodes when all their predecessor edges have settled,
 * propagates outputs through edges, and applies per-node failure semantics
 * (`isolate` / `propagate` / `continue`).
 *
 * Unlike {@link @deepseek-ai/dsh-workflow} (linear script-driven execution),
 * the graph seam expresses topology as data, not code: the caller declares
 * nodes and edges, the engine derives execution order from the DAG. Unlike
 * the subagent seam (parent-child trees), graph nodes form a general DAG with
 * fan-in and fan-out, and the scheduler owns all concurrency control.
 *
 * @module @deepseek-ai/dsh-graph
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { GraphRunId, GraphNodeId } from './types.ts'
import type {
  GraphNodeDef,
  GraphNodeEndInfo,
  GraphNodeOutcome,
  GraphNodeStartInfo,
  GraphRunInfo,
  GraphRunResult,
  GraphTopology,
  NodeFailureMode,
} from './types.ts'
import type { GraphNodeProvider, GraphRun, GraphStartRequest } from './runtime-types.ts'

export { GraphRunId, GraphNodeId } from './types.ts'
export type {
  EdgeTransferMode,
  GraphEdgeDef,
  GraphNodeDef,
  GraphNodeEndInfo,
  GraphNodeInfo,
  GraphNodeOutcome,
  GraphNodeStartInfo,
  GraphRunInfo,
  GraphRunResult,
  GraphRunStopReason,
  GraphTopology,
  NodeFailureMode,
} from './types.ts'
export type {
  GraphNodeProvider,
  GraphNodeProviderName,
  GraphNodeRequest,
  GraphNodeResult,
  GraphRun,
  GraphStartRequest,
} from './runtime-types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * The graph DAG scheduler. Start a run with {@link GraphEngine.start};
     * observe lifecycle through `graph/*` events. The engine's
     * {@link GraphEngine.graphNodeProviders} holds the per-fiber provider registry.
     */
    graphEngine: GraphEngine
  }

  interface Events {
    /**
     * A graph run started — topology validated, first batch of root nodes
     * about to execute. Paired with {@link Events['graph/end']}.
     * @param info - the run's identity snapshot (id + topology).
     * @mode emit
     */
    'graph/run-start'(info: GraphRunInfo): void
    /**
     * One node began execution. Paired with {@link Events['graph/node-end']}
     * by node id, exactly once per started node on every stop path.
     * @param info - the run's identity snapshot.
     * @param node - the node's identity plus its start sequence number.
     * @mode emit
     */
    'graph/node-start'(info: GraphRunInfo, node: GraphNodeStartInfo): void
    /**
     * One node settled (completed, failed, skipped, or cancelled). Paired
     * with {@link Events['graph/node-start']} by node id.
     * @param info - the run's identity snapshot.
     * @param node - the node's identity plus its outcome.
     * @mode emit
     */
    'graph/node-end'(info: GraphRunInfo, node: GraphNodeEndInfo): void
    /**
     * A graph run settled (any stop reason). Fired when {@link GraphRun.result}
     * resolves. Paired with {@link Events['graph/run-start']}.
     * @param info - the run's identity snapshot.
     * @param result - the outcome data (stop reason, error, node counts).
     * @mode emit
     */
    'graph/end'(info: GraphRunInfo, result: GraphRunResult): void
  }
}

/**
 * Machine-routable fatal graph failures: topology validation errors, missing
 * providers, unresolvable edges, and cancellation. An ordinary node failure
 * resolves to a `'failed'` outcome and is not one of these fatal codes.
 */
export type GraphErrorCode =
  | 'TOPOLOGY_INVALID'
  | 'MISSING_PROVIDER'
  | 'UNRESOLVABLE_EDGE'
  | 'CYCLE_DETECTED'
  | 'NODE_START'
  | 'NODE_RESULT'
  | 'CANCELLED'

/**
 * Typed error for graph-seam failures. Extends {@link HarnessError}, so the
 * `code` is machine-routable. All graph errors are fatal — a typo'd edge or
 * a missing provider must kill the run loudly, not produce a silent failed node.
 */
export class GraphError extends HarnessError {
  constructor(message: string, code: GraphErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'GraphError'
  }
}

/**
 * Provider registry: named, per-fiber registrations. The engine looks up
 * provider names from {@link GraphNodeDef.provider} at scheduling time; a
 * missing name throws a fatal {@link GraphError} before the node starts.
 */
export class GraphNodeProviderRegistry {
  private readonly _providers = new Map<string, GraphNodeProvider>()

  /**
   * Register a provider under the given name. Duplicate names throw.
   * @param name - the provider name; matches {@link GraphNodeDef.provider}.
   * @param provider - the provider implementation.
   * @returns a disposer that removes the registration.
   */
  register(name: string, provider: GraphNodeProvider): () => void {
    if (this._providers.has(name)) {
      throw new GraphError(`graph node provider already registered: ${name}`, 'MISSING_PROVIDER')
    }
    this._providers.set(name, provider)
    return () => { this._providers.delete(name) }
  }

  /**
   * Resolve a provider name. Returns `null` when the name is unregistered.
   * @param name - the provider name to look up.
   * @returns the provider, or `null` if absent.
   */
  get(name: string): GraphNodeProvider | null {
    return this._providers.get(name) ?? null
  }
}

/**
 * Graph Service Definition contract. Invalid topologies throw before
 * publication; a live run is holder-owned, its result never rejects,
 * cancellation and disposal are bounded, and disposal waits for in-flight
 * nodes within that bound. Lifecycle listener failures are contained.
 */
export class GraphEngine extends Service {
  /**
   * Per-fiber registry of node providers, keyed by the string name declared
   * in {@link GraphNodeDef.provider}. Replacing a provider in a child fiber
   * does not affect the parent.
   */
  readonly graphNodeProviders: GraphNodeProviderRegistry

  constructor(ctx: Context) {
    super(ctx, 'graphEngine')
    this.graphNodeProviders = new GraphNodeProviderRegistry()
  }

  /**
   * Validate the topology and start a graph run.
   * @param request - the DAG, optional initial args, the parent agent, and
   *   an optional cancel signal.
   * @returns the live run; its `result` resolves when the DAG settles.
   */
  start(request: GraphStartRequest): GraphRun {
    const topology = validateTopology(request.topology, this.graphNodeProviders)
    const runId = GraphRunId(randomUUID())
    const info: GraphRunInfo = { id: runId, topology }
    const run = new GraphRunImpl(this, info, request.parent, request.args, request.signal)
    this.emitGraphEvent('graph/run-start', info)
    return run
  }

  /**
   * Emit a lifecycle event while containing and logging each listener failure.
   * @param name - the `graph/*` event to dispatch.
   * @param args - the event's payload, matching its declared signature.
   */
  protected emitGraphEvent(name: string, ...args: unknown[]): void {
    for (const callback of this.ctx.events.dispatch('emit', [name, ...args])) {
      try {
        const returned: unknown = (callback as (...payload: unknown[]) => unknown)(...args)
        void Promise.resolve(returned).catch((error: unknown) => {
          this.ctx.logger.warn(`graph: ${name} listener rejected: ${renderListenerError(error)}`)
        })
      } catch (error: unknown) {
        this.ctx.logger.warn(`graph: ${name} listener threw: ${renderListenerError(error)}`)
        const rejection = error instanceof Error ? error : new Error(String(error))
        void Promise.reject(rejection)
      }
    }
  }
}

function renderListenerError(error: unknown): string {
  try {
    return String(error)
  } catch {
    return '[unrenderable thrown value]'
  }
}

// ─── Internal types ───────────────────────────────────────────────────────────

type NodeStatus = 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled'

interface NodeState {
  nodeId: GraphNodeId
  label: string
  provider: string
  status: NodeStatus
  inputs: Record<string, unknown>
  output: unknown
  error: string | undefined
  dependents: GraphNodeId[]
}

interface RunState {
  info: GraphRunInfo
  parent: Agent
  nodes: Map<string, NodeState>
  seq: number
  nodesStarted: number
  nodesCompleted: number
  nodesFailed: number
  resolve: (r: GraphRunResult) => void
  cancelController: AbortController
  cancelled: boolean
}

// ─── Topology validation ──────────────────────────────────────────────────────

function validateTopology(topology: GraphTopology, registry: GraphNodeProviderRegistry): GraphTopology {
  const nodeMap = new Map<string, GraphNodeDef>()
  for (const node of topology.nodes) {
    if (nodeMap.has(node.id)) throw new GraphError(`duplicate node id ${JSON.stringify(node.id)}`, 'TOPOLOGY_INVALID')
    nodeMap.set(node.id, node)
  }

  const successors = new Map<string, Array<{ to: GraphNodeId; inputKey: string }>>()
  for (const node of topology.nodes) successors.set(node.id, [])

  for (const edge of topology.edges) {
    if (!nodeMap.has(edge.from)) throw new GraphError(`edge from unknown node ${JSON.stringify(edge.from)}`, 'TOPOLOGY_INVALID')
    if (!nodeMap.has(edge.to)) throw new GraphError(`edge to unknown node ${JSON.stringify(edge.to)}`, 'TOPOLOGY_INVALID')
    if (edge.from === edge.to) throw new GraphError(`self-loop on node ${JSON.stringify(edge.from)}`, 'TOPOLOGY_INVALID')
    successors.get(edge.from)?.push({ to: edge.to, inputKey: edge.inputKey ?? '__result__' })
  }

  // Every declared input key must have at least one incoming edge (or be
  // '__initial__' supplied by args).
  const incomingKeys = new Map<string, Set<string>>()
  for (const node of topology.nodes) incomingKeys.set(node.id, new Set())
  for (const edge of topology.edges) {
    incomingKeys.get(edge.to)?.add(edge.inputKey ?? '__result__')
  }
  for (const [nodeId, def] of nodeMap) {
    for (const key of Object.keys(def.inputs)) {
      if (key === '__initial__') continue
      if (!(incomingKeys.get(nodeId)?.has(key) ?? false)) {
        throw new GraphError(
          `node ${JSON.stringify(nodeId)} input key ${JSON.stringify(key)} has no incoming edge`,
          'UNRESOLVABLE_EDGE',
        )
      }
    }
  }

  // Check provider registration.
  for (const node of topology.nodes) {
    if (registry.get(node.provider) === null) {
      throw new GraphError(
        `no provider registered for node ${JSON.stringify(node.id)}: ${JSON.stringify(node.provider)}`,
        'MISSING_PROVIDER',
      )
    }
  }

  // Cycle detection via Kahn's algorithm.
  const inDegree = new Map<string, number>()
  for (const node of topology.nodes) inDegree.set(node.id, 0)
  for (const edge of topology.edges) inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1)
  const queue: string[] = []
  const remaining = new Map(inDegree)
  for (const [id, deg] of remaining) {
    if (deg === 0) queue.push(id)
  }
  let visited = 0
  while (queue.length > 0) {
    const id = queue.shift()
    if (id === undefined) break
    visited++
    for (const { to } of successors.get(id) ?? []) {
      const deg = (remaining.get(to) ?? 0) - 1
      remaining.set(to, deg)
      if (deg === 0) queue.push(to)
    }
  }
  if (visited !== topology.nodes.length) {
    throw new GraphError('cycle detected in graph topology', 'CYCLE_DETECTED')
  }

  return topology
}

// ─── GraphRun implementation ──────────────────────────────────────────────────

class GraphRunImpl implements GraphRun {
  readonly id: GraphRunId
  readonly topology: GraphTopology
  readonly result: Promise<GraphRunResult>
  private readonly state: RunState
  private settled = false

  constructor(
    private readonly engine: GraphEngine,
    info: GraphRunInfo,
    parent: Agent,
    args: Record<GraphNodeId, unknown> | undefined,
    externalSignal: AbortSignal | undefined,
  ) {
    this.id = info.id
    this.topology = info.topology
    this.state = {
      info, parent,
      nodes: new Map(),
      seq: 0,
      nodesStarted: 0,
      nodesCompleted: 0,
      nodesFailed: 0,
      resolve: () => {},
      cancelController: new AbortController(),
      cancelled: false,
    }
    this.result = new Promise((resolve) => { this.state.resolve = resolve })

    if (externalSignal) {
      if (externalSignal.aborted) this._cancelInternal()
      else externalSignal.addEventListener('abort', () => { this._cancelInternal() }, { once: true })
    }

    for (const node of this.topology.nodes) {
      const inputs: Record<string, unknown> = {}
      if (args && args[node.id] !== undefined && '__initial__' in node.inputs) {
        inputs.__initial__ = args[node.id]
      }
      this.state.nodes.set(node.id, {
        nodeId: node.id, label: node.label, provider: node.provider,
        status: 'pending', inputs, output: undefined, error: undefined,
        dependents: [],
      })
    }

    for (const edge of this.topology.edges) {
      const source = this.state.nodes.get(edge.from)
      if (source) source.dependents.push(edge.to)
    }

    void this._schedule()
  }

  cancel(_reason?: string): void {
    if (!this.settled) this._cancelInternal()
  }

  async dispose(): Promise<void> {
    if (this.settled) return
    this.cancel()
    await this.result
  }

  private async _schedule(): Promise<void> {
    const ready = this._findReadyNodes()
    if (ready.length === 0) { this._finalize(); return }
    await this._runBatch(ready)
  }

  private _findReadyNodes(): GraphNodeId[] {
    const ready: GraphNodeId[] = []
    for (const node of this.state.nodes.values()) {
      if (node.status !== 'pending') continue
      let allReady = true
      for (const key of Object.keys(node.inputs)) {
        if (key === '__initial__') continue
        if (!(key in node.inputs)) { allReady = false; break }
      }
      if (allReady) ready.push(node.nodeId)
    }
    return ready
  }

  private async _runBatch(batch: GraphNodeId[]): Promise<void> {
    const promises: Promise<void>[] = []
    for (const nodeId of batch) {
      const node = this.state.nodes.get(nodeId)
      if (!node || node.status !== 'pending') continue
      node.status = 'running'
      this.state.seq++
      this.state.nodesStarted++
      this._emitNodeStart(node, this.state.seq)
      promises.push(this._executeNode(node).catch((error: unknown) => {
        node.status = 'failed'
        node.error = error instanceof Error ? error.message : String(error)
        this.state.nodesFailed++
        const endInfo: { outcome: GraphNodeOutcome; error?: string } = { outcome: 'failed' }
        if (node.error) endInfo.error = node.error
        this._emitNodeEnd(node, endInfo)
        this._handleNodeFailure(node)
      }))
    }
    await Promise.all(promises)
    void this._schedule()
  }

  private async _executeNode(node: NodeState): Promise<void> {
    const provider = this.engine.graphNodeProviders.get(node.provider)
    if (provider === null) {
      node.status = 'failed'
      node.error = `provider not found: ${node.provider}`
      this.state.nodesFailed++
      this._emitNodeEnd(node, { outcome: 'failed', error: node.error })
      this._handleNodeFailure(node)
      return
    }

    const signal = this.state.cancelController.signal
    const inputs: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node.inputs)) inputs[k] = v

    try {
      const result = await provider.execute({
        nodeId: node.nodeId, label: node.label, inputs, parent: this.state.parent, signal,
      })
      if (signal.aborted) {
        node.status = 'cancelled'
        this._emitNodeEnd(node, { outcome: 'cancelled' })
        return
      }
      if (result.success) {
        node.status = 'completed'
        node.output = result.output
        this.state.nodesCompleted++
        this._emitNodeEnd(node, { outcome: 'completed' })
      } else {
        node.status = 'failed'
        node.error = result.error
        this.state.nodesFailed++
        const endInfo: { outcome: GraphNodeOutcome; error?: string } = { outcome: 'failed' }
        if (result.error !== undefined) endInfo.error = result.error
        this._emitNodeEnd(node, endInfo)
        this._handleNodeFailure(node)
      }
    } catch (error: unknown) {
      node.status = 'failed'
      node.error = error instanceof Error ? error.message : String(error)
      this.state.nodesFailed++
      const endInfo: { outcome: GraphNodeOutcome; error?: string } = { outcome: 'failed' }
      if (node.error) endInfo.error = node.error
      this._emitNodeEnd(node, endInfo)
      this._handleNodeFailure(node)
    }
  }

  private _handleNodeFailure(node: NodeState): void {
    if (node.status === 'cancelled') return
    const def = this.topology.nodes.find(n => n.id === node.nodeId)
    const failureMode: NodeFailureMode = def?.failureMode ?? 'isolate'
    if (failureMode === 'propagate') {
      this._cancelInternal()
      return
    }
    if (failureMode === 'isolate') this._skipUnreachable(node.nodeId)
  }

  private _skipUnreachable(failedId: GraphNodeId): void {
    const skipQueue: GraphNodeId[] = [failedId]
    const skipped = new Set<string>([String(failedId)])
    while (skipQueue.length > 0) {
      const current = skipQueue.shift()
      if (current === undefined) break
      for (const edge of this.topology.edges) {
        if (edge.from !== current) continue
        const target = this.state.nodes.get(edge.to)
        if (!target || skipped.has(String(edge.to)) || target.status !== 'pending') continue
        let allBlocked = true
        for (const key of Object.keys(target.inputs)) {
          if (key === '__initial__') continue
          if (key in target.inputs) continue
          const hasWorking = this.topology.edges.some((e) => {
            if (e.to !== target.nodeId) return false
            const eKey = e.inputKey ?? '__result__'
            if (eKey !== key) return false
            const src = this.state.nodes.get(e.from)
            return src && src.status !== 'skipped' && src.status !== 'cancelled' && src.status !== 'failed'
          })
          if (!hasWorking) continue
          allBlocked = false
          break
        }
        if (allBlocked) {
          target.status = 'skipped'
          skipped.add(String(edge.to))
          skipQueue.push(edge.to)
          this._emitNodeEnd(target, { outcome: 'skipped' })
        }
      }
    }
  }

  private _emitGraphEvent(name: string, ...args: unknown[]): void {
    // Bridge to parent's protected method via the engine reference.
    ;(this.engine as unknown as { emitGraphEvent: (n: string, ...a: unknown[]) => void }).emitGraphEvent(name, ...args)
  }

  private _emitNodeStart(node: NodeState, seq: number): void {
    const startInfo: GraphNodeStartInfo = { id: node.nodeId, label: node.label, provider: node.provider, seq }
    this._emitGraphEvent('graph/node-start', this.state.info, startInfo)
  }

  private _emitNodeEnd(node: NodeState, info: { outcome: GraphNodeOutcome; error?: string }): void {
    const endInfo: GraphNodeEndInfo = {
      id: node.nodeId, label: node.label, provider: node.provider,
      outcome: info.outcome,
    }
    if (info.error !== undefined) endInfo.error = info.error
    this._emitGraphEvent('graph/node-end', this.state.info, endInfo)
  }

  private _finalize(): void {
    if (this.settled) return
    this.settled = true
    const stopReason = this.state.cancelled ? 'cancelled' : 'completed'
    const result: GraphRunResult = {
      stopReason,
      nodesStarted: this.state.nodesStarted,
      nodesCompleted: this.state.nodesCompleted,
      nodesFailed: this.state.nodesFailed,
    }
    this._emitGraphEvent('graph/end', this.state.info, result)
    this.state.resolve(result)
  }

  private _cancelInternal(): void {
    if (this.settled || this.state.cancelled) return
    this.state.cancelled = true
    this.state.cancelController.abort()
    for (const node of this.state.nodes.values()) {
      if (node.status === 'pending') {
        node.status = 'cancelled'
        this._emitNodeEnd(node, { outcome: 'cancelled' })
      }
    }
    this._finalize()
  }
}

export default GraphEngine
