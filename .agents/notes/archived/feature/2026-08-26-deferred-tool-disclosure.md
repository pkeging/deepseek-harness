# Agent Note: Progressive tool disclosure (deferred tool_search)

Status: implemented
Archived: 2026-11-08

English | [中文](2026-08-26-deferred-tool-disclosure.zh.md)

## Problem

With many tools registered — especially MCP-discovered tools that arrive by the dozen — the per-request tool schema cost dominates the prompt and crowds out task context. Every agent turn pays the full JSON Schema of every visible tool, even tools the model never calls. The `tools` capability already supports presentation modes (`native`/`code`/`both`) and scoped restrictions, but those are static: a tool is either fully visible or hidden, with no middle ground that keeps a tool *discoverable* while deferring its parameter cost until the model actually needs it.

## Decision

`@deepseek-ai/dsh-deferred-disclosure` is a composition plugin over `ctx.tools` and `ctx.systemPrompt` that withholds a tool's parameter schema until the model asks for it:

- **Loader tool.** It registers `tool_search(name)`, always fully visible, which returns the requested tool's full `{ name, description, parameters }` schema and reveals that tool for the calling agent's scope.
- **Assembly transform.** A `system-prompt/assemble` waterfall listener strips the `parameters` of every tool whose name matches a `deferPatterns` glob (`*` wildcards, e.g. `mcp__*`), replacing them with an empty-parameter schema and a `[deferred …]` hint in the description. `tool_search` itself is never deferred.
- **Sticky per-scope reveal.** Reveal is keyed by the agent's `ScopeKey` (obtained via `scopeOf(agent.ctx)`, the same key the assemble listener receives as `context.scope`), so once a tool is loaded it stays full for that agent for its lifetime. A later assembled request for that scope keeps the complete schema, so the model can call the tool from the next request on.
- **Disabled by default.** `deferPatterns` defaults to `[]`; an empty list makes the plugin a no-op (all schemas stay visible) and still registers `tool_search`.
- **No loop change.** The plugin is pure presentation: it neither alters `tools/pre-execute`/`tools/execute` nor the agent loop. Tool calls still go through the normal pipeline; a deferred tool merely lacks its schema in a given request until revealed.

The plugin registers its invariant companion under `@deepseek-ai/dsh-deferred-disclosure` with an empty installer: the reveal store is private to one assemble listener and one tool, so it owns no cross-record runtime relationship.

## Alternatives considered

**Always show every schema (status quo).** Rejected for tool-heavy deployments: the schema cost scales with tool count and crowds out context the model actually needs.

**Hide deferred tools entirely (omit from bind_tools).** Rejected because the model then cannot even discover the tool's existence or call `tool_search` with its name; keeping name + hint preserves discoverability.

**Per-request dynamic disclosure driven by the model's last message.** Rejected: it re-introduces prompt-dependent churn and KV-cache invalidation every turn, whereas reveal-on-demand is a single, bounded promotion.

**Reveal on a timer or budget instead of on `tool_search`.** Rejected: the model is the only actor that knows when it needs a tool's parameters; an external heuristic would either over-reveal (cost) or under-reveal (blocked calls).

## Consequences

Every deferred tool costs only its name plus a short hint per request until revealed, instead of its full JSON Schema. A revealed tool returns to its full per-request cost for the rest of the agent. Revealing changes the assembled prompt, so it may invalidate KV-cache reuse from the first changed schema token.

The mechanism is name-based: `deferPatterns` match tool names, not capabilities or providers. Cross-agent sharing is absent — a different agent must search again. A deferred tool keeps an empty-parameter schema in the request, so a model that ignores the hint can still call it with no arguments and receive a normal argument-validation error rather than a clean "unknown tool".
