import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { IntentGuardService } from '@deepseek-ai/dsh-intent-guard'
import type { IntentGuardProvider, DriftSignal, StepRecord } from '@deepseek-ai/dsh-intent-guard'
import type { Agent } from '@deepseek-ai/dsh-agent'

/** Minimal mock Agent for unit tests. */
function makeAgent(id = 'agent-1'): Agent {
  return { id } as unknown as Agent
}

/** Minimal mock step record. */
function makeStep(options: Partial<StepRecord> = {}): StepRecord {
  return {
    step: 1,
    success: true,
    timestamp: Date.now(),
    ...options,
  }
}

describe('IntentGuardService', () => {
  it('registers and unregisters providers', async () => {
    const ctx = new Context()
    const svc = new IntentGuardService(ctx)
    expect(svc.providers).toHaveLength(0)

    const provider: IntentGuardProvider = {
      id: 'test',
      detect: async () => null,
    }
    const dispose = svc.registerProvider(provider)
    expect(svc.providers).toHaveLength(1)
    expect(svc.providers[0]).toBe(provider)

    dispose()
    expect(svc.providers).toHaveLength(0)
  })

  it('observe returns null when no providers are registered', async () => {
    const ctx = new Context()
    const svc = new IntentGuardService(ctx)
    const agent = makeAgent()
    const result = await svc.observe(agent, makeStep())
    expect(result.signal).toBeNull()
    expect(result.askUser).toBe(false)
  })

  it('observe returns the first provider\'s signal', async () => {
    const ctx = new Context()
    const svc = new IntentGuardService(ctx)
    const agent = makeAgent()

    const signal: DriftSignal = {
      kind: 'pattern-repetition',
      code: 'REPETITION_THRESHOLD',
      message: '3 consecutive identical calls',
      severity: 0.8,
    }
    const provider: IntentGuardProvider = {
      id: 'checker',
      detect: async () => signal,
    }
    svc.registerProvider(provider)

    const result = await svc.observe(agent, makeStep())
    expect(result.signal).toBe(signal)
    expect(result.askUser).toBe(true) // severity 0.8 >= 0.7 → ask user
  })

  it('askUser is false when severity is below 0.7', async () => {
    const ctx = new Context()
    const svc = new IntentGuardService(ctx)
    const agent = makeAgent()

    const lowSignal: DriftSignal = {
      kind: 'pattern-repetition',
      code: 'REPETITION_THRESHOLD',
      message: 'mild repetition',
      severity: 0.3,
    }
    svc.registerProvider({ id: 'p1', detect: async () => lowSignal })

    const result = await svc.observe(agent, makeStep())
    expect(result.askUser).toBe(false)
  })

  it('contains provider failures without crashing', async () => {
    const ctx = new Context()
    const svc = new IntentGuardService(ctx)
    const agent = makeAgent()

    svc.registerProvider({
      id: 'broken',
      detect: async () => { throw new Error('provider crash') },
    })
    svc.registerProvider({
      id: 'healthy',
      detect: async () => ({
        kind: 'pattern-repetition',
        code: 'OK',
        message: 'fallback',
        severity: 0.1,
      }),
    })

    const result = await svc.observe(agent, makeStep())
    expect(result.signal).not.toBeNull()
    expect(result.signal?.code).toBe('OK')
  })

  it('getGoalObjective returns undefined when no goals service', async () => {
    const ctx = new Context()
    const svc = new IntentGuardService(ctx)
    expect(svc.getGoalObjective(makeAgent())).toBeUndefined()
  })
})
