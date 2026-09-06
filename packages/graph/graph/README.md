# @deepseek-ai/dsh-graph

Graph capability seam: DAG execution over `ctx.graphEngine` and `graph/*` events.

## Overview

A graph run executes one directed acyclic graph (DAG) of nodes. Each node is backed by a
`GraphNodeProvider` registered under a string name; the engine schedules nodes when all
their predecessor edges have settled, propagates outputs through edges, and applies per-node
failure semantics (`isolate` / `propagate` / `continue`).

Unlike `dsh-workflow` (linear script-driven execution), the graph seam expresses topology
as **data**, not code: the caller declares nodes and edges, the engine derives execution
order from the DAG. Unlike the subagent seam (parent-child trees), graph nodes form a
general DAG with fan-in and fan-out, and the scheduler owns all concurrency control.

## Service Definition

Registered on `ctx.graphEngine`. Also owns `ctx.graphEngine.graphNodeProviders`, a
per-fiber registry of node providers.

```typescript
import { GraphEngine, GraphNodeProviderRegistry } from '@deepseek-ai/dsh-graph'

const engine = ctx.graphEngine
const registry = ctx.graphEngine.graphNodeProviders
```

## Events

| Event | Mode | Payload |
|---|---|---|
| `graph/run-start` | `emit` | `(info: GraphRunInfo)` |
| `graph/node-start` | `emit` | `(info: GraphRunInfo, node: GraphNodeStartInfo)` |
| `graph/node-end` | `emit` | `(info: GraphRunInfo, node: GraphNodeEndInfo)` |
| `graph/end` | `emit` | `(info: GraphRunInfo, result: GraphRunResult)` |

## Starting a Run

```typescript
const run = engine.start({
  topology: {
    nodes: [
      { id: GraphNodeId('a'), label: 'Fetch data', provider: 'subagent', inputs: {} },
      { id: GraphNodeId('b'), label: 'Process', provider: 'subagent', inputs: {} },
      { id: GraphNodeId('c'), label: 'Aggreg', provider: 'subagent', inputs: {} },
    ],
    edges: [
      { from: GraphNodeId('a'), to: GraphNodeId('b') },
      { from: GraphNodeId('a'), to: GraphNodeId('c') },
      { from: GraphNodeId('b'), to: GraphNodeId('c') },
    ],
  },
  parent: agent,
})

const result = await run.result
// result.stopReason: 'completed' | 'cancelled' | 'error' | 'propagated-failure'
```

## Failure Modes

Each node declares a `failureMode` (defaults to `'isolate'`):

- **`isolate`**: Node failure stops this node and all downstream nodes whose input edges
  include a failed predecessor. Other independent branches keep running.
- **`propagate`**: Node failure terminates the entire run immediately.
- **`continue`**: Node failure marks the node as failed but does not block downstream
  nodes. Dependents receive `null` under their input key.

## Model Experience

None, as the graph seam is orchestration machinery; nothing here reaches a model request
directly. A subagent-backed node provider may produce model-visible output through the
subagent seam.

## KV Cache Effect

Indirectly, through the node provider. A `subagent` provider invalidates KV cache reuse
for each child session it starts, because each child is a fresh session with no prior
conversation prefix.

## Known Limitations and Deferred Work

- **No built-in node providers**: The seam defines `GraphNodeProvider` but ships no
  concrete providers. A `subagent` provider is available in `dsh-graph-node-subagent`.
  A `function` provider and a `workflow` provider are deferred to follow-on packages.
- **No fan-out control**: Concurrency limits, max parallelism, and backpressure are
  deferred. The scheduler runs all ready nodes concurrently with no cap.
- **No durable graph runs**: A graph run is process-local. Restart does not resume a
  pending run; the caller must reconstruct and re-start the topology.
- **No graph UI**: The `graph/*` events are available for UI consumption, but no
  trajectory or chat view renders them.
