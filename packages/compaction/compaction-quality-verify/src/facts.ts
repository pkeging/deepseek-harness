/**
 * Fact extraction from session text for compaction quality verification.
 *
 * @module @deepseek-ai/dsh-compaction-quality-verify/facts
 */

import type { FactCategory } from './types.ts'

/** Max chars to keep per extracted fact. */
const MAX_FACT_LENGTH = 120

/**
 * Extract extractable facts from text content by category.
 * @param text - the text to extract facts from.
 * @param categories - which fact categories to extract.
 * @returns mapped facts per category.
 */
export function extractFacts(text: string, categories: readonly FactCategory[]): Map<FactCategory, string[]> {
  const facts = new Map<FactCategory, string[]>()
  for (const cat of categories) {
    facts.set(cat, extractFactCategory(text, cat))
  }
  return facts
}

function extractFactCategory(text: string, category: FactCategory): string[] {
  const facts: string[] = []
  const seen = new Set<string>()

  const add = (fact: string): void => {
    const normalized = fact.trim().toLowerCase()
    if (normalized.length < 3 || seen.has(normalized)) return
    seen.add(normalized)
    facts.push(fact.length > MAX_FACT_LENGTH ? fact.slice(0, MAX_FACT_LENGTH) + '…' : fact)
  }

  switch (category) {
    case 'file-paths':
      for (const match of text.matchAll(/(?:\/|[\\])[^\s<>:"'|*,;{}()]+\.[a-z]{2,}/gi)) {
        add(match[0])
      }
      break
    case 'error-messages':
      for (const match of text.matchAll(
        /\b(?:Error|exception|failed|rejected|refused|denied|timeout|refused):?\s*[^\n]{10,120}\b/gi,
      )) {
        add(match[0].trim())
      }
      break
    case 'numeric-values':
      for (const match of text.matchAll(/\b\d{4,}\b/g)) {
        add(match[0])
      }
      break
    case 'decisions': {
      const decisionRe = new RegExp(
        String.raw`\b(?:decided|chose|selected|approved|rejected|accepted|skipped|kept|dropped|changed|renamed|moved|deleted|created|fixed|resolved)`
          + String.raw`[^\n.]{5,80}[.!?]`,
        'gi',
      )
      for (const match of text.matchAll(decisionRe)) {
        add(match[0].trim())
      }
      break
    }
  }

  return facts.slice(0, 10)
}

/**
 * Check whether facts from the source text appear to be preserved in the summary.
 * @param sourceFacts - facts extracted from the shadowed messages.
 * @param summaryText - the compaction summary text.
 * @returns per-category preservation results.
 */
export function checkFactPreservation(
  sourceFacts: Map<FactCategory, string[]>,
  summaryText: string,
): Map<FactCategory, { preserved: number; total: number }> {
  const result = new Map<FactCategory, { preserved: number; total: number }>()
  const summaryLower = summaryText.toLowerCase()

  for (const [cat, facts] of sourceFacts) {
    let preserved = 0
    for (const fact of facts) {
      const factLower = fact.toLowerCase()
      // Check exact match or key substring
      if (summaryLower.includes(factLower) || factLower.split(/\s+/).some(word => word.length > 4 && summaryLower.includes(word))) {
        preserved += 1
      }
    }
    result.set(cat, { preserved, total: facts.length })
  }

  return result
}
