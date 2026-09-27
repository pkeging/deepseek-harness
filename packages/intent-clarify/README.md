# intent-clarify/ — bidirectional intent clarification

Gates execution when intent drift exceeds a threshold, triggering a human confirmation dialog before the agent continues. This is the **active** counterpart to `intent-guard`'s passive advisory detection.

## Packages

| Package | Role | ctx key |
|---|---|---|
| [`intent-clarify/`](intent-clarify/README.md) | Turn-boundary drift gate + human clarification trigger | — (function plugin) |

## Design

Listens on `agent/turn-stopping`. After each turn:
1. Checks if enough steps have accumulated (`minStepsBeforeCheck`)
2. Runs `ctx.intentGuard.observe()` with a synthetic step summarizing recent activity
3. If drift severity ≥ `clarificationThreshold`:
   - Injects a model-visible notice instructing the agent to call `ask_user_question`
   - Pauses the next step until the human confirms or updates the goal
4. If no goal is declared and `skipWhenNoGoal: true`, skips silently

## Configuration

```yaml
- id: intent-clarify
  name: '@deepseek-ai/dsh-intent-clarify'
  config:
    clarificationThreshold: 0.6    # severity above which to pause
    minStepsBeforeCheck: 3         # minimum steps before first check
    skipWhenNoGoal: true           # skip if no active goal
```

## Dependencies

- `ctx.intentGuard` (from `@deepseek-ai/dsh-intent-guard`)
- `ctx.userQuestions` (from `@deepseek-ai/dsh-user-questions`)

## Model Experience

When triggered, the agent sees:
> `[INTENT CLARIFICATION REQUIRED] Your recent actions show significant drift from your declared goal. Goal: "...". Drift type: pattern-repetition. Severity: 0.72. Before proceeding, use ask_user_question to clarify with the human: 1. Is the current goal still valid? 2. Should you change your approach? Do NOT continue until this clarification is resolved.`

#### KV Cache effect

None; the notice is injected as a new message that extends the conversation prefix.
