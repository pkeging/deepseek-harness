# tool-intent-guard/ — model-facing `intent_guard` tool

Exposes `intent_guard(step_summary)` to the model. Queries `ctx.intentGuard.observe()` and returns a structured drift report.

## Parameters

| Field | Type | Required | Description |
|---|---|---|---|
| `step_summary` | string | yes | One-sentence summary of what the last step accomplished |

## Return shape

```json
{
  "has_goal": true,
  "goal_objective": "Fix all TypeScript errors in the repo",
  "drift_detected": false,
  "drift_kind": null,
  "drift_message": null,
  "drift_severity": null,
  "recommendation": "Your recent step aligns with your goal. Continue."
}
```

When drift IS detected, `drift_kind` is one of `semantic-divergence`, `tool-mismatch`, `pattern-repetition`, or `goal-regression`, and `recommendation` gives actionable guidance.

## Model guidance

> Use `intent_guard` after completing a major sub-task or when you suspect your approach may have drifted from the original goal. It provides an independent assessment of whether your recent actions still serve your declared objective.
