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

No invariant companion is published because the plugin owns no runtime relation an independent companion could check: its counter is private per-agent state, and the compaction a check triggers is observable through the engine's own events.

## Model Experience

### Mid-turn compaction timing

#### What the model sees

The plugin contributes no prompt text and no tool declaration. Its whole model-visible effect is timing: once completed tool results reach `threshold`, the engine may compact inside the turn, so the next request already carries the checkpoint a step-boundary check would have produced later. A check that finds no pressure changes the request not at all.

#### Token effect

Zero direct tokens. The replacement itself and its token reduction belong to the compaction engine; this plugin only moves the decision earlier, and the checkpoint preamble and summary format the model reads are the engine's.

#### KV Cache effect

Independent of the plugin's own contribution, which carries no request tokens. A check that returns without compacting leaves the request prefix reusable; when the engine does replace an older range, that checkpoint invalidates reuse from the first replaced history token exactly as a step-boundary compaction does.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the mid-step trigger misfires or stays silent; they are the current package constraints.

- **The trigger counts tool results, not tokens** — an engine-level trigger that prices the pending results and compacts on the measured overflow would be exact where this one is heuristic.
- **A route with no pressure configuration warns on every check** — the engine reports that condition through an error class this package cannot import without a deep import its source plane does not resolve; a silent skip would hide a composition mistake.
- **Coverage is a stub-compaction behavior suite** — a real-composition test that mounts `dsh-compaction-basic` over a replaying model and asserts the transcript of a mid-turn compaction is deferred.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`ctx.compaction.compactIfNeeded` is public on the base `CompactionEngine`, and `'pressure'` is a public `CompactionTrigger`. The trigger therefore needs no engine internals and lives outside `compaction-basic`, which keeps the backend unmodified.

</details>
