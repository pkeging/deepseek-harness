/**
 * Memory-integrity provider: enforces immutability of cross-session memory
 * entries via content-addressed digests.
 *
 * When a memory entry is stored, a SHA-256 digest of its content is computed
 * and recorded. On recall, the digest is re-computed and compared against
 * the stored value. Any mismatch indicates the entry was modified (either
 * by a bug, a compaction artifact, or intentional tampering).
 *
 * This extends the existing `dsh-attachment-local` content-addressed storage
 * pattern to the memory domain.
 *
 * @module @deepseek-ai/dsh-memory-integrity
 */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { MemoryEntry, MemoryStoreRequest } from '@deepseek-ai/dsh-memory'

export const name = 'memory-integrity'

/** Services injected. */
export const inject = ['memory']

export interface Config {
  /**
   * Whether to enforce digest verification on recall (default true).
   * Set to false to bypass integrity checks (e.g. for migration).
   */
  verifyOnRecall?: boolean
  /**
   * Whether to include the digest in stored entries (default true).
   * Set to false to store entries without digests (legacy compatibility).
   */
  includeDigest?: boolean
}

export const Config: z<Config> = z.object({
  verifyOnRecall: z.boolean().default(true),
  includeDigest: z.boolean().default(true),
})

/**
 * Compute a SHA-256 digest for a memory entry's content.
 * Uses only the content string (not the id or timestamps) so that
 * regenerating the digest is deterministic and id-independent.
 * @param content - entry content to hash.
 * @returns the lowercase hexadecimal SHA-256 digest.
 */
export function computeDigest(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}

/**
 * Memory entry with an optional integrity digest.
 * Extends the base MemoryEntry with a content-addressed hash.
 */
export interface MemoryEntryWithDigest extends MemoryEntry {
  /** SHA-256 hex digest of the original content at store time. */
  readonly contentDigest?: string
  /** Whether the entry passed integrity verification on recall. */
  readonly integrityVerified?: boolean
}

/**
 * Install the memory-integrity provider.
 *
 * Wraps the memory service to:
 * 1. Compute and attach a digest when storing entries
 * 2. Verify digests on recall (configurable)
 */
export function apply(ctx: Context, config: Config): void {
  const verifyOnRecall = config.verifyOnRecall as boolean
  const includeDigest = config.includeDigest as boolean

  // Patch the memory store to add digest computation
  const originalStore = ctx.memory.store.bind(ctx.memory)
  ctx.memory.store = async (request: MemoryStoreRequest): Promise<MemoryEntryWithDigest> => {
    const entry = await originalStore(request)
    if (!includeDigest) return entry
    const digest = computeDigest(request.content)
    return { ...entry, contentDigest: digest }
  }

  // Patch recall to verify digests
  if (verifyOnRecall) {
    const originalRecall = ctx.memory.recall.bind(ctx.memory)
    ctx.memory.recall = async (request: Parameters<typeof originalRecall>[0]) => {
      const result = await originalRecall(request)
      const entries = result.entries.map((entry: MemoryEntryWithDigest) => {
        if (entry.contentDigest === undefined) return entry
        const recomputed = computeDigest(entry.content)
        return {
          ...entry,
          integrityVerified: recomputed === entry.contentDigest,
        }
      })
      return { ...result, entries }
    }
  }
}
