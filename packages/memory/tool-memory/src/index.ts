import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import type { MemoryListRequest, MemoryRecallRequest, MemoryStoreRequest } from '@deepseek-ai/dsh-memory'
import type {} from '@deepseek-ai/dsh-system-prompt'

export const MEMORY_STORE_MAX_CONTENT_LENGTH = 4000
export const MEMORY_RECALL_MAX_RESULTS = 10
export const MEMORY_LIST_MAX_RESULTS = 50
export const DEFAULT_MEMORY_TOOL_TIMEOUT_MS = 15_000

export const name = 'tool-memory'

export const inject = ['tools', 'memory', 'systemPrompt']

export interface Config {
  /** Register the `memory_store` tool. Defaults to `true`. */
  readonly store?: boolean
  /** Register the `memory_recall` tool. Defaults to `true`. */
  readonly recall?: boolean
  /** Register the `memory_list` tool. Defaults to `true`. */
  readonly list?: boolean
  /** Maximum entries one `memory_recall` call returns. Defaults to `10`. */
  readonly recallMaxResults?: number
  /** Maximum entries one `memory_list` call returns. Defaults to `50`. */
  readonly listMaxResults?: number
  /** Deadline for one `memory_store` call in milliseconds. Defaults to `15000`. */
  readonly storeTimeoutMs?: number
  /** Deadline for one `memory_recall` call in milliseconds. Defaults to `15000`. */
  readonly recallTimeoutMs?: number
  /** Deadline for one `memory_list` call in milliseconds. Defaults to `15000`. */
  readonly listTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  store: z.boolean().default(true),
  recall: z.boolean().default(true),
  list: z.boolean().default(true),
  recallMaxResults: z.number().step(1).min(1).default(MEMORY_RECALL_MAX_RESULTS),
  listMaxResults: z.number().step(1).min(1).default(MEMORY_LIST_MAX_RESULTS),
  storeTimeoutMs: z.number().default(DEFAULT_MEMORY_TOOL_TIMEOUT_MS),
  recallTimeoutMs: z.number().default(DEFAULT_MEMORY_TOOL_TIMEOUT_MS),
  listTimeoutMs: z.number().default(DEFAULT_MEMORY_TOOL_TIMEOUT_MS),
})

type ResolvedConfig = Required<Config>

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`tool-memory: ${name} must be a positive integer`)
  }
}

export function apply(ctx: Context, config: Config): void {
  const resolved = config as ResolvedConfig
  assertPositiveInteger('recallMaxResults', resolved.recallMaxResults)
  assertPositiveInteger('listMaxResults', resolved.listMaxResults)
  assertPositiveInteger('storeTimeoutMs', resolved.storeTimeoutMs)
  assertPositiveInteger('recallTimeoutMs', resolved.recallTimeoutMs)
  assertPositiveInteger('listTimeoutMs', resolved.listTimeoutMs)
  if (resolved.store) applyMemoryStoreTool(ctx, resolved.storeTimeoutMs)
  if (resolved.recall) applyMemoryRecallTool(ctx, resolved.recallMaxResults, resolved.recallTimeoutMs)
  if (resolved.list) applyMemoryListTool(ctx, resolved.listMaxResults, resolved.listTimeoutMs)
}

