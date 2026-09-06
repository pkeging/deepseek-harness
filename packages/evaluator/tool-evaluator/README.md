# tool-evaluator/ — model-facing `query_evaluator` tool

Lets the agent explicitly request an independent evaluation of its recent trajectory.

## Parameters

| Field | Type | Required | Description |
|---|---|---|---|
| `recent_steps` | array | yes | Recent tool calls: `{ tool_name, success, summary? }` |

## Return shape

```json
{
  "category": "progress-ok",
  "explanation": "All recent steps succeeded with summaries.",
  "progress_score": 0.9,
  "suggestion": null
}
```

## Model guidance

> Use `query_evaluator` when you want an unbiased assessment of your approach. Pass your last 5–10 steps with a brief summary of each. The evaluator classifies your trajectory as `progress-ok`, `progress-stalled`, `goal-drift`, or `approach-error` and provides a suggestion.
