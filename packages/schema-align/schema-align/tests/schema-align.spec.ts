import { describe, expect, it } from 'vitest'
import {
  registerContract,
  getContract,
  getAllContracts,
  assertContractExists,
  validateContracts,
} from '@deepseek-ai/dsh-schema-align'

describe('registerContract', () => {
  it('stores and retrieves a contract by tool name', () => {
    registerContract({
      toolName: 'test-tool',
      behavioralDescription: 'does something',
      negativeCases: [{ scenario: 'bad input', expectedOutcome: 'must-reject', reason: 'invalid' }],
    })
    const got = getContract('test-tool')
    expect(got).toBeDefined()
    expect(got!.toolName).toBe('test-tool')
  })

  it('rejects duplicate contracts for the same tool', () => {
    registerContract({
      toolName: 'dup-tool',
      behavioralDescription: 'first',
      negativeCases: [],
    })
    expect(() =>{
      registerContract({
        toolName: 'dup-tool',
        behavioralDescription: 'second',
        negativeCases: [],
      }) },
    ).toThrow(/duplicate contract/)
  })

  it('getAllContracts returns all registered contracts', () => {
    const before = getAllContracts().size
    registerContract({
      toolName: 'count-tool',
      behavioralDescription: 'counts',
      negativeCases: [],
    })
    expect(getAllContracts().size).toBe(before + 1)
  })
})

describe('assertContractExists', () => {
  it('throws when no contract is registered', () => {
    expect(() =>{  assertContractExists({ name: 'nonexistent-tool' }) })
      .toThrow(/no contract registered/)
  })

  it('does not throw when a contract exists', () => {
    registerContract({
      toolName: 'exists-tool',
      behavioralDescription: 'exists',
      negativeCases: [],
    })
    expect(() =>{  assertContractExists({ name: 'exists-tool' }) }).not.toThrow()
  })
})

describe('validateContracts', () => {
  it('returns empty when all contracts are well-formed', () => {
    registerContract({
      toolName: 'valid-tool',
      behavioralDescription: 'a valid tool',
      negativeCases: [{ scenario: 'x', expectedOutcome: 'must-reject', reason: 'y' }],
    })
    const violations = validateContracts()
    const valid = violations.find(v => v.toolName === 'valid-tool')
    expect(valid).toBeUndefined()
  })

  it('flags a contract with empty behavioralDescription', () => {
    registerContract({
      toolName: 'empty-desc-tool',
      behavioralDescription: '',
      negativeCases: [],
    })
    const violations = validateContracts()
    const found = violations.find(v => v.toolName === 'empty-desc-tool')
    expect(found).toBeDefined()
    expect(found!.violation).toContain('behavioralDescription')
  })
})