function applyMemoryStoreTool(ctx: Context, timeoutMs: number): void {
  ctx.systemPrompt.section({
    name: 'tool:memory_store',
    order: 115,
    text: 'Use the memory_store tool to save a piece of information to long-term memory that persists across sessions. Provide the content to remember, an optional kind (fact/decision/preference/idea/note), optional tags, and optional source. Returns the stored memory entry including its id.',
  })

  ctx.tools.register(defineTool({
    name: 'memory_store',
    description: 'Save information to cross-session long-term memory. Provide the content to remember; optionally specify kind, tags, and source.',
    parameters: {
      content: {
        type: 'string',
        required: true,
        description: 'The content to store in memory. Must be a non-empty string.',
      },
      kind: {
        type: 'string',
        description: 'Memory category: fact, decision, preference, idea, or note. Defaults to note.',
        enum: ['fact', 'decision', 'preference', 'idea', 'note'],
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional array of tag strings for categorization and filtering.',
      },
      source: {
        type: 'string',
        description: 'Optional source reference for this memory (e.g., a session identifier or document name).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          content: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          tags: { type: 'array', required: true, items: { type: 'string' } },
          source: { type: 'string' },
          createdAt: { type: 'integer', required: true },
          updatedAt: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => renderStoreResult(value),
      presentationMeta: (_args, value) => {
        const v = value as Record<string, unknown>
        return { kind: 'memory_store', id: v.id as string }
      },
    },
    timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const content = args.content
      if (content.trim().length === 0) {
        throw new Error('content must not be empty')
      }
      if (content.length > MEMORY_STORE_MAX_CONTENT_LENGTH) {
        throw new Error(`content must not exceed ${MEMORY_STORE_MAX_CONTENT_LENGTH} characters`)
      }
      const request: MemoryStoreRequest = {
        content,
        ...args.kind !== undefined ? { kind: args.kind } : {},
        ...args.tags !== undefined ? { tags: args.tags } : {},
        ...args.source !== undefined ? { source: args.source } : {},
      }
      const entry = await ctx.memory.store(request, exec.signal)
      return {
        id: entry.id,
        content: entry.content,
        kind: entry.kind,
        tags: [...entry.tags],
        ...entry.source !== undefined ? { source: entry.source } : {},
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      }
    },
    presentCall: presentMemoryStoreCall,
  }))
}

function applyMemoryRecallTool(ctx: Context, maxResults: number, timeoutMs: number): void {
  ctx.systemPrompt.section({
    name: 'tool:memory_recall',
    order: 116,
    text: `Use the memory_recall tool to search long-term memory by semantic similarity. Provide a query string describing what you want to recall. Returns up to ${maxResults} matching memory entries sorted by relevance score. Use the optional kind filter to narrow results by memory type.`,
  })

  ctx.tools.register(defineTool({
    name: 'memory_recall',
    description: `Search cross-session long-term memory by semantic similarity. Provide a query; returns up to ${maxResults} matching entries sorted by relevance.`,
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'The search query to match against stored memories semantically.',
      },
      limit: {
        type: 'integer',
        description: `Maximum number of results to return (1–${maxResults}). Defaults to ${maxResults}.`,
      },
      threshold: {
        type: 'number',
        description: 'Minimum similarity score threshold (0–1). Defaults to 0.5.',
      },
      kind: {
        type: 'string',
        description: 'Optional filter by memory kind: fact, decision, preference, idea, or note.',
        enum: ['fact', 'decision', 'preference', 'idea', 'note'],
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          results: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                content: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                tags: { type: 'array', required: true, items: { type: 'string' } },
                source: { type: 'string' },
                score: { type: 'number', required: true },
                createdAt: { type: 'integer', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => renderRecallResult(value),
      presentationMeta: (_args, value) => {
        const v = value as Record<string, unknown>
        const results = v.results as Array<Record<string, unknown>>
        return { kind: 'memory_recall', count: results.length }
      },
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const query = args.query
      if (query.trim().length === 0) {
        throw new Error('query must not be empty')
      }
      const limitRaw = args.limit ?? maxResults
      const limit = Math.max(1, Math.min(Math.floor(limitRaw), maxResults))
      const request: MemoryRecallRequest = {
        query,
        limit,
        ...args.threshold !== undefined ? { threshold: args.threshold } : {},
        ...args.kind !== undefined ? { kind: args.kind } : {},
      }
      const result = await ctx.memory.recall(request, exec.signal)
      return {
        results: result.entries.map((entry, i) => {
          const score = result.scores[i] ?? 0
          return {
            id: entry.id,
            content: entry.content,
            kind: entry.kind,
            tags: [...entry.tags],
            ...entry.source !== undefined ? { source: entry.source } : {},
            score,
            createdAt: entry.createdAt,
          }
        }),
      }
    },
    presentCall: presentMemoryRecallCall,
  }))
}

