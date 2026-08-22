import { randomUUID } from 'node:crypto'
import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type {
  MemoryEntry,
  MemoryId,
  MemoryKind,
  MemoryListRequest,
  MemoryListResult,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryStoreRequest,
} from '@deepseek-ai/dsh-memory'
import { MemoryError, MemoryId as toMemoryId } from '@deepseek-ai/dsh-memory'
import type { EmbeddingResult } from '@deepseek-ai/dsh-embedding'
import { decodeMemoryRow, openDatabase } from './schema.ts'

export interface SqliteMemoryStoreConfig {
  readonly databasePath?: string
  readonly busyTimeoutMs?: number
}

const DEFAULT_BUSY_TIMEOUT_MS = 5000

export class SqliteMemoryStore {
  private readonly databasePath: string
  private readonly busyTimeoutMs: number
  private db!: DatabaseSync
  private opened = false
  private databaseConstructor!: typeof import('node:sqlite')['DatabaseSync']
  private embeddingService: { embed: (texts: string[], signal?: AbortSignal) => Promise<EmbeddingResult> } | null = null
  private stmtInsert!: StatementSync
  private stmtUpdate!: StatementSync
  private stmtGetById!: StatementSync
  private stmtDelete!: StatementSync
  private stmtCountAll!: StatementSync
  private stmtCountByKind!: StatementSync
  private stmtListAll!: StatementSync
  private stmtListByKind!: StatementSync
  private stmtAllRows!: StatementSync

  constructor(config: SqliteMemoryStoreConfig = {}) {
    this.databasePath = config.databasePath ?? ':memory:'
    this.busyTimeoutMs = config.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS
  }

  setEmbeddingService(service: { embed: (texts: string[], signal?: AbortSignal) => Promise<EmbeddingResult> } | null): void {
    this.embeddingService = service
  }

  async open(): Promise<void> {
    const nodeSqlite = await importNodeSqlite()
    this.databaseConstructor = nodeSqlite.DatabaseSync
    this.db = openDatabase(this.databaseConstructor, this.databasePath, this.busyTimeoutMs)
    this.prepareStatements()
    this.opened = true
  }

  private prepareStatements(): void {
    this.stmtInsert = this.db.prepare(
      'INSERT INTO memories (id, content, kind, tags, source, embedding, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    this.stmtUpdate = this.db.prepare(
      'UPDATE memories SET content = COALESCE(?, content), kind = COALESCE(?, kind), tags = COALESCE(?, tags), embedding = COALESCE(?, embedding), updated_at = ? WHERE id = ?',
    )
    this.stmtGetById = this.db.prepare('SELECT * FROM memories WHERE id = ?')
    this.stmtDelete = this.db.prepare('DELETE FROM memories WHERE id = ?')
    this.stmtCountAll = this.db.prepare('SELECT count(*) as count FROM memories')
    this.stmtCountByKind = this.db.prepare('SELECT count(*) as count FROM memories WHERE kind = ?')
    this.stmtListAll = this.db.prepare('SELECT * FROM memories ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?')
    this.stmtListByKind = this.db.prepare('SELECT * FROM memories WHERE kind = ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?')
    this.stmtAllRows = this.db.prepare('SELECT * FROM memories')
  }

  close(): void {
    if (!this.opened) return
    this.db.close()
    this.opened = false
  }

  async store(request: MemoryStoreRequest, signal?: AbortSignal): Promise<MemoryEntry> {
    if (!this.embeddingService) {
      throw new MemoryError('embedding service not configured', 'MEMORY_EMBEDDING_UNAVAILABLE')
    }
    const content = request.content.trim()
    if (content.length === 0) {
      throw new MemoryError('memory content must not be empty', 'MEMORY_INVALID_CONTENT')
    }
    const kind = request.kind ?? 'note'
    const tags = request.tags ?? []
    const embeddingResult = await this.embeddingService.embed([content], signal)
    const vector = embeddingResult.vectors[0]
    if (vector === undefined) {
      throw new MemoryError('embedding service returned no vectors', 'MEMORY_EMBEDDING_FAILED')
    }
    const id = toMemoryId(randomUUID())
    const now = Date.now()
    this.stmtInsert.run(
      id,
      content,
      kind,
      JSON.stringify(tags),
      request.source ?? null,
      JSON.stringify(Array.from(vector)),
      now,
      now,
    )
    const entry: MemoryEntry = {
      id,
      content,
      kind,
      tags,
      createdAt: now,
      updatedAt: now,
    }
    if (request.source !== undefined) {
      (entry as { source: string }).source = request.source
    }
    return entry
  }

