# @deepseek-ai/dsh-llm-judge

English | [中文](README.zh.md)

LLM-as-judge evaluation tool. Registers a single `judge` tool that accepts an objective, evidence, and rubric, dispatches one auxiliary model call, and returns a structured verdict with a numeric score (1–10), a pass/fail decision, and plain-text reasoning.

This plugin closes the evaluator gap left by `tool-ralph` (whose README marks completion as "worker self-declaration" with no independent verifier). The judge is intended for post-hoc quality assessment or as a judgment step inside a custom workflow — it does not hook into the agent loop or alter tool routing.

## Contract

`judge({ objective, evidence, rubric })` issues one model call with a fixed system prompt and a framed user prompt containing the objective, rubric, and evidence (evidence over 4 000 chars is truncated in the prompt). The model is instructed to return valid JSON only. The harness extracts JSON from the response (bare JSON, markdown-fenced JSON, or a `{…}` fragment inside longer text), validates the shape — `score` must be an integer 1–10, `pass` must be a boolean, `reasoning` must be a non-empty string — and returns the parsed verdict. Invalid JSON, a non-JSON response, or a schema violation all surface as a tool error (`isError: true` in the result).

## Config

```yaml
- name: '@deepseek-ai/dsh-llm-judge'
  config:
    timeoutMs: 30000       # per-call deadline; default 30 000
    maxOutputTokens: 1024  # output cap for the judge response; default 1024
    provider: 'deepseek'   # optional explicit route (must pair with model)
    model: 'deepseek-chat' # optional explicit model (must pair with provider)
```

All fields are validated at plugin load. A missing `provider`/`model` pair falls back to `deepseek`/`deepseek-chat`; a partial pair throws.

## Model Experience

### System prompt

#### What the model sees

The judge tool is registered as an ordinary callable tool. Its schema lists three required string arguments (`objective`, `evidence`, `rubric`) and an object-valued output (`score`, `pass`, `reasoning`). No additional guidance appears in the system prompt — the model learns the evaluation contract from the tool description and schema.

#### Token effect

Small fixed schema cost on each request where the tool is visible.

#### KV Cache effect

Prefix-stable while the tool definition and visibility are unchanged.

### Judge call

#### What the model sees

One auxiliary request carrying the fixed system instruction and a framed user prompt. The prompt asks for a JSON object only and includes the objective, rubric (up to the full length of the string), and evidence (truncated at 4 000 chars if longer).

#### Token effect

Cost is one auxiliary model call per invocation. `maxOutputTokens` bounds the response; the default 1024 is ample for a short verdict.

#### KV Cache effect

Independent of the parent context — each judge call is a fresh dispatch.

## Known Limitations and Deferred Work

- **Self-contained in one call** — the judge issues a single model request; there is no multi-turn debate, no deliberation rounds, and no cross-rubric comparison.
- **JSON-dependent** — a model that consistently refuses to emit JSON or embeds the verdict inside prose without a parseable `{…}` fragment produces an error rather than a best-effort verdict.
- **No access to live session state** — the tool receives only the three string arguments passed by the caller. It cannot inspect the workspace, prior tool calls, or the agent's own memory.
- **Evaluator role, not orchestrator** — this plugin does not decide whether to continue a workflow; it only returns a verdict. Combining judge output with loop control is the operator's responsibility.
