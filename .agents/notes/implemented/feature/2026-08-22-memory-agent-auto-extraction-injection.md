# Agent Note: Automatic memory extraction and injection

Status: implemented

English | [中文](2026-08-22-memory-agent-auto-extraction-injection.zh.md)

## Problem

A user's durable facts, preferences, decisions, and ideas surface inside one session and disappear with it. The memory capability seam (`@deepseek-ai/dsh-memory`) persists entries, but writing them is manual: the model must notice and call the memory tool itself, so nothing is saved unless a turn happens to mention it. Each new session starts empty, and questions like "what did we talk about before?" have no answer beyond what the model happens to reconstruct.

## Decision

`@deepseek-ai/dsh-memory-agent` is a composition plugin over the `memory`, `systemPrompt`, and `llm` services that makes memory retention automatic and best-effort:

- **Injection.** A `system-prompt/assemble` waterfall listener recalls the top `recallLimit` entries (default 5, threshold 0.3) semantically closest to the current user message and inserts them as a `memory:relevant` section with configurable `sectionOrder` (default 150). The section is advisory: the heading tells the model not to mention it directly. Recall failure or an empty result leaves the assembly unchanged.
- **Review detection.** A user message matching review keywords (Chinese and English recall phrases) raises the recall limit to `reviewLimit` (default 12) and swaps the heading to instruct the model to answer truthfully from the memories, so "what did we talk about before?" gets a real answer.
- **Extraction.** On `agent/turn-stopping`, an auxiliary LLM call distills memorable facts, decisions, preferences, and ideas from the latest turn transcript. Extraction is fire-and-forget with a per-session cooldown (`extractCooldownSec`, default 60), a `deadline`-backed timeout, and cosine-similarity deduplication against stored entries (`dedupeThreshold`, default 0.9). The extraction route comes from `extractProvider`/`extractModel` config, or falls back to the most recent `request/header` route.
- **Config validation.** Every tunable is a validated `Config` field; `extractProvider` and `extractModel` must be supplied together. Invalid config fails load loud, not silently.
- **Best-effort contract.** Failures are logged with `ctx.logger.warn` and never block or surface in the agent loop. `autoExtract` (default true) can disable extraction while keeping injection.

The package registers its invariant companion under `@deepseek-ai/dsh-memory-agent` with an empty installer: the plugin composes contracts owned by the memory and llm packages, so it owns no cross-record runtime relationship.

## Alternatives considered

**Manual-only memory via the existing memory tool.** Rejected: the whole point is that retention should not depend on the model noticing and choosing to save. The agent plugin adds the automated path while the tool remains for explicit writes.

**Extract after every turn with no cooldown.** Rejected: auxiliary LLM calls cost tokens and latency on every turn. The per-session cooldown bounds spend, and the fire-and-forget path keeps the user's turn from waiting.

**Inject all stored memories into every request.** Rejected: token cost and prompt noise grow without bound. Semantic recall with a threshold and limit keeps the injection small and relevant, with a larger budget only for explicit review queries.

**Synchronous extraction inside `turn/end`.** Rejected: the loop would wait on an auxiliary model call at a user-visible boundary. `agent/turn-stopping` fires the work without awaiting it.

## Consequences

Every model request pays one embedding recall (bounded by `recallLimit`, skippable by lowering the threshold or disabling the plugin). Every turn may pay one auxiliary LLM call for extraction, throttled by the cooldown and deduplication.

Memories enter the prompt as a removable named section, so other prompt providers or presets can filter or reorder `memory:relevant`. The review keyword list is a fixed constant — extending it is a code change, not config.

Extraction quality depends on the configured route or the last request's route: a session that never ran a model request produces no transcript to extract, and a route change mid-session follows the latest header.