  async recall(request: MemoryRecallRequest, signal?: AbortSignal): Promise<MemoryRecallResult> {
    if (!this.embeddingService) {
      throw new MemoryError('embedding service not configured', 'MEMORY_EMBEDDING_UNAVAILABLE')
    }
    const limit = request.limit ?? 10
    const threshold = request.threshold ?? 0.5
    if (limit < 1) {
      return { entries: [], scores: [] }
    }
    const embeddingResult = await this.embeddingService.embed([request.query], signal)
    const queryVector = embeddingResult.vectors[0]
    if (queryVector === undefined) {
      throw new MemoryError('embedding service returned no vectors', 'MEMORY_EMBEDDING_FAILED')
    }
    const allRows = this.stmtAllRows.all() as unknown[]
    const entriesWithScore: Array<{ entry: MemoryEntry; score: number }> = []
    for (const row of allRows) {
      const decoded = decodeMemoryRow(row)
      if (request.kind !== undefined && decoded.kind !== request.kind) continue
      const storedVector = new Float32Array(JSON.parse(decoded.embedding) as number[])
      const score = cosineSimilarity(queryVector, storedVector)
      if (score >= threshold) {
        entriesWithScore.push({ entry: rowToEntry(decoded), score })
      }
    }
    entriesWithScore.sort((a, b) => b.score - a.score)
    const top = entriesWithScore.slice(0, limit)
    return {
      entries: top.map(item => item.entry),
      scores: top.map(item => item.score),
    }
  }

  list(request: MemoryListRequest = {}): MemoryListResult {
    const limit = request.limit ?? 50
    const offset = request.offset ?? 0
    const countRow = request.kind !== undefined
      ? this.stmtCountByKind.get(request.kind) as { count: number }
      : this.stmtCountAll.get() as { count: number }
    const rows = request.kind !== undefined
      ? (this.stmtListByKind.all(request.kind, limit, offset) as unknown[])
      : (this.stmtListAll.all(limit, offset) as unknown[])
    return {
      entries: rows.map(row => rowToEntry(decodeMemoryRow(row))),
      total: countRow.count,
    }
  }

  get(id: MemoryId): MemoryEntry | undefined {
    const row = this.stmtGetById.get(id)
    if (row === undefined) return undefined
    return rowToEntry(decodeMemoryRow(row))
  }

  async update(
    id: MemoryId,
    updates: Partial<Pick<MemoryStoreRequest, 'content' | 'kind' | 'tags'>>,
    signal?: AbortSignal,
  ): Promise<MemoryEntry> {
    const existing = this.get(id)
    if (existing === undefined) {
      throw new MemoryError(`memory "${id}" not found`, 'MEMORY_NOT_FOUND')
    }
    const newContent = updates.content?.trim()
    const newKind = updates.kind
    const newTags = updates.tags

    let newEmbedding: Float32Array | undefined
    if (newContent !== undefined && newContent.length === 0) {
      throw new MemoryError('memory content must not be empty', 'MEMORY_INVALID_CONTENT')
    }
    if (newContent !== undefined && this.embeddingService) {
      const result = await this.embeddingService.embed([newContent], signal)
      newEmbedding = result.vectors[0]
    }

    const now = Date.now()
    this.stmtUpdate.run(
      newContent ?? null,
      newKind ?? null,
      newTags !== undefined ? JSON.stringify(newTags) : null,
      newEmbedding !== undefined ? JSON.stringify(Array.from(newEmbedding)) : null,
      now,
      id,
    )

    const updated = this.get(id)
    if (updated === undefined) {
      throw new MemoryError(`memory "${id}" not found after update`, 'MEMORY_NOT_FOUND')
    }
    return updated
  }

  delete(id: MemoryId): boolean {
    const result = this.stmtDelete.run(id)
    return result.changes > 0
  }
}

function rowToEntry(
  row: {
    id: string
    content: string
    kind: string
    tags: string
    source: string | null
    created_at: number
    updated_at: number
  },
): MemoryEntry {
  const entry: MemoryEntry = {
    id: toMemoryId(row.id),
    content: row.content,
    kind: row.kind as MemoryKind,
    tags: JSON.parse(row.tags) as string[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  if (row.source !== null) {
    (entry as { source: string }).source = row.source
  }
  return entry
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    dot += av * bv
    normA += av * av
    normB += bv * bv
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

let nodeSqliteModule: Promise<typeof import('node:sqlite')> | undefined

function importNodeSqlite(): Promise<typeof import('node:sqlite')> {
  nodeSqliteModule ??= doImport()
  return nodeSqliteModule
}

async function doImport(): Promise<typeof import('node:sqlite')> {
  const emitWarning = Reflect.get(process, 'emitWarning') as (warning: string | Error, ...args: unknown[]) => void
  process.emitWarning = () => {}
  try {
    return await import('node:sqlite')
  } finally {
    Reflect.set(process, 'emitWarning', emitWarning)
  }
}
