import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { ToolCallId as CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import EmbeddingRuntime from '@deepseek-ai/dsh-embedding'
import * as hashPlugin from '@deepseek-ai/dsh-embedding-hash'
import * as memoryPlugin from '@deepseek-ai/dsh-memory-sqlite'
import * as tool from '../src/index.ts'

const testToolSignal = new AbortController().signal

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(EmbeddingRuntime, {})
  await ctx.plugin(hashPlugin, { dimensions: 64 })
  await ctx.plugin(memoryPlugin, {})
  await ctx.plugin(tool, {})
  return ctx
}

let callCounter = 0
function callTool(ctx: Context, name: string, args: unknown): Promise<ToolExecutionResult> {
  return executeToolFixture(ctx, {
    signal: testToolSignal,
    callId: CallId(`call-${++callCounter}`),
    name,
    arguments: args,
  })
}

/** Unwrap a successful tool result or fail the test on an error result. */
function value(result: { isError: boolean; value?: unknown }): unknown {
  if (result.isError) throw new Error('expected tool success')
  return result.value
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

describe('dsh-tool-memory', () => {
  it('registers memory_store, memory_recall, and memory_list tools', async () => {
    const ctx = await setup()
    const names = ctx.tools.schemas().map(s => s.name)
    expect(names).toContain('memory_store')
    expect(names).toContain('memory_recall')
    expect(names).toContain('memory_list')
  })

  it('stores a memory through memory_store and returns the entry', async () => {
    const ctx = await setup()
    const result = await callTool(ctx, 'memory_store', {
      content: 'The user prefers TypeScript over JavaScript',
      kind: 'preference',
      tags: ['lang'],
    })
    expect(result.isError).toBe(false)
    const stored = value(result) as { content: string; kind: string; tags: string[]; id: string }
    expect(stored.content).toBe('The user prefers TypeScript over JavaScript')
    expect(stored.kind).toBe('preference')
    expect(stored.tags).toEqual(['lang'])
    expect(typeof stored.id).toBe('string')
  })

  it('recalls semantically related memories through memory_recall', async () => {
    const ctx = await setup()
    await callTool(ctx, 'memory_store', { content: 'The team ships with pnpm', kind: 'fact' })
    await callTool(ctx, 'memory_store', { content: 'Deployments target PostgreSQL', kind: 'fact' })
    const result = await callTool(ctx, 'memory_recall', { query: 'database', threshold: 0 })
    expect(result.isError).toBe(false)
    const recalled = value(result) as { results: Array<{ content: string }> }
    expect(recalled.results.length).toBeGreaterThan(0)
    const contents = recalled.results.map(r => r.content).join(' ')
    expect(contents).toContain('PostgreSQL')
  })

  it('respects the recall limit argument', async () => {
    const ctx = await setup()
    for (let i = 0; i < 4; i++) {
      await callTool(ctx, 'memory_store', { content: `topic item ${i}`, kind: 'fact' })
    }
    const result = await callTool(ctx, 'memory_recall', { query: 'topic', limit: 2, threshold: 0 })
    expect(result.isError).toBe(false)
    const recalled = value(result) as { results: unknown[] }
    expect(recalled.results.length).toBeLessThanOrEqual(2)
  })

  it('lists memories newest-first with a total', async () => {
    const ctx = await setup()
    await callTool(ctx, 'memory_store', { content: 'first', kind: 'note' })
    await callTool(ctx, 'memory_store', { content: 'second', kind: 'note' })
    const result = await callTool(ctx, 'memory_list', {})
    expect(result.isError).toBe(false)
    const listed = value(result) as { total: number; entries: Array<{ content: string }> }
    expect(listed.total).toBe(2)
    expect(listed.entries[0]!.content).toBe('second')
  })

  it('rejects empty memory_store content', async () => {
    const ctx = await setup()
    const result = await callTool(ctx, 'memory_store', { content: '   ' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('not be empty')
  })

  it('rejects empty memory_recall query', async () => {
    const ctx = await setup()
    const result = await callTool(ctx, 'memory_recall', { query: '' })
    expect(result.isError).toBe(true)
  })

  it('presents the store call as a generic card with the content', async () => {
    const ctx = await setup()
    const def = ctx.tools.get('memory_store')!
    const view = def.presentCall?.({ content: 'remember this', kind: 'fact' })
    expect(view).toEqual({
      card: 'generic',
      title: 'memory_store (fact)',
      content: [{ type: 'text', text: 'remember this' }],
    })
  })

  it('unregisters the tools when the contributing fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(EmbeddingRuntime, {})
    await ctx.plugin(hashPlugin, { dimensions: 64 })
    await ctx.plugin(memoryPlugin, {})
    const fiber = await ctx.plugin(tool, {})
    expect(ctx.tools.schemas().some(s => s.name === 'memory_store')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(s => s.name === 'memory_store')).toBe(false)
  })

  it('has the namespace-plugin export shape (no stray default) so the Loader keeps name/inject/apply', () => {
    expect('default' in tool).toBe(false)
    expect(tool.name).toBe('tool-memory')
    expect(tool.inject).toEqual(['tools', 'memory', 'systemPrompt'])

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(tool) as Record<string, unknown>
    expect(unwrapped).toBe(tool)
    expect(unwrapped.name).toBe('tool-memory')
    expect(unwrapped.inject).toEqual(['tools', 'memory', 'systemPrompt'])
    expect(typeof unwrapped.apply).toBe('function')
  })
})
