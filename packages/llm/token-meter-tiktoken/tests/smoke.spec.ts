import { describe, expect, it } from 'vitest'
import { DEFAULT_ENCODING, resolveEncodingForModel } from '../src/index.ts'

describe('token-meter-tiktoken', () => {
  it('exports DEFAULT_ENCODING', () => {
    expect(typeof DEFAULT_ENCODING).toBe('string')
    expect(DEFAULT_ENCODING.length).toBeGreaterThan(0)
  })

  it('resolveEncodingForModel returns consistent results', () => {
    const enc = resolveEncodingForModel('deepseek-v4-flash')
    expect(typeof enc).toBe('string')
  })
})
