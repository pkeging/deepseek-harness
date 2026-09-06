/**
 * Host-only graph request and live-run handles. The browser-safe durable
 * vocabulary remains in `./types` so Client programs never import Agent or
 * host Cordis context declarations.
 *
 * @module @deepseek-ai/dsh-graph
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GraphNodeId, GraphRunId, GraphRunResult, GraphTopology } from './types.ts'

/** Identifies one node provider registration on `ctx.graphNodeProviders`. */
export type GraphNodeProviderName = string

/**
 * What a provider must implement to execute one graph node. Providers are
 * registered under a string name on `ctx.graphNodeProviders`; the engine
 * looks up the name from {@link GraphNodeDef.provider} at scheduling time.
 */
export interface GraphNodeProvider {
  /**
   * Execute one node given its inputs and a parent agent context.
   * @param request - the node identity, resolved inputs, parent agent, and
   *   cancellation signal.
   * @returns the node's result, or throws on fatal provider errors.
   */
  execute(request: GraphNodeRequest): Promise<GraphNodeResult>
}

/**
 * The request passed to a {@link GraphNodeProvider.execute} call.
 */
export interface GraphNodeRequest {
  /** The node's stable id from the topology. */
  nodeId: GraphNodeId
  /** The node's display label. For diagnostic output only. */
  label: string
  /**
   * The resolved input map. Keys match the node's `inputs` keys; values are
   * the upstream node results collected by the scheduler. Absent keys are
   * those whose incoming edges have not yet settled.
   */
  inputs: Record<string, unknown>
  /**
   * The agent on whose behalf the node executes (parent of every child the
   * node may spawn).
   */
  parent: Agent
  /** Cancels the node when aborted. */
  signal: AbortSignal
}

/**
 * The result returned by a {@link GraphNodeProvider.execute} call.
 *
 * `success: true` means the node completed normally; `success: false` means
 * the node encountered an error that the provider considers a terminal failure
 * (not a transient one the scheduler should retry).
 */
export interface GraphNodeResult {
  /** Whether the node completed without a terminal error. */
  success: boolean
  /**
   * The node's output value. Present when `success` is true; may be
   * `null` or `undefined` when the provider has no meaningful return.
   */
  output?: unknown
  /**
   * The failure message. Present when `success` is false. Used for
   * `graph/node-end` events and for `propagate`-mode failure chains.
   */
  error?: string
}

/**
 * What a caller asks for when starting a graph run.
 *
 * `topology` is the DAG shape (node defs + edges); `args` is optional input
 * injected into root nodes (nodes with no incoming edges) under the key
 * `'__initial__'`; `parent` attributes every node execution to one live Agent.
 */
export interface GraphStartRequest {
  /** The DAG topology — node definitions and directed edges. */
  topology: GraphTopology
  /**
   * Optional initial inputs injected into root nodes. Keyed by node id,
   * values are placed under each root node's `'__initial__'` input key.
   * Root nodes that do not declare an `'__initial__'` input ignore the map.
   */
  args?: Record<GraphNodeId, unknown>
  /** The agent on whose behalf the run executes. */
  parent: Agent
  /** Cancels the run when aborted. */
  signal?: AbortSignal
}

/**
 * Holder-owned live graph run. `result` never rejects; consumers may cancel
 * and must call idempotent `dispose()` to await node cleanup.
 */
export interface GraphRun {
  /** The run's id. */
  readonly id: GraphRunId
  /** The validated topology available before the first node starts. */
  readonly topology: GraphTopology
  readonly result: Promise<GraphRunResult>
  /** Cancel the run and all in-flight nodes. */
  cancel(reason?: string): void
  /** Cancel if needed and await bounded settlement and cleanup. */
  dispose(): Promise<void>
}
