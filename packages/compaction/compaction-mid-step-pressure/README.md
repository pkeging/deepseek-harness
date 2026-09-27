---
description: "Mid-step compaction pressure trigger: asks the compaction engine for one pressure check once a batch of parallel tool results completes."
kind: "package-reference"
---

# @deepseek-ai/dsh-compaction-mid-step-pressure

English | [中文](README.zh.md)

## Summary

The basic compaction engine checks context pressure at step boundaries and after an overflow error. A batch of parallel tool calls completes between two boundaries, so its results enter the durable request without any pressure check seeing the growth. This plugin counts completed tool results per agent and asks the compaction engine for one `pressure` check once the batch reaches the configured size.

Mounting the plugin is the opt-in. An operator who does not want mid-step checks leaves it out of the composition, so no configuration flag is involved.

## Use this package

Mount it next to a compaction backend that resolves mid-step pressure:

```yaml
- name: '@deepseek-ai/dsh-compaction-basic'
- name: '@deepseek-ai/dsh-compaction-mid-step-pressure'
  config:
    threshold: 3
```

| Key | Type | Default | Effect |
|---|---|---|---|
| `threshold` | integer ≥ 1 | `3` | Completed tool results counted per agent before one pressure check runs. |

A threshold of `1` checks after every completed tool result. Raise it to cover the batch size at which parallel calls push one turn past a step boundary's worth of growth.

### What the check does

The plugin calls the engine's `compactIfNeeded(agent, 'pressure', signal)`, the same entry point the engine's own step-boundary listener uses. The engine decides whether pressure actually warrants compaction and returns `null` when it does not, so a check is cheap when context is healthy.

The counter resets when a check runs and when the agent reports `idle`, so a batch never spans two turns.

## Model Experience

The plugin adds no prompt text, no tool schema, and no token of its own. Its only effect is to make a compaction happen earlier than the next step boundary would: the model sees a shortened conversation earlier in the turn rather than after the turn's next step.

When a compaction does run mid-turn, the model's visible history is replaced by the compaction summary at that point, which can split a tool-call batch's results across the summarized and retained regions. Leave `threshold` above the largest expected parallel batch when that matters more than the earlier compaction.

## Known Limitations and Deferred Work

- The trigger reasons over tool-result count, not measured tokens. An engine-level trigger that prices the pending results and compacts on the real overflow delta would be exact where this one is heuristic.
- A route with no pressure configuration warns on every check instead of being skipped quietly. The engine reports that condition through an error class this package cannot import without a deep import its source plane does not resolve, and a silent skip would hide a composition mistake.
- Coverage is a stub-compaction behavior suite. A real-composition test that mounts `dsh-compaction-basic` over a replaying model and asserts the transcript of a mid-turn compaction is deferred.

## Dev Note

`ctx.compaction.compactIfNeeded` is public on the base `CompactionEngine`, and `'pressure'` is a public `CompactionTrigger`. The trigger therefore needs no engine internals and lives outside `compaction-basic`, which keeps the backend unmodified.
