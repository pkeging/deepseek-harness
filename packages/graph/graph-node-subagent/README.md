# @deepseek-ai/dsh-graph-node-subagent

Graph node provider backed by `ctx.subagents`. Each node execution becomes one
one-shot subagent delegation whose prompt carries the upstream node outputs
(JSON-serialized, one key per input) plus the node label.

## Overview

This package implements the first concrete `GraphNodeProvider`: it registers
itself on `ctx.graphEngine.graphNodeProviders` under the name `'subagent'`.
When the graph scheduler invokes the provider, it:

1. Formats the node's upstream inputs as a text prompt (task label + JSON sections).
2. Calls `ctx.subagents.startActivation({ provider, label, prompt, parent, signal, delivery: 'caller' })`.
3. Awaits the activation's `result`, maps it to a `GraphNodeResult`, and disposes that exact activation.

The subagent provider name used for `ctx.subagents.startActivation()` is
configurable via `Config.subagentProviderName` (default: `'spawn'`).

## Plugin

```typescript
import { apply as applySubagentNodeProvider } from '@deepseek-ai/dsh-graph-node-subagent'

applySubagentNodeProvider(ctx, { subagentProviderName: 'spawn' })
```

After applying, `ctx.graphEngine.graphNodeProviders.get('subagent')` resolves
to the provider. Topologies can then declare `provider: 'subagent'` on any
`GraphNodeDef`.

## Input → Prompt mapping

Each node input becomes a JSON section in the child's prompt:

```
Task: <node label>

Upstream inputs:
`source`: { "url": "https://example.com" }
`count`: 10
```

Absent inputs (`undefined` / `null`) render as `(absent)`. The provider
concatenates all text blocks from the child's final assistant output into the
node's `output` value.

## Output mapping

| Subagent outcome | GraphNodeResult |
|---|---|
| `stopReason: 'completed'` | `success: true`, `output: text` |
| `stopReason: 'error'` with `diagnostic` | `success: false`, `error: diagnostic` |
| `stopReason: 'error'` without `diagnostic` | `success: false`, no `error` |
| Infrastructure error (provider missing, etc.) | Throws `GraphError` (fatal) |

## Model Experience

Indirect. The graph seam itself does not reach a model request. The subagent
node provider creates a fresh child session (via the configured subagent
provider), so each node is a separate LLM interaction with its own context
window. The parent's conversation is **not** seeded into the child — the child
receives only the formatted input prompt.

## KV Cache Effect

Each subagent-backed node creates a fresh child session, which invalidates KV
cache reuse for that child. The graph scheduler runs nodes concurrently where
the DAG allows, so independent nodes can benefit from parallel LLM inference,
but each child session is a cold start with no prior KV cache.

## Known Limitations and Deferred Work

- **No structured output**: The provider always reads `result.output` as text.
  A future `outputSchema` config could request structured JSON from the child
  and expose it as the node's output.
- **No input schema**: Inputs are free-form JSON. There is no per-node input
  type validation — the provider accepts any `Record<string, unknown>`.
- **No prompt templating**: The prompt format is fixed (label + JSON sections).
  A future `promptTemplate` config could allow custom Jinja-style templates.
- **No node-level timeout**: The provider forwards the node's `signal` but does
  not impose its own timeout. A slow child will block the scheduler until the
  graph-level cancellation propagates.
- **Single provider name**: The `'subagent'` registration name is fixed. A
  topology can only use one subagent provider per graph run; mixing providers
  requires multiple topologies.
