# @deepseek-ai/dsh-deferred-disclosure

English | [中文](README.zh.md)

Progressive tool disclosure for the DeepSeek Harness. With many tools — especially MCP-discovered ones — the per-request tool schema cost dominates the prompt and crowds out task context. This plugin withholds a tool's parameter schema until the model explicitly asks for it via `tool_search`, then reveals that tool's full schema for every later request in the same agent scope. Deferred tools show only their name and a one-line hint, so large tool catalogs stop inflating every turn.

It is an ordinary plugin over `ctx.tools` and `ctx.systemPrompt`: it registers the `tool_search` loader tool and listens on `system-prompt/assemble` to strip the parameter schemas of matching tools. It does not change the agent loop or the tool execution pipeline.

## Config

```yaml
- name: '@deepseek-ai/dsh-deferred-disclosure'
  config:
    deferPatterns: ['mcp__*']   # tool-name globs to start deferred; empty disables
```

| Key | Required | Meaning |
|---|---|---|
| `deferPatterns` | no (default `[]`) | Glob patterns (supporting `*`) matched against tool names. A matching tool starts with its parameter schema withheld until `tool_search` loads it. An empty list disables the plugin: all schemas stay visible. `tool_search` itself is never deferred. |

## How it works

- A deferred tool appears in the prompt with its name, its description (appended with a `[deferred …]` hint), and empty parameters, so the model cannot call it until it learns the parameters.
- Calling `tool_search("<name>")` returns the tool's full `{ name, description, parameters }` schema and marks the tool revealed for that agent scope.
- The next request assembled for that scope keeps the tool's full schema, so the model can call it normally. Reveal is sticky for the agent's lifetime; revealing adds a schema and may invalidate KV-cache reuse from the first changed token.

## Model Experience

### Deferred tool schemas and the loader

#### What the model sees

Before `tool_search`, each deferred tool shows only its name, its description, and a hint:

```markdown
<tool name> — <description>
[deferred — call tool_search("<tool name>") to load its parameters before using it]
```

`tool_search` is always listed in full. After the model calls `tool_search("<tool name>)`, that tool's complete parameter schema is present in every later request for the same agent, exactly as if it had never been deferred.

#### Token effect

Each deferred tool costs only its name plus a short hint instead of its full JSON Schema on every request where it has not yet been revealed. Tool-heavy deployments (many MCP tools) see the largest savings; a tool revealed once returns to its full per-request cost for the rest of the agent.

#### KV Cache effect

Revealing a tool changes the assembled prompt, so it may invalidate KV-cache reuse from the first changed schema token. A deferred tool that is never revealed never reintroduces its parameter cost.

### `tool_search` result

#### What the model sees

A plain-text JSON object: `{ "name", "description", "parameters" }` for the requested tool. The model uses it to learn the parameters, then calls the tool in a subsequent request once its schema is present.

## Known Limitations and Deferred Work

- **Reveal is per-scope, not per-turn** — once a tool is revealed for an agent it stays revealed for that agent's lifetime; there is no budgeted auto-rehide.
- **Same-turn call still requires the next request** — `tool_search` returns the schema as text, but the model can only call the tool once the next assembled request includes its full schema, so the first use always spans two requests.
- **Empty parameters still permit a call** — a deferred tool keeps an empty-parameter schema in the request, so a model that ignores the hint can call it with no arguments and receive a normal argument-validation error rather than a clean "unknown tool".
- **No cross-agent sharing** — reveals are scoped to the calling agent; a different agent must search again.
- **Patterns are name-only** — `deferPatterns` match tool names, not capabilities or providers; semantic grouping is out of scope.
