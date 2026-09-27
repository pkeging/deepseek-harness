# intent-clarify/ — bidirectional intent clarification at turn boundaries

Proactively detects intent drift after each turn and initiates a **bidirectional** clarification with the human user. This is the "active" counterpart to `intent-guard`'s "observational" drift detection.

## How it differs from intent-guard

| Aspect | `intent-guard` | `intent-clarify` |
|--------|---------------|-----------------|
| Role | Advisory (enriches context) | Gating (pauses execution) |
| Trigger | Per-step (inline) | Per-turn (at `agent/turn-stopping`) |
| Action on drift | Injects notice | Pauses + asks human via `ask_user_question` |
| Threshold | Severity ≥ 0.7 for `askUser` | Configurable `clarificationThreshold` |

## Configuration

```yaml
- id: intent-clarify
  name: '@deepseek-ai/dsh-intent-clarify'
  config:
    clarificationThreshold: 0.6    # severity above which to pause
    minStepsBeforeCheck: 3         # minimum steps before checking
    skipWhenNoGoal: true           # skip if no active goal
```

## Integration requirements

- `ctx.intentGuard` must be mounted (from `@deepseek-ai/dsh-intent-guard`)
- `ctx.userQuestions` must be available for the clarification dialog
- Requires an active `goal` for goal-aligned drift detection
