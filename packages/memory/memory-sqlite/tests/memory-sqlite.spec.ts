import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import EmbeddingRuntime from '@deepseek-ai/dsh-embedding'
import * as hashPlugin from '@deepseek-ai/dsh-embedding-hash'
import { MemoryError } from '@deepseek-ai/dsh-memory'
import { SqliteMemoryStore } from '@deepseek-ai/dsh-memory-sqlite'
import * as memoryPlugin from '@deepseek-ai/dsh-memory-sqlite'

/**
 * Deterministic keyword-bag embedding for tests: shared tokens produce
 * overlapping vectors so semantic recall has a meaningful signal.
 */
class TestEmbeddingService {
  embed(texts: string[], _signal?: AbortSignal) {
    return Promise.resolve({
      vectors: texts.map((text) => {
        const vec = new Float32Array(64)
        const tokens = text.toLowerCase().split(/\W+/u).filter(Boolean)
        for (const token of tokens) {
          let hash = 2166136261
          for (let i = 0; i < token.length; i++) {
            hash ^= token.charCodeAt(i)
            hash = Math.imul(hash, 16777619)
          }
          const index = Math.abs(hash) % 64
          vec[index] = (vec[index] ?? 0) + 1
        }
        const norm = Math.sqrt(Array.from(vec).reduce((sum, v) => sum + v * v, 0))
        if (norm > 0) {
          for (let i = 0; i < 64; i++) vec[i] = (vec[i] ?? 0) / norm
        }
        return vec
      }),
      truncated: false,
    })
  }
}

function makeStore(): SqliteMemoryStore {
  const store = new SqliteMemoryStore({ databasePath: ':memory:' })
  store.setEmbeddingService(new TestEmbeddingService())
  return store
}

