---
description: "Local Ollama provider for the harness LLM service: one cordis.yml row turns daemon-served models into an ordinary text-and-tool-call route with no API key."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-ollama

English | [中文](README.zh.md)

## Summary

Mount this plugin to send harness prompts to a local Ollama daemon instead of a hosted API. One `cordis.yml` row names the daemon URL and its default model, and the daemon's models then select like any other route. Requests carry the system prompt, conversation text, and tool declarations; answers stream back in the harness's own chunk vocabulary with reasoning, token counts, a finish reason, and tool calls. Thinking can be turned off per session. Attachments become a placeholder rather than disappearing, and the route never needs a credential.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin next to the LLM runtime and select its route from a session. The plugin registers one adapter for the route name `ollama`; a request reaches the daemon only when its `provider` is that name.

### When to choose it

Choose it when a composition must work without a hosted provider: an offline machine, a privacy boundary that forbids sending prompts to an API, or a model that only exists in the local daemon. Choose `@deepseek-ai/dsh-llm-deepseek` for hosted DeepSeek models and `@deepseek-ai/dsh-llm-pi-ai` when several providers share one composition. This plugin never falls back to another route, and a daemon that is not running fails the request rather than answering from anywhere else.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-llm-ollama'
  config:
    model: qwen3.5:latest
```

| Field | Default | Meaning |
|---|---|---|
| `baseURL` | `http://127.0.0.1:11434` | Daemon base URL; must be an absolute `http` or `https` URL. |
| `model` | `llama3.2` | Daemon model used when a request names none. |
| `timeoutMs` | `120000` | Deadline covering the whole streamed response. |
| `maxTokens` | daemon default | Output cap sent as `num_predict` when a request carries no `maxTokens`. |
| `keepAlive` | daemon default | How long the daemon keeps the model resident, for example `5m`; `0` unloads immediately. |

This package is deployment-local, so the generated [configuration catalog](../../../docs/config-catalog.md) does not list it; the table above is the complete accepted field set.

### Route the daemon's models

`ctx.llm.listModels('ollama')` asks the daemon's `/api/tags` and returns one entry per installed model, with the reported parameter count appended to the display name. Every entry declares text input only, because this adapter sends no attachment field.

Every model on the route also declares two thinking efforts: `off` sends `think: false`, and `default` sends no thinking field at all, leaving the level to the daemon and the model. `default` is the route's default effort, so a session that never touches the setting keeps the daemon's own behavior.

### Read the failures

The daemon reports both transport and generation failures, and the adapter classifies each into a stable machine code: `AUTH` for 401 and 403, `INVALID_REQUEST` for 404, `RATE_LIMIT` for 429, `SERVER` for 5xx and for an in-band error line inside an otherwise successful stream, and `HTTP_<status>` otherwise. A failure never throws out of the stream: it arrives as the terminal `error` finish chunk the LLM service defines, with the daemon's own message and status attached. Escaping it, retrying it, and reporting it are the loop's and `@deepseek-ai/dsh-llm-retry`'s business.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The adapter is one class that owns the connection facts a single route serves, and it translates in both directions between the harness's block vocabulary and Ollama's flat message records.

Requests assemble from `GenerateOptions`: the one-shot `system` text becomes a leading system message, every history message becomes one record whose role is `system`, `user`, `assistant`, or `tool`, and a text message contributes the joined text of its content blocks. An assistant message's tool calls are replayed through the daemon's native `tool_calls` field, whose arguments the daemon expects as JSON rather than as the harness's raw argument string. Tool declarations map to the daemon's `tools` field, the generation knobs the harness carries map onto `temperature`, `num_predict`, and `stop` inside `options`, and the one reasoning effort with a wire meaning adds `think: false`.

Responses arrive as newline-delimited JSON, one partial message per line plus a final line carrying `done`. The reader turns reasoning fragments and text fragments into `reasoning-delta` and `text-delta` chunks around one block each, accumulates tool calls into tool-call blocks, and closes the stream with the daemon's token counts and a finish reason: `tool-calls` when the reply carried calls, `max-tokens` when the daemon stopped for length, and `stop` otherwise. Blocks open in arrival order, so a thinking model's reasoning keeps a lower index than the answer that follows it. Because the daemon issues no call id, the adapter synthesizes one from the block index.

Both directions tolerate hostile input. A stream line that is not a JSON object raises an error instead of being read as an empty chunk, and a tool-call argument string that does not decode is forwarded as the raw string rather than dropped.

| File | Responsibility |
|---|---|
| `src/index.ts` | Plugin entry: name, the `ollama` route, `inject`, and adapter registration. |
| `src/config.ts` | Config validation, defaults, and base-URL normalization. |
| `src/adapter.ts` | Request assembly, response translation, model listing, reasoning declaration, and failure classification. |
| `src/wire.ts` | Ollama wire types and the line decoder for a streamed body. |
| `tests/daemon.ts` | Scripted daemon stand-in that records paths, bodies, and headers. |
| `tests/ollama.spec.ts` | Keyless behavior suite over the scripted daemon. |
| `tests/ollama.e2e.ts` | Live-daemon suite, skipped unless `DSH_OLLAMA_E2E_MODEL` names an installed model. |

