# intent-guard-checker — L1 behavior + L2 semantic drift provider

Implements two detection layers registered as an `IntentGuardProvider` on `ctx.intentGuard`.

## L1: Behavior pattern detection

Fires on every `tools/post-execute`:
- Tracks consecutive identical tool calls per agent (canonical args comparison).
- Tracks consecutive tool failures per agent.
- Resets on `agent/pre-step` when a human user message arrives.

## L2: Semantic divergence detection

Fires on `agent/turn-stopping`, sampled every N steps (`embedSamplingInterval`):
- Embeds the goal declaration (cached per agent, refreshed when the goal changes).
- Embeds a summary of recent steps.
- Computes cosine similarity; below `semanticDivergenceThreshold` → drift signal.
- Injects a drift notice via `agent.inject()` for the next step.

## Configuration

```yaml
- id: intent-guard-checker
  name: '@deepseek-ai/dsh-intent-guard-checker'
  config:
    repetitionThreshold: 3          # L1: identical calls before signal
    failureThreshold: 5             # L1: consecutive failures before signal
    semanticDivergenceThreshold: 0.65  # L2: cosine < this = drift
    embedSamplingInterval: 5        # L2: check every N steps
    excludeTools: []                # wildcard patterns to skip (e.g. ['read'])
```

## Dependencies

- `ctx.intentGuard` (sibling service definition)
- `ctx.embedding` — required for L2; L1 works without it
- `ctx.goals` — required for L2 goal text; L1 works without it
