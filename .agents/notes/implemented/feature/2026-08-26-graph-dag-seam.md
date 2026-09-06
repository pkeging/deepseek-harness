# Agent Note: Graph DAG seam (`ctx.graphEngine`)

Status: implemented

English | [中文](2026-08-26-graph-dag-seam.zh.md)

## Problem

The repository has three execution models, each designed for a specific shape of work:

- **Turn/step loop** — one-agent, one-session, linear conversation. The `agent-loop` drives a single agent through model calls and tool invocations until the model stops requesting tools.
- **Workflow** — a single script that sequences or fans out subagent calls. The script controls the flow explicitly. It is linear in its control structure even when it calls `parallel()`.
- **Same-session goals** — one objective that admits repeated turns within a single session transcript.

None of these express a general DAG. A caller that needs:
- two independent tasks to run in parallel,
- a third task that depends on the results of both,
- and a fourth task that depends on only one of them

cannot model that with a workflow script without writing a script that *implicitly* encodes the DAG. The script itself becomes the graph, which means the graph is not data — it is code.

This prevents:
- UI rendering that shows the actual dependency structure independently of the script body.
- Partial re-execution: if node B fails, the engine cannot know whether node C (which depends on A and B) can still run with only A's result.
- Composing the graph with existing consumers: a graph node can be any provider, not just a subagent or a workflow step.

The repository therefore needs a seam where the topology is declared data and the scheduler derives execution order from the DAG, not from imperative code.

## Decision

Add a new capability seam at `ctx.graphEngine` (`@deepseek-ai/dsh-graph`) with four lifecycle events and a provider registry. The seam owns:

1. **Topology as data**: `GraphTopology` declares nodes and edges. The engine validates and schedules.
2. **Provider registry**: `ctx.graphEngine.graphNodeProviders` is a per-fiber `Map<string, GraphNodeProvider>`. The engine looks up each node's `provider` name at scheduling time; a missing name is a fatal error before any node starts.
3. **Per-node failure mode**: each node declares `failureMode` (`isolate` / `propagate` / `continue`). The scheduler applies the mode when a node settles failed.
4. **Invariant**: every `graph/node-start` has exactly one matching `graph/node-end`; every `graph/end` reports node counts that match the observed starts and outcomes.

The seam is a Service Definition only. No provider is shipped. A `subagent` provider, a `function` provider, and a `workflow` provider are deferred to follow-on packages.

### Package topology

| Package | Role |
|---|---|
| `graph/graph/` | Service Definition: `GraphEngine`, `GraphNodeProviderRegistry`, `GraphError`, types |
| `graph/graph-node-subagent/` | Deferred — subagent-backed node provider |
| `graph/graph-node-function/` | Deferred — pure-function node provider |
| `graph/graph-node-workflow/` | Deferred — workflow-backed node provider |

### Event contract

| Event | Mode | Payload |
|---|---|---|
| `graph/run-start` | `emit` | `(info: GraphRunInfo)` |
| `graph/node-start` | `emit` | `(info: GraphRunInfo, node: GraphNodeStartInfo)` |
| `graph/node-end` | `emit` | `(info: GraphRunInfo, node: GraphNodeEndInfo)` |
| `graph/end` | `emit` | `(info: GraphRunInfo, result: GraphRunResult)` |

### Failure mode semantics

- **`isolate`** (default): failed node is marked; any descendant whose every incoming edge comes from a failed node is skipped. Independent branches continue.
- **`propagate`**: failed node terminates the entire run. In-flight nodes are cancelled; not-yet-started nodes are skipped.
- **`continue`**: failed node is marked; dependents proceed with `null` under their input key. The dependent provider must handle absent input.

### Service Definition shape

```typescript
declare module '@deepseek-ai/cordis' {
  interface Context {
    graphEngine: GraphEngine
  }
}

abstract class GraphEngine extends Service {
  readonly graphNodeProviders: GraphNodeProviderRegistry
  abstract start(request: GraphStartRequest): GraphRun
}

class GraphNodeProviderRegistry {
  register(name: string, provider: GraphNodeProvider): () => void
  get(name: string): GraphNodeProvider | null
}
```

`GraphStartRequest` carries `topology`, optional `args`, `parent: Agent`, and optional `signal`. `GraphRun` carries `id`, `topology`, `result: Promise<GraphRunResult>`, `cancel()`, and `dispose()`.

## Consequences

- **Topology is visible, not hidden in code.** A UI can render the dependency graph independently of any script body. A caller can inspect the DAG to decide whether to submit it.
- **Failure is localized by default.** `isolate` mode matches standard DAG semantics: one branch failing does not kill an independent branch.
- **No new loop core.** The scheduler lives inside `GraphEngine.start()`, not inside `agent-loop`. The turn/step loop remains the default product loop.
- **No model-facing tool yet.** The seam is ready for a tool consumer (`dsh-tool-graph`) but none is shipped. The model cannot invoke a graph run directly; a human composes and starts it through code or a future tool.
- **KV cache effect is indirect.** Each subagent-backed node creates a fresh child session, which invalidates KV cache reuse for that child. The graph seam itself does not emit model-visible input.
- **The seam is a foundation, not a product.** No topology validator, no concurrency cap, no durable run, no UI rendering. These are deferred explicitly.

## Alternatives considered

- **Extend `workflow/` with DAG support** — rejected because the workflow engine runs inside a worker thread with a JS script body. Adding DAG semantics to the script body would make the script the graph, not the topology data. The two execution models (script-driven vs. data-driven) would be conflated.
- **Add a `GraphDriver` to `agent-loop`** — rejected because graph execution is a separate lifecycle from the turn/step loop. A graph run has its own cancellation, its own result promise, and its own node outcomes. Mixing it into the loop would make the loop responsible for DAG scheduling, which is a different concern.
- **Reuse `subagent` directly without a graph seam** — rejected because the subagent seam models a tree (parent → children), not a general DAG with fan-in. Two independent subagents that both feed a third consumer have no place in the subagent seam.
- **Ship a `subagent` provider in the same package** — rejected because the provider introduces a dependency on `dsh-subagent` and on the subagent lifecycle contract. The seam should remain provider-agnostic; a follow-on package can introduce the subagent provider with its own `inject` list.
- **Make `graphNodeProviders` a top-level `ctx` property** — rejected because Cordis does not allow setting arbitrary properties on `Context` without a declared injection. Storing the registry on the engine instance keeps it fiber-scoped and accessible without breaking the Context proxy contract.

## Known limitations and deferred work

- **No topology validator**: cycle detection, unresolvable edge checks, and duplicate edge detection are not implemented. The scheduler accepts any `GraphTopology` and the caller is responsible for acyclicity.
- **No concurrency cap**: all ready nodes start simultaneously. There is no `maxParallelism` or backpressure mechanism.
- **No durable graph runs**: a graph run is process-local. Restart does not resume a pending run; the caller must reconstruct and re-start the topology.
- **No built-in node providers**: no `subagent`, `function`, or `workflow` provider is shipped. Consumers must register their own provider or use a follow-on package.
- **No graph UI**: `graph/*` events are available for UI consumption, but no trajectory or chat view renders them.
- **No fan-in input merge policy**: when a node has two incoming edges carrying different output types, the provider receives a single `inputs` map. How to combine two different-typed outputs into one map is provider-defined, not engine-defined.
- **No node-level retry**: a failed node is terminal. There is no per-node retry count or backoff. A `continue`-mode failure does not retry; it passes `null` downstream.
