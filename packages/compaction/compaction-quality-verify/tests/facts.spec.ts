import { describe, expect, it } from 'vitest'
import { extractFacts, checkFactPreservation } from '../src/facts.ts'
import type { FactCategory } from '../src/types.ts'

describe('extractFacts', () => {
  it('extracts file paths from text', () => {
    const text = 'Modified src/foo/bar.ts and /etc/config.yaml. Also updated docs/guide.md.'
    const facts = extractFacts(text, ['file-paths'])
    const paths = facts.get('file-paths') ?? []
    expect(paths.length).toBeGreaterThan(0)
    expect(paths.some(p => p.includes('bar.ts'))).toBe(true)
  })

  it('extracts error messages from text', () => {
    const text = 'Got Error: connection refused on port 8080. Also failed to read file.'
    const facts = extractFacts(text, ['error-messages'])
    const errors = facts.get('error-messages') ?? []
    expect(errors.length).toBeGreaterThan(0)
  })

  it('extracts numeric values from text', () => {
    const text = 'Processed 12345 records with error rate 0.03%. Token count was 524288.'
    const facts = extractFacts(text, ['numeric-values'])
    const numbers = facts.get('numeric-values') ?? []
    expect(numbers.some(n => n === '12345' || n === '524288')).toBe(true)
  })

  it('extracts decision statements from text', () => {
    const text = 'We decided to use SQLite for storage. The team chose Redis as cache.'
    const facts = extractFacts(text, ['decisions'])
    const decisions = facts.get('decisions') ?? []
    expect(decisions.length).toBeGreaterThan(0)
  })

  it('returns empty for text with no extractable facts', () => {
    const text = 'just some random words with no structure'
    const facts = extractFacts(text, ['file-paths', 'error-messages', 'numeric-values', 'decisions'])
    for (const cat of facts.keys()) {
      expect(facts.get(cat)!).toEqual([])
    }
  })
})

describe('checkFactPreservation', () => {
  it('reports full preservation when summary contains all facts', () => {
    const sourceFacts = new Map<FactCategory, string[]>([
      ['file-paths', ['/src/main.ts', '/config.yaml']],
      ['numeric-values', ['12345']],
    ])
    const result = checkFactPreservation(sourceFacts, 'Summary about /src/main.ts and /config.yaml with 12345 records')
    expect(result.get('file-paths')?.preserved).toBe(2)
    expect(result.get('numeric-values')?.preserved).toBe(1)
  })

  it('reports missing facts when summary lacks them', () => {
    const sourceFacts = new Map<FactCategory, string[]>([
      ['file-paths', ['/src/main.ts', '/config.yaml']],
    ])
    const result = checkFactPreservation(sourceFacts, 'Generic summary about code')
    expect(result.get('file-paths')?.preserved).toBe(0)
    expect(result.get('file-paths')?.total).toBe(2)
  })
})
