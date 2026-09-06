/** Package-owned graph lifecycle invariants. @module @deepseek-ai/dsh-graph/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {
  GraphNodeEndInfo,
  GraphNodeStartInfo,
  GraphRunInfo,
  GraphRunResult,
} from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-graph'

/** Cordis companion plugin name. */
export const name = 'graph-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Extended trace carrying node start state plus observed outcome. */
interface GraphNodeTrace {
  start: GraphNodeStartInfo
  outcome: string | undefined
}

interface GraphTrace {
  meta: string
  nodes: Map<string, GraphNodeTrace>
  starts: number
}

function traceFor(
  traces: ReadonlyMap<string, GraphTrace>,
  info: GraphRunInfo,
  fail: InvariantFailure,
): GraphTrace {
  const trace = traces.get(info.id)
  if (trace === undefined) fail(`graph event has no matching graph/run-start for run ${JSON.stringify(info.id)}`)
  if (trace.meta !== JSON.stringify(info.topology)) {
    fail(`graph event topology diverges from graph/run-start for run ${JSON.stringify(info.id)}`)
  }
  return trace
}

function validateNodeEnd(start: GraphNodeStartInfo, end: GraphNodeEndInfo, fail: InvariantFailure): void {
  if (start.id !== end.id) fail(`graph/node-end id diverges from graph/node-start for node ${JSON.stringify(end.id)}`)
  if (start.label !== end.label) fail(`graph/node-end label diverges from graph/node-start for node ${JSON.stringify(end.id)}`)
  if (start.provider !== end.provider) fail(`graph/node-end provider diverges from graph/node-start for node ${JSON.stringify(end.id)}`)
  const outcome: string = end.outcome
  if (outcome !== 'completed' && outcome !== 'failed' && outcome !== 'skipped' && outcome !== 'cancelled') {
    fail(`graph/node-end carries unknown outcome ${JSON.stringify(outcome)} for node ${JSON.stringify(end.id)}`)
  }
}

function validateGraphEnd(trace: GraphTrace, result: GraphRunResult, fail: InvariantFailure): void {
  if (trace.nodes.size > 0) fail(`graph/end has ${trace.nodes.size} node(s) without graph/node-end`)
  if (!Number.isSafeInteger(result.nodesStarted) || result.nodesStarted < trace.starts) {
    fail('graph/end nodesStarted must be a safe integer covering every observed node start')
  }
  const completedCount = [...trace.nodes.values()].filter(n => n.outcome === 'completed' || n.outcome === 'skipped').length
  if (result.nodesCompleted !== completedCount) {
    fail('graph/end nodesCompleted must match observed completed/skipped node count')
  }
  const failedCount = [...trace.nodes.values()].filter(n => n.outcome === 'failed').length
  if (result.nodesFailed !== failedCount) {
    fail('graph/end nodesFailed must match observed failed node count')
  }
  if (result.stopReason === 'completed' ? result.error !== undefined : typeof result.error !== 'string') {
    fail('graph/end error must be absent exactly for completed runs')
  }
}

const install: InvariantInstaller = (ctx, fail) => {
  const traces = new Map<string, GraphTrace>()
  const stagedStarts = new WeakSet<GraphRunInfo>()
  const stagedNodeStarts = new WeakSet<GraphNodeStartInfo>()
  const stagedNodeEnds = new WeakSet<GraphNodeEndInfo>()
  const stagedEnds = new WeakSet<GraphRunResult>()

  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName === 'graph/run-start') {
      const info = args[0] as GraphRunInfo
      if (String(info.id).length === 0) {
        fail('graph/run-start id must be non-empty')
      }
      if (traces.has(info.id)) fail(`graph/run-start repeated run id ${JSON.stringify(info.id)}`)
      stagedStarts.add(info)
      return
    }
    if (!eventName.startsWith('graph/')) return
    const info = args[0] as GraphRunInfo
    const trace = traceFor(traces, info, fail)
    if (eventName === 'graph/node-start') {
      const node = args[1] as GraphNodeStartInfo
      if (!Number.isSafeInteger(node.seq) || node.seq < 1 || String(node.id).length === 0) {
        fail('graph/node-start seq must be positive and id must be non-empty')
      }
      if (trace.nodes.has(node.id)) fail(`graph/node-start repeated node id ${JSON.stringify(node.id)}`)
      stagedNodeStarts.add(node)
      return
    }
    if (eventName === 'graph/node-end') {
      const node = args[1] as GraphNodeEndInfo
      const entry = trace.nodes.get(node.id)
      if (entry === undefined) return fail(`graph/node-end has no matching start for node ${JSON.stringify(node.id)}`)
      validateNodeEnd(entry.start, node, fail)
      stagedNodeEnds.add(node)
      return
    }
    if (eventName === 'graph/end') {
      const result = args[1] as GraphRunResult
      validateGraphEnd(trace, result, fail)
      stagedEnds.add(result)
    }
  }, { global: true })

  ctx.on('graph/run-start', (info) => {
    /* v8 ignore next -- internal/dispatch stages the same run-info object */
    if (!stagedStarts.delete(info)) return
    traces.set(info.id, { meta: JSON.stringify(info.topology), nodes: new Map(), starts: 0 })
  }, { global: true })
  ctx.on('graph/node-start', (info, node) => {
    /* v8 ignore next -- internal/dispatch stages the same node object */
    if (!stagedNodeStarts.delete(node)) return
    const trace = traceFor(traces, info, fail)
    trace.nodes.set(node.id, { start: node, outcome: undefined as string | undefined })
    trace.starts += 1
  }, { global: true })
  ctx.on('graph/node-end', (info, node) => {
    /* v8 ignore next -- internal/dispatch stages the same node object */
    if (!stagedNodeEnds.delete(node)) return
    const trace = traceFor(traces, info, fail)
    const entry = trace.nodes.get(node.id)
    if (entry !== undefined) entry.outcome = node.outcome
  }, { global: true })
  ctx.on('graph/end', (info, result) => {
    /* v8 ignore next -- internal/dispatch stages the same result object */
    if (!stagedEnds.delete(result)) return
    traces.delete(info.id)
  }, { global: true })
}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
