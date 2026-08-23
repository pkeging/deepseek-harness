# Agent Note: Circuit Breaker for Consecutive Failure Detection

Status: proposed

## Problem

When an agent gets stuck in a logic loop (e.g., repeatedly using the wrong variable name `_OO_MODELS_TTL` instead of `_OC_MODELS_TTL`), the existing `repeat-tool-reminder` guard only emits advisory warnings but cannot **block** further execution. After ~20 failed attempts, the agent wastes tokens and time without making progress.

The feedback loop shows:
1. Agent attempts Edit with wrong variable name
2. Edit fails with "old_string was not found"
3. Agent reads file, sees correct name `_OC_MODELS_TTL`
4. Agent still types `_OO_MODELS_TTL` in next attempt
5. Loop repeats ~20 times before external intervention

`repeat-tool-reminder` detects **identical tool calls** but not **repeated failures with changing arguments**. This gap leaves logic loops undetected.

## Proposal

Add a new guard plugin `circuit-breaker` that:

1. **Tracks consecutive failures** per agent, not just repeated calls
2. **Opens circuit** when failures exceed threshold (default: 5)
3. **Blocks further tool calls** until strategy changes
4. **Resets on success** or user interjection

### Configuration

```yaml
plugins:
  circuit-breaker:
    failureThreshold: 5  # consecutive failures before halt
    windowSize: 10       # steps to consider
    include: []          # tool patterns (empty = all)
    exclude: []          # tool patterns to ignore
```

### Behavior

| State | Action |
|-------|--------|
| Closed (normal) | Count failures, emit reminder at threshold/2 |
| Open (halted) | Block all tool calls, force strategy change |
| Half-Open (after user input) | Reset and allow testing new approach |

### Implementation

- Location: `packages/guard/circuit-breaker/`
- Listens on `tools/post-execute` for failure detection
- Listens on `agent/pre-step` for user interjection reset
- Uses `WeakMap<Agent, ChainState>` for per-agent state
- Emits blocking decision with mandatory context shift when circuit opens

### Key Design Decisions

1. **Block, don't just warn**: Unlike `repeat-tool-reminder`, this plugin returns `{ kind: 'block' }` when threshold reached
2. **Failure detection**: Based on `result.isError === true`, not just repeated calls
3. **Windowed counting**: Only recent failures count (configurable `windowSize`)
4. **User reset**: Any user message clears the failure chain, allowing recovery

## Alternatives considered

### Why not extend `repeat-tool-reminder`?

`repeat-tool-reminder` is designed for **identical call detection** (same tool, same args). Extending it to failure detection would:
- Mix two different concerns (repetition vs. failure)
- Change its semantics from "advisory" to "blocking"
- Break existing deployments that rely on non-blocking behavior

Separate plugin keeps concerns clean and allows independent configuration.

### Why not add max-turns limit to agent-loop?

A global max-turns limit would:
- Block legitimate long-running tasks
- Not distinguish between progress and looping
- Be a blunt instrument vs. targeted failure detection

Circuit breaker is more precise: it detects **unproductive** loops, not just long runs.

### Why not use subagent delegation?

Subagent delegation could isolate failures but:
- Adds complexity (new session, context transfer)
- Doesn't prevent the parent agent from making same mistake
- circuit-breaker is simpler and more direct

## Acceptance criteria

- [ ] Plugin compiles with `pnpm run build`
- [ ] Plugin registers in `packages/guard/README.md`
- [ ] Configuration schema validated fail-loud at load
- [ ] Circuit opens after N consecutive failures (default 5)
- [ ] Tool calls blocked when circuit is open
- [ ] Circuit resets on successful tool call
- [ ] Circuit resets on user message injection
- [ ] Unit tests cover all state transitions
- [ ] Snapshot test verifies blocking behavior

## Risks

| Risk | Mitigation |
|------|------------|
| False positive: legitimate retry counted as failure | Windowed counting + user reset |
| Breaking existing deployments | opt-in plugin, not enabled by default |
| Agent stuck in half-open state | Timeout-based auto-reset (future) |
| Configuration complexity | Sensible defaults, minimal config needed |
