import type { DatabaseSync } from 'node:sqlite'

export const SCHEMA_VERSION = 1
export const MEMORY_SQLITE_APPLICATION_ID = 0x4453484D

export interface MemoryRow {
  readonly id: string
  readonly content: string
  readonly kind: string
  readonly tags: string
  readonly source: string | null
  readonly embedding: string
  readonly created_at: number
  readonly updated_at: number
}

type DatabaseSyncConstructor = typeof import('node:sqlite')['DatabaseSync']

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

const SCHEMA_SQL = `
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fact',
  tags TEXT NOT NULL DEFAULT '[]',
  source TEXT,
  embedding TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_memories_kind ON memories(kind);
CREATE INDEX idx_memories_created_at ON memories(created_at DESC);
`

export function openDatabase(
  Database: DatabaseSyncConstructor,
  path: string,
  busyTimeoutMs: number,
): DatabaseSync {
  const db = new Database(path, { timeout: busyTimeoutMs })
  try {
    db.exec('PRAGMA trusted_schema = OFF')
    db.exec('PRAGMA mmap_size = 0')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = FULL')
    configureDatabase(Database, db, path)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

function configureDatabase(
  Database: DatabaseSyncConstructor,
  db: DatabaseSync,
  path: string,
): void {
  let began = false
  try {
    db.exec('BEGIN IMMEDIATE')
    began = true
    const userVersionRow = db.prepare('PRAGMA user_version').get() as { user_version: number }
    const appIdRow = db.prepare('PRAGMA application_id').get() as { application_id: number }
    const countRow = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get() as { count: number }
    const onDisk = userVersionRow.user_version
    const applicationId = appIdRow.application_id
    const tableCount = countRow.count

    if (onDisk === 0 && (applicationId !== 0 || tableCount > 0)) {
      throw new Error(`memory database at "${path}" has an unversioned schema or application identity`)
    }
    if (onDisk !== 0 && onDisk !== SCHEMA_VERSION) {
      throw new Error(
        `memory database at "${path}" has schema version ${onDisk}, incompatible with this build (${SCHEMA_VERSION})`,
      )
    }
    if (onDisk !== 0 && applicationId !== MEMORY_SQLITE_APPLICATION_ID) {
      throw new Error(
        `memory database at "${path}" has application id ${applicationId}, expected ${MEMORY_SQLITE_APPLICATION_ID}`,
      )
    }
    if (onDisk === 0) {
      db.exec(SCHEMA_SQL)
      db.exec(`PRAGMA application_id = ${MEMORY_SQLITE_APPLICATION_ID}`)
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    }
    validateSchema(Database, db, path)
    db.exec('COMMIT')
    began = false
  } catch (error) {
    if (began) {
      try { db.exec('ROLLBACK') } catch { /* retain original error */ }
    }
    throw error
  }
}

let canonicalSchema: string | undefined

function expectedSchema(Database: DatabaseSyncConstructor): string {
  if (canonicalSchema !== undefined) return canonicalSchema
  const reference = new Database(':memory:')
  try {
    reference.exec(SCHEMA_SQL)
    canonicalSchema = serializeSchema(reference)
    return canonicalSchema
  } finally {
    reference.close()
  }
}

function serializeSchema(db: DatabaseSync): string {
  const rows = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY type, name").all() as Array<{ type: string; name: string; tbl_name: string; sql: string }>
  return JSON.stringify(rows.map(r => ({ ...r, sql: r.sql.replaceAll(/\s+/gu, ' ').trim() })))
}

function validateSchema(
  Database: DatabaseSyncConstructor,
  db: DatabaseSync,
  path: string,
): void {
  if (serializeSchema(db) !== expectedSchema(Database)) {
    throw new Error(`memory database at "${path}" does not contain the required schema objects`)
  }
}

export function decodeMemoryRow(value: unknown): MemoryRow {
  if (typeof value !== 'object' || value === null) throw new Error('memory row must be an object')
  const row = value as Record<string, unknown>
  const id = stringField(row, 'id')
  if (!UUID.test(id)) throw new Error('memory id must be a UUID')
  const kind = stringField(row, 'kind')
  const tags = stringField(row, 'tags')
  JSON.parse(tags)
  const embedding = stringField(row, 'embedding')
  JSON.parse(embedding)
  return {
    id,
    content: stringField(row, 'content'),
    kind,
    tags,
    source: nullableStringField(row, 'source'),
    embedding,
    created_at: integerField(row, 'created_at'),
    updated_at: integerField(row, 'updated_at'),
  }
}

function stringField(row: Record<string, unknown>, key: string): string {
  const v = row[key]
  if (typeof v !== 'string') throw new Error(`memory ${key} must be a string`)
  return v
}

function nullableStringField(row: Record<string, unknown>, key: string): string | null {
  const v = row[key]
  if (v === null) return null
  if (typeof v !== 'string') throw new Error(`memory ${key} must be a string or null`)
  return v
}

function integerField(row: Record<string, unknown>, key: string): number {
  const v = row[key]
  if (!Number.isSafeInteger(v)) throw new Error(`memory ${key} must be a safe integer`)
  return v as number
}
