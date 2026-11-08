# Agent Note: LLM-as-Judge Evaluation Tool

Status: implemented

English | [中文](2026-08-26-llm-judge-evaluation-tool.zh.md)

**Date:** 2026-08-26 · **Package:** `packages/evaluation/llm-judge` (`@deepseek-ai/dsh-llm-judge`)

## Why

`tool-ralph`'s README explicitly marks completion as "worker self-declaration" with no independent evaluator. The evaluation seam was entirely absent from the repository — zero eval code existed. This plugin adds the first LLM-as-judge tool that closes that gap.

## What was built

One new leaf package: `@deepseek-ai/dsh-llm-judge`.

Registers a single `judge` tool:

- **Input:** `objective` (string), `evidence` (string, truncated to 4 000 chars in prompt), `rubric` (string).
- **Dispatch:** one auxiliary LLM call with fixed system prompt (`"You are an objective evaluator. Return only valid JSON."`) and framed user prompt.
- **JSON extraction:** bare JSON, markdown-fenced JSON (` ```json … ``` `), or first `{…}` fragment — three-pass strategy.
- **Validation:** `score` integer 1–10, `pass` boolean, `reasoning` non-empty string. Any violation surfaces as a tool error.
- **Timeout:** configurable `timeoutMs` (default 30 000), enforced via `deadline()` from `@deepseek-ai/dsh-timeout`.
- **Config:** `timeoutMs`, `maxOutputTokens`, optional `provider`/`model` override (falls back to `deepseek`/`deepseek-chat`).
- **Presentation:** `generic` call card; result card shows `Score: N/10 · PASS/FAIL · reasoning`.

## Architecture decisions

1. **Tool, not plugin hook.** The judge does not listen on `agent-loop` or `tools/post-execute`. It is an ordinary model-facing tool the operator calls when they want a verdict. This matches the "no orchestration changes" principle: the evaluator is a capability seam, not a loop interceptor.
2. **`type: 'json'` output schema.** The value-schema DSL does not support `minimum`/`maximum`/`required` at the root level. Using `type: 'json'` bypasses the DSL restriction and lets the tool do its own validation after parsing.
3. **`deadline()` over `AbortController`.** Uses the repo-standard timeout primitive (`@deepseek-ai/dsh-timeout`) so timeout behavior is consistent with other auxiliary-call plugins (session-title, memory-agent).
4. **No automatic fallback.** Unlike `embedding-fallback`, the judge uses one fixed provider/model. The operator switches providers by reconfiguring the plugin, not by runtime fallback.

## Coverage

- **20 tests**, all passing: config validation (4), basic pass/fail (2), JSON extraction (4), verdict validation (4), arg validation (4), model integration (2).
- **Typecheck** passes (`tsc -b` exit 0).
- **Lint** passes (`oxlint` exit 0).
- **Invariant** registered (empty installer — no observable runtime invariant).

## Files

```
packages/evaluation/llm-judge/
  package.json
  tsconfig.json
  src/index.ts          # apply() + judge tool
  src/invariant.ts      # invariant companion
  tests/llm-judge.spec.ts
  README.md
  README.zh.md
```

## Repo registration

- `tsconfig.base.json`: added `"./packages/evaluation/*/src"` to the `@deepseek-ai/dsh-*` wildcard list.
- `tsconfig.host.json`: added `{ "path": "./packages/evaluation/llm-judge" }`.

## Validation

- `tsc -b` exit 0
- `oxlint` exit 0
- `vitest run` 20/20 passed



## Known gaps

- Single-call only; no multi-round debate or deliberation.
- JSON-dependent — a model that refuses JSON output produces an error, not a best-effort verdict.
- No workspace or session-state access; the tool is stateless beyond its three args.
- Does not integrate with `tool-ralph` automatically — the operator wires the connection.
