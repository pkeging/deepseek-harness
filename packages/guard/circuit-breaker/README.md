# Circuit Breaker Guard

English | [中文](README.zh.md)

Detects consecutive failure patterns and forces a strategy change or halts the loop.

## Problem

The `repeat-tool-reminder` package provides advisory reminders but cannot **block** repeated failures. When an agent gets stuck in a logic loop (e.g., repeatedly using the wrong variable name), it needs a hard stop, not just a nudge.

## Solution

This plugin implements a **circuit breaker** pattern:

1. **Track failures**: Count consecutive tool call failures per agent
2. **Open circuit**: When failures exceed threshold, block further calls
3. **Reset on success**: A successful call closes the circuit
4. **Reset on user input**: User interjection clears the failure chain

## Configuration

```yaml
plugins:
  circuit-breaker:
    failureThreshold: 5  # consecutive failures before halt (default 5)
    windowSize: 10       # steps to consider (default 10)
    include: []          # tool patterns to track (empty = all)
    exclude: []          # tool patterns to ignore
```

## Behavior

| State | Action |
|-------|--------|
| Closed (normal) | Count failures, emit reminder at threshold/2 |
| Open (halted) | Block all tool calls, force strategy change |
| Half-Open (after user input) | Reset and allow testing new approach |

## Integration

Register in `cordis.yml`:

```yaml
plugins:
  - name: circuit-breaker
    config:
      failureThreshold: 5
      windowSize: 10
```

## Difference from repeat-tool-reminder

| Aspect | repeat-tool-reminder | circuit-breaker |
|--------|---------------------|-----------------|
| Action | Advisory only | Can block calls |
| Trigger | Repeated identical calls | Consecutive failures |
| Reset | On different call | On success or user input |
| Severity | Warning | Halt + mandatory context shift |

Use both: `repeat-tool-reminder` for early detection, `circuit-breaker` for hard stops.
