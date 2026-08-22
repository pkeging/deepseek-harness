import type { Branded } from '@deepseek-ai/dsh-brand'
import { HarnessError } from '@deepseek-ai/dsh-llm'

export type MemoryId = Branded<'MemoryId'>

export function MemoryId(id: string): MemoryId {
  return id as MemoryId
}

export type MemoryKind = 'fact' | 'decision' | 'preference' | 'idea' | 'note'

export interface MemoryEntry {
  readonly id: MemoryId
  readonly content: string
  readonly kind: MemoryKind
  readonly tags: readonly string[]
  readonly source?: string
  readonly createdAt: number
  readonly updatedAt: number
}

export interface MemoryStoreRequest {
  readonly content: string
  readonly kind?: MemoryKind
  readonly tags?: readonly string[]
  readonly source?: string
}

export interface MemoryRecallRequest {
  readonly query: string
  readonly limit?: number
  readonly threshold?: number
  readonly kind?: MemoryKind
}

export interface MemoryRecallResult {
  readonly entries: readonly MemoryEntry[]
  readonly scores: readonly number[]
}

export interface MemoryListRequest {
  readonly limit?: number
  readonly kind?: MemoryKind
  readonly offset?: number
}

export interface MemoryListResult {
  readonly entries: readonly MemoryEntry[]
  readonly total: number
}

export class MemoryError extends HarnessError {}
