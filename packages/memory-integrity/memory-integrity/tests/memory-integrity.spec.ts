import { describe, expect, it } from 'vitest'
import { computeDigest, type MemoryEntryWithDigest } from '../src/index.ts'
import { createHash } from 'node:crypto'

describe('computeDigest', () => {
  it('produces a deterministic SHA-256 hex digest', () => {
    const content = 'remember that the user prefers TypeScript over JavaScript'
    const digest = computeDigest(content)
    const expected = createHash('sha256').update(content, 'utf-8').digest('hex')
    expect(digest).toBe(expected)
    expect(digest).toHaveLength(64) // SHA-256 = 256 bits = 64 hex chars
  })

  it('same content produces same digest', () => {
    const content = 'identical content'
    expect(computeDigest(content)).toBe(computeDigest(content))
  })

  it('different content produces different digest', () => {
    expect(computeDigest('content A')).not.toBe(computeDigest('content B'))
  })

  it('empty string produces a valid digest', () => {
    const digest = computeDigest('')
    expect(digest).toHaveLength(64)
    expect(digest).not.toBe('')
  })
})

describe('MemoryEntryWithDigest', () => {
  it('type includes optional contentDigest and integrityVerified', () => {
    const entry: MemoryEntryWithDigest = {
      id: 'mem-1' as never,
      kind: 'fact',
      content: 'test',
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      contentDigest: 'abc123',
      integrityVerified: true,
    }
    expect(entry.contentDigest).toBe('abc123')
    expect(entry.integrityVerified).toBe(true)
  })

  it('allows missing digest for legacy entries', () => {
    const entry: MemoryEntryWithDigest = {
      id: 'mem-2' as never,
      kind: 'note',
      content: 'legacy',
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      // contentDigest and integrityVerified are optional
    }
    expect(entry.contentDigest).toBeUndefined()
    expect(entry.integrityVerified).toBeUndefined()
  })
})