No invariant companion is published because the adapter owns no relation an independent companion could check: its route registration, request assembly, and stream translation are all observable through the `llm` seam every adapter shares.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [The LLM service](../llm/README.md) — the adapter interface this plugin implements and the chunk vocabulary it emits.
- [LLM streaming](../../../docs/subsystems/llm-streaming.md) — how a streamed reply becomes logged session events.
- [The DeepSeek route](../llm-deepseek/README.md) — the hosted adapter to compare failure and token handling against.
- [The pi-ai route](../llm-pi-ai/README.md) — the multi-provider adapter whose route and credential handling this one deliberately omits.
- [Retry](../llm-retry/README.md) — the package that retries the failures this adapter reports.
- [Adding a workspace package](../../../docs/cookbook/adding-a-package.md) — the checklist a new provider follows.

-----

<a id="model-experience"></a>
## Model Experience

### Provider request through Ollama

#### What the model sees

The daemon receives the system prompt as a leading system message and then one record per history message: `system` and `developer` messages as the daemon's `system` role, user messages as `user`, tool results as `tool`, and assistant messages as `assistant` with their text plus a native `tool_calls` array. Text blocks are joined with newlines, reasoning blocks contribute nothing, and an image or file block contributes the literal placeholder `[attachment omitted: this route carries text and tool calls only]`. Tool declarations arrive in the daemon's `tools` field. An `off` reasoning effort adds `think: false`; every other effort sends no thinking field.

#### Token effect

Replacing, per message. A message's structured blocks collapse into a single text field, so the per-block separators the harness records do not reach the daemon; a reasoning block costs nothing; an attachment costs the placeholder's few tokens instead of the image's provider-priced tokens. The system prompt is sent once per request rather than cached by the adapter.

#### KV Cache effect

Append-only across a conversation, and the package invalidates nothing of its own: every request resends the same earlier records byte-for-byte, so the daemon's own prompt cache can reuse the prefix it already evaluated. A changed `baseURL`, `model`, or `keepAlive` starts a different daemon-side session and can miss reuse; turning thinking off changes only the trailing request field, but the daemon may answer differently and unload or evict cache between requests regardless.

### Provider response

#### What the model sees

A thinking model's reasoning arrives as a `reasoning` block and its answer as a separate text block, so later requests and the session transcript carry both. Streamed content becomes one assistant text block, and the daemon's tool calls become tool-call blocks whose arguments stay a raw JSON string. The harness reports the daemon's `prompt_eval_count` and `eval_count` as the request's input and output tokens, and maps `done_reason: length` to a `max-tokens` finish.

#### Token effect

Reported, not computed: the counts are the daemon's own, so the harness's token meter and compaction budgets use the daemon's accounting for this route. Output tokens include the reasoning the daemon generated, which is why a thinking model can consume an entire small `maxTokens` before producing any answer text.

#### KV Cache effect

Independent. A response is a new suffix on the conversation and changes no earlier record, so the reusable request prefix survives it. A request that stops for length and is retried with a larger `num_predict` reuses that same prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define where the route is not a drop-in replacement for a hosted adapter; they are the current package constraints.

- **Attachments are not sent** — an image or file block becomes placeholder text; the daemon's `images` field is unused, so a vision-capable daemon model still receives no picture, and `listModels` reports text input only for every model even when the daemon advertises vision capability.
- **Thinking has no levels** — only `off` reaches the wire as `think: false`; a level selection sends nothing, so the daemon and the model keep their own default depth, and the daemon's `/api/tags` thinking capability is not consulted before declaring the two efforts for every model.
- **The context window stays the daemon's** — `num_ctx` is never sent, so the daemon's configured window and the harness's context budget can disagree, and a model's real window is not reported to `listModels`.
- **One daemon per composition** — both instances would register the same `ollama` route, which fails plugin loading; serving two daemons needs a second package or a configurable route name.
- **No authentication** — the adapter sends no credentials, so a remote or proxied daemon that requires an authorization header cannot be reached.
- **Tool-call ids are synthesized** — the daemon issues none, so a call id is only meaningful within the one response that produced it.
- **Live-daemon coverage is opt-in** — the e2e suite runs only when `DSH_OLLAMA_E2E_MODEL` names a model the daemon already serves, so a default `pnpm run test:e2e` proves nothing about the daemon on this machine.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

- **Route registration is the only coupling** — the adapter reads no engine internals, so image support and `num_ctx` can land as wire-field additions inside `src/adapter.ts` plus the corresponding wire types.
- **The scripted daemon owns wire coverage** — `tests/daemon.ts` is the deterministic proof for framing, reasoning order, tool calls, status classification, model listing, and the thinking switch; the live suite exists to prove transport against a real daemon, not to re-prove the mapping.
- **`timeoutMs` covers the whole stream** — the deadline aborts a mid-stream stall too, so a long local generation on a slow machine may need a raised value rather than a retry.
- **A thinking model can spend a small cap entirely on reasoning** — the live thinking model measured here answered in 427 ms with `off` and took seconds with thinking left on, so a session whose `maxTokens` is tight may see a `max-tokens` finish and no answer text.

</details>
