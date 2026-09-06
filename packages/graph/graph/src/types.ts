/**
 * Graph seam vocabulary: DAG topology, node definitions, edge semantics, run
 * identity, and per-node outcome types. Types only (plus the id-brand factory),
 * per the package convention.
 *
 * The core semantic distinction from `workflow/`: topology is declared data, not
 * scripted sequence. Nodes execute when their predecessor edges have all settled,
 * not when a script reaches an `await agent()` call. Failure propagation is
 * per-node policy, not script-controlled.
 *
 * @module @deepseek-ai/dsh-graph/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Identifies one graph run. */
export type GraphRunId = Branded<'GraphRunId'>

/**
 * Brand a string as a {@link GraphRunId}.
 * @param id - the raw id string (the engine mints UUIDs; tests may pass fixtures).
 * @returns the same string, branded.
 */
export function GraphRunId(id: string): GraphRunId {
  return id as GraphRunId
}

/** Identifies one node within a graph topology. */
export type GraphNodeId = Branded<'GraphNodeId'>

/**
 * Brand a string as a {@link GraphNodeId}.
 * @param id - the raw id string.
 * @returns the same string, branded.
 */
export function GraphNodeId(id: string): GraphNodeId {
  return id as GraphNodeId
}

/**
 * How one node's result reaches its dependents. Controls what downstream nodes
 * receive on the input key their edge targets.
 */
export type EdgeTransferMode =
  /** The full node result object is passed under the edge's target key. */
  | 'result'
  /** Only the node's status (`success`/`failed`/`skipped`) is forwarded. */
  | 'status'

/**
 * One directed edge in the DAG: from `from`'s output to `to`'s input key.
 * `transfer` defaults to `'result'`; a `'status'` edge carries only success.
 */
export interface GraphEdgeDef {
  /** The source node id. Must appear in {@link GraphTopology.nodes}. */
  from: GraphNodeId
  /** The destination node id. Must appear in {@link GraphTopology.nodes}. */
  to: GraphNodeId
  /**
   * The key under which `to` receives the transferred value. Defaults to
   * `'__result__'` when omitted, because the consumer (a subagent, a function
   * call) expects a named input rather than a bare tuple.
   */
  inputKey?: string
  /**
   * Whether the edge carries the full node result (`'result'`) or only the
   * node's outcome status (`'status'`). Defaults to `'result'`.
   */
  transfer?: EdgeTransferMode
}

/**
 * One node definition in a graph topology.
 *
 * `provider` names a registration on `ctx.graphNodeProviders`; `inputs` maps
 * each declared input key to the edge(s) that satisfy it — a node may be
 * satisfied by multiple upstream nodes as long as all its keys have a source.
 */
export interface GraphNodeDef {
  /** Stable identity within the topology. Unique across all nodes in the graph. */
  id: GraphNodeId
  /**
   * Display label. Used in UI, event payloads, and logs. Not used for lookup;
   * edges carry the id, not the label.
   */
  label: string
  /**
   * Provider name registered on {@link GraphNodeProviderRegistry}. Determines
   * what concrete executor runs when the node is scheduled.
   */
  provider: string
  /**
   * Input keys this node declares. Each key must be satisfied by at least one
   * edge whose `to === this.id`. Keys with no incoming edge are optional only
   * when the provider accepts them absent; the engine rejects unresolvable
   * required keys before scheduling.
   */
  inputs: Record<string, unknown>
  /**
   * Failure mode for this node. Defaults to `'isolate'` (only this node and
   * its unsatisfied dependents stop). `'propagate'` kills the entire run on
   * failure; `'continue'` marks the node failed and lets dependents proceed
   * with a sentinel input value.
   */
  failureMode?: NodeFailureMode
}

/**
 * Per-node failure propagation policy.
 */
export type NodeFailureMode =
  /**
   * Node failure stops this node and all downstream nodes whose input edges
   * include a failed predecessor. Other independent branches keep running.
   * This is the default and matches standard DAG semantics.
   */
  | 'isolate'
  /**
   * Node failure terminates the entire run immediately. Upstream nodes already
   * completed keep their results; downstream unscheduled nodes are cancelled.
   */
  | 'propagate'
  /**
   * Node failure marks the node as failed but does not block downstream nodes.
   * Dependents receive a sentinel value (`null` under their input key) and
   * are expected to handle absent input gracefully.
   */
  | 'continue'

/**
 * Why a node settled. CLOSED union.
 */
export type GraphNodeOutcome = 'completed' | 'failed' | 'skipped' | 'cancelled'

/**
 * One node's identity within a run, carried by every `graph/*` event payload as
 * borrowed immutable data, never the live node state.
 */
export interface GraphNodeInfo {
  /** The node's stable id from the topology. */
  id: GraphNodeId
  /** The display label from the topology. */
  label: string
  /** The provider name this node resolved to at execution time. */
  provider: string
  /** The subagent session id this node used, when the provider is a subagent. */
  childId?: SessionId
}

/**
 * Why a graph run settled. CLOSED union.
 */
export type GraphRunStopReason =
  /** All leaf nodes completed successfully. */
  | 'completed'
  /** The caller invoked {@link GraphRun.cancel}. */
  | 'cancelled'
  /**
   * A fatal engine error (topology validation failure, unresolvable edge,
   * missing provider) prevented the run from starting.
   */
  | 'error'
  /**
   * One node declared `'propagate'` failure mode and failed, killing the run.
   */
  | 'propagated-failure'

/**
 * The outcome resolved by a live graph run. Present on `graph/end` events.
 */
export interface GraphRunResult {
  /** Why the run settled. */
  stopReason: GraphRunStopReason
  /**
   * The failure message. Present iff `stopReason` is `'error'` or
   * `'propagated-failure'`.
   */
  error?: string
  /**
   * How many nodes the run accepted over its whole lifetime. On a graceful
   * settlement this is the count of nodes that started; on a termination path
   * it is the host-observed count.
   */
  nodesStarted: number
  /**
   * How many nodes reached a completed outcome. Present on all stop reasons.
   */
  nodesCompleted: number
  /**
   * How many nodes reached a failed outcome. Present on all stop reasons.
   */
  nodesFailed: number
}

/**
 * A run's identity snapshot, carried by every `graph/*` event as the first
 * argument.
 */
export interface GraphRunInfo {
  /** The run's id. */
  id: GraphRunId
  /**
   * The validated topology snapshot. Cloned from the request; the run holds
   * no mutable alias of the caller's input.
   */
  topology: GraphTopology
}

/**
 * The complete DAG description a caller passes to start a run.
 */
export interface GraphTopology {
  /** All node definitions in the DAG. */
  nodes: GraphNodeDef[]
  /**
   * All directed edges. A node is a graph root iff no edge targets it; a leaf
   * iff no edge originates from it. Self-loops and duplicate edges are rejected
   * at validation time.
   */
  edges: GraphEdgeDef[]
}

/** One node's identity at the moment it starts executing. */
export interface GraphNodeStartInfo extends GraphNodeInfo {
  /** 1-based sequence number of this node's start within the run. */
  seq: number
}

/** One node's identity at the moment it settles. */
export interface GraphNodeEndInfo extends GraphNodeInfo {
  /** How the node settled. */
  outcome: GraphNodeOutcome
  /** The failure message (present iff `outcome` is `'failed'`). */
  error?: string
}