function applyMemoryListTool(ctx: Context, maxResults: number, timeoutMs: number): void {
  ctx.systemPrompt.section({
    name: 'tool:memory_list',
    order: 117,
    text: `Use the memory_list tool to list all stored memories in newest-first order, optionally filtered by kind. Returns up to ${maxResults} entries per page with a total count for pagination.`,
  })

  ctx.tools.register(defineTool({
    name: 'memory_list',
    description: `List cross-session memories in newest-first order, optionally filtered by kind. Returns up to ${maxResults} entries with total count.`,
    parameters: {
      kind: {
        type: 'string',
        description: 'Optional filter by memory kind: fact, decision, preference, idea, or note.',
        enum: ['fact', 'decision', 'preference', 'idea', 'note'],
      },
      limit: {
        type: 'integer',
        description: `Maximum entries per page (1–${maxResults}). Defaults to ${maxResults}.`,
      },
      offset: {
        type: 'integer',
        description: 'Pagination offset (0-based). Defaults to 0.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                content: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                tags: { type: 'array', required: true, items: { type: 'string' } },
                source: { type: 'string' },
                createdAt: { type: 'integer', required: true },
              },
            },
          },
          total: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => renderListResult(value),
      presentationMeta: (_args, value) => {
        const v = value as Record<string, unknown>
        return { kind: 'memory_list', total: v.total as number }
      },
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const limitRaw = args.limit ?? maxResults
      const limit = Math.max(1, Math.min(Math.floor(limitRaw), maxResults))
      const offset = args.offset !== undefined ? Math.max(0, Math.floor(args.offset)) : 0
      const request: MemoryListRequest = {
        limit,
        offset,
        ...args.kind !== undefined ? { kind: args.kind } : {},
      }
      const result = await ctx.memory.list(request, exec.signal)
      return {
        entries: result.entries.map(entry => ({
          id: entry.id,
          content: entry.content,
          kind: entry.kind,
          tags: [...entry.tags],
          ...entry.source !== undefined ? { source: entry.source } : {},
          createdAt: entry.createdAt,
        })),
        total: result.total,
      }
    },
    presentCall: presentMemoryListCall,
  }))
}

function renderStoreResult(value: unknown): ContentBlock[] {
  const v = value as Record<string, unknown>
  const tagText = Array.isArray(v.tags) && v.tags.length > 0 ? ` [${(v.tags as string[]).join(', ')}]` : ''
  return [{ type: 'text', text: `Stored memory (${v.kind as string})${tagText}: ${v.content as string}` }]
}

function renderRecallResult(value: unknown): ContentBlock[] {
  const v = value as Record<string, unknown>
  const results = v.results as Array<Record<string, unknown>>
  if (results.length === 0) {
    return [{ type: 'text', text: 'No matching memories found.' }]
  }
  const lines = results.map((r, i) => {
    const scorePct = Math.round((r.score as number) * 100)
    return `${i + 1}. (${scorePct}% match, ${r.kind as string}) ${r.content as string}`
  })
  return [{ type: 'text', text: `Found ${results.length} matching memories:\n${lines.join('\n')}` }]
}

function renderListResult(value: unknown): ContentBlock[] {
  const v = value as Record<string, unknown>
  const entries = v.entries as Array<Record<string, unknown>>
  const total = v.total as number
  if (entries.length === 0) {
    return [{ type: 'text', text: 'No memories stored yet.' }]
  }
  const lines = entries.map((e, i) => `${i + 1}. (${e.kind as string}) ${e.content as string}`)
  return [{ type: 'text', text: `Showing ${entries.length} of ${total} memories:\n${lines.join('\n')}` }]
}

function presentMemoryStoreCall(args: Record<string, unknown>): GenericCallView {
  return {
    card: 'generic',
    title: `memory_store${args.kind ? ` (${args.kind as string})` : ''}`,
    content: [{ type: 'text', text: args.content as string }],
  }
}

function presentMemoryRecallCall(args: Record<string, unknown>): GenericCallView {
  return {
    card: 'generic',
    title: `memory_recall${args.kind ? ` (${args.kind as string})` : ' (semantic search)'}`,
    content: [{ type: 'text', text: args.query as string }],
  }
}

function presentMemoryListCall(args: Record<string, unknown>): GenericCallView {
  return {
    card: 'generic',
    title: `memory_list${args.kind ? ` (${args.kind as string})` : ' (all)'}`,
    ...args.offset ? { content: [{ type: 'text' as const, text: `offset: ${args.offset as number}` }] } : {},
  }
}