describe('SqliteMemoryStore', () => {
  it('stores and reads back a memory entry', async () => {
    const store = makeStore()
    await store.open()
    try {
      const entry = await store.store({ content: 'The user prefers concise answers', kind: 'preference' })
      expect(entry.content).toBe('The user prefers concise answers')
      expect(entry.kind).toBe('preference')
      expect(entry.tags).toEqual([])
      expect(entry.createdAt).toBeGreaterThan(0)
      const fetched = store.get(entry.id)
      expect(fetched?.content).toBe('The user prefers concise answers')
      expect(fetched?.kind).toBe('preference')
    } finally {
      store.close()
    }
  })

  it('stores tags and source', async () => {
    const store = makeStore()
    await store.open()
    try {
      const entry = await store.store({ content: 'Use PostgreSQL for production', tags: ['db', 'deploy'], source: 'session:abc' })
      expect(entry.tags).toEqual(['db', 'deploy'])
      expect(entry.source).toBe('session:abc')
      const fetched = store.get(entry.id)
      expect(fetched?.tags).toEqual(['db', 'deploy'])
      expect(fetched?.source).toBe('session:abc')
    } finally {
      store.close()
    }
  })

  it('recalls semantically similar memories ranked by score', async () => {
    const store = makeStore()
    await store.open()
    try {
      await store.store({ content: 'The project uses pnpm workspaces', kind: 'fact' })
      await store.store({ content: 'We prefer PostgreSQL over MySQL', kind: 'preference' })
      const result = await store.recall({ query: 'postgresql database', threshold: 0 })
      expect(result.entries.length).toBeGreaterThan(0)
      // PostgreSQL memory should outrank the unrelated pnpm memory.
      expect(result.entries[0]?.content).toContain('PostgreSQL')
    } finally {
      store.close()
    }
  })

  it('filters recall results by kind', async () => {
    const store = makeStore()
    await store.open()
    try {
      await store.store({ content: 'Alpha is a fact', kind: 'fact' })
      await store.store({ content: 'Alpha is a preference', kind: 'preference' })
      const result = await store.recall({ query: 'Alpha', kind: 'fact', threshold: 0 })
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0]?.kind).toBe('fact')
    } finally {
      store.close()
    }
  })

  it('respects the recall limit', async () => {
    const store = makeStore()
    await store.open()
    try {
      for (let i = 0; i < 5; i++) {
        await store.store({ content: `shared topic item ${i}`, kind: 'fact' })
      }
      const result = await store.recall({ query: 'shared topic', limit: 2, threshold: 0 })
      expect(result.entries.length).toBeLessThanOrEqual(2)
    } finally {
      store.close()
    }
  })

  it('lists memories newest-first with total count', async () => {
    const store = makeStore()
    await store.open()
    try {
      await store.store({ content: 'first memory', kind: 'note' })
      await store.store({ content: 'second memory', kind: 'note' })
      const result = store.list({ limit: 10 })
      expect(result.total).toBe(2)
      expect(result.entries[0]?.content).toBe('second memory')
    } finally {
      store.close()
    }
  })

  it('updates content and re-embeds', async () => {
    const store = makeStore()
    await store.open()
    try {
      const entry = await store.store({ content: 'old content', kind: 'fact' })
      const updated = await store.update(entry.id, { content: 'new content' })
      expect(updated.content).toBe('new content')
      expect(updated.updatedAt).toBeGreaterThanOrEqual(entry.updatedAt)
      const fetched = store.get(entry.id)
      expect(fetched?.content).toBe('new content')
    } finally {
      store.close()
    }
  })

  it('throws MEMORY_NOT_FOUND on update of a missing entry', async () => {
    const store = makeStore()
    await store.open()
    try {
      await expect(store.update('00000000-0000-4000-8000-000000000000' as never, { content: 'x' }))
        .rejects.toMatchObject({ code: 'MEMORY_NOT_FOUND' })
    } finally {
      store.close()
    }
  })

  it('deletes a memory entry', async () => {
    const store = makeStore()
    await store.open()
    try {
      const entry = await store.store({ content: 'to be deleted', kind: 'note' })
      expect(store.delete(entry.id)).toBe(true)
      expect(store.get(entry.id)).toBeUndefined()
      expect(store.delete(entry.id)).toBe(false)
    } finally {
      store.close()
    }
  })

  it('rejects empty content with MEMORY_INVALID_CONTENT', async () => {
    const store = makeStore()
    await store.open()
    try {
      await expect(store.store({ content: '   ' }))
        .rejects.toMatchObject({ code: 'MEMORY_INVALID_CONTENT' })
    } finally {
      store.close()
    }
  })

  it('fails loud when no embedding service is configured', async () => {
    const store = new SqliteMemoryStore({ databasePath: ':memory:' })
    await store.open()
    try {
      await expect(store.store({ content: 'hello' }))
        .rejects.toMatchObject({ code: 'MEMORY_EMBEDDING_UNAVAILABLE' })
    } finally {
      store.close()
    }
  })

  it('persists memories across reopen (cross-session)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-memory-'))
    const databasePath = join(dir, 'memory.db')
    try {
      const first = new SqliteMemoryStore({ databasePath })
      first.setEmbeddingService(new TestEmbeddingService())
      await first.open()
      const entry = await first.store({ content: 'remember this across sessions', kind: 'fact' })
      first.close()

      // A fresh store on the same path must see the persisted entry.
      const second = new SqliteMemoryStore({ databasePath })
      second.setEmbeddingService(new TestEmbeddingService())
      await second.open()
      try {
        const fetched = second.get(entry.id)
        expect(fetched?.content).toBe('remember this across sessions')
        expect(fetched?.kind).toBe('fact')
        expect(second.list().total).toBe(1)
      } finally {
        second.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a schema-version-mismatched database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-memory-bad-'))
    const databasePath = join(dir, 'memory.db')
    try {
      const first = new SqliteMemoryStore({ databasePath })
      first.setEmbeddingService(new TestEmbeddingService())
      await first.open()
      first.close()
      // Corrupt the version pragma so the next open refuses the database.
      const nodeSqlite = await import('node:sqlite')
      const db = new nodeSqlite.DatabaseSync(databasePath)
      db.exec('PRAGMA user_version = 999')
      db.close()
      const second = new SqliteMemoryStore({ databasePath })
      second.setEmbeddingService(new TestEmbeddingService())
      await expect(second.open()).rejects.toThrow(/incompatible/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('Memory plugin integration', () => {
  it('registers ctx.memory through the Cordis plugin', async () => {
    const ctx = new Context()
    await ctx.plugin(EmbeddingRuntime, {})
    await ctx.plugin(hashPlugin, { dimensions: 64 })
    const memoryFiber = await ctx.plugin(memoryPlugin, {})
    try {
      const entry = await ctx.memory.store({ content: 'integration test memory', kind: 'fact' })
      expect(entry.content).toBe('integration test memory')
      const recalled = await ctx.memory.recall({ query: 'integration test', threshold: 0 })
      expect(recalled.entries.length).toBeGreaterThan(0)
      const listed = await ctx.memory.list()
      expect(listed.total).toBeGreaterThan(0)
    } finally {
      await memoryFiber.dispose()
    }
  })

  it('defaults recall limit and threshold from config', async () => {
    const ctx = new Context()
    await ctx.plugin(EmbeddingRuntime, {})
    await ctx.plugin(hashPlugin, { dimensions: 64 })
    const memoryFiber = await ctx.plugin(memoryPlugin, { defaultRecallLimit: 1, defaultRecallThreshold: 0 })
    try {
      for (let i = 0; i < 3; i++) {
        await ctx.memory.store({ content: `topic item ${i}`, kind: 'fact' })
      }
      const result = await ctx.memory.recall({ query: 'topic' })
      expect(result.entries.length).toBeLessThanOrEqual(1)
    } finally {
      await memoryFiber.dispose()
    }
  })

  it('exposes MemoryError from the seam', () => {
    expect(typeof MemoryError).toBe('function')
  })
})
