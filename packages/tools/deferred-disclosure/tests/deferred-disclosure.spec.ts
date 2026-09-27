import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ToolCallId as CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { scopeOf, type ScopeKey } from '@deepseek-ai/dsh-scope'
import * as Deferred from '@deepseek-ai/dsh-deferred-disclosure'
import type { DeferredDisclosureConfig } from '@deepseek-ai/dsh-deferred-disclosure'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'

/**
 * Behavior + coverage suite for progressive tool disclosure. Boots the real
 * agent-loop spine (no Loader file, mirroring the `repeat-tool-reminder`
 * product-visible-plugin precedent) and asserts model-visible output: the
 * assembled tool schemas are stripped while deferred and restored after
 * `tool_search`, plus every `apply` branch and `tool_search` error path.
 */

const signal = new AbortController().signal

async function harness(config: DeferredDisclosureConfig = {}): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Deferred, config)
  ctx.tools.register(defineContentToolFixture({
    name: 'mcp__weather',
    description: 'Get the weather for a city',
    parameters: { location: { type: 'string', required: true, description: 'city' } },
    async execute() { return [{ type: 'text', text: 'ok' }] },
  }))
  ctx.tools.register(defineContentToolFixture({
    name: 'bar',
    description: 'An ordinary tool',
    parameters: { x: { type: 'string', required: true, description: 'value' } },
    async execute() { return [{ type: 'text', text: 'ok' }] },
  }))
  return ctx
}

function findTool(assembly: PromptAssembly, name: string): ToolSchema {
  const tool = assembly.tools.find(t => t.name === name)
  if (tool === undefined) throw new Error(`tool ${name} absent from assembly`)
  return tool
}

function isStripped(tool: ToolSchema): boolean {
  return JSON.stringify(tool.parameters) === JSON.stringify({ type: 'object', properties: {} })
    && tool.description.includes('[deferred')
}

async function assembleScope(ctx: Context, scope: ScopeKey | undefined): Promise<PromptAssembly> {
  return ctx.systemPrompt.assemble(scope === undefined ? {} : { scope })
}

describe('disabled when deferPatterns is empty', () => {
  it('keeps every tool schema intact (scoped and global assembly)', async () => {
    const ctx = await harness({})
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    const scoped = await assembleScope(ctx, scopeOf(agent.ctx))
    const global = await ctx.systemPrompt.assemble({})
    expect(isStripped(findTool(scoped, 'mcp__weather'))).toBe(false)
    expect(isStripped(findTool(global, 'mcp__weather'))).toBe(false)
    expect(JSON.stringify(findTool(scoped, 'mcp__weather').parameters)).toContain('location')
    expect(findTool(scoped, 'tool_search').parameters).toBeDefined()
  })
})

describe('strips deferred tools, keeps others and tool_search', () => {
  it('withholds mcp__weather params but keeps bar and tool_search full', async () => {
    const ctx = await harness({ deferPatterns: ['mcp__*'] })
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    const assembly = await assembleScope(ctx, scopeOf(agent.ctx))
    expect(isStripped(findTool(assembly, 'mcp__weather'))).toBe(true)
    expect(isStripped(findTool(assembly, 'bar'))).toBe(false)
    expect(JSON.stringify(findTool(assembly, 'bar').parameters)).toContain('x')
    expect(JSON.stringify(findTool(assembly, 'tool_search').parameters)).toContain('name')
    // Global (no-scope) assembly must also strip the deferred tool.
    const global = await ctx.systemPrompt.assemble({})
    expect(isStripped(findTool(global, 'mcp__weather'))).toBe(true)
  })
})

describe('reveals after tool_search and keeps the full schema thereafter', () => {
  it('loads the schema and restores parameters for later assemblies', async () => {
    const ctx = await harness({ deferPatterns: ['mcp__*'] })
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    const scope = scopeOf(agent.ctx)
    expect(isStripped(findTool(await assembleScope(ctx, scope), 'mcp__weather'))).toBe(true)

    const result = await ctx.tools.execute({
      callId: 't1' as CallId,
      name: 'tool_search',
      arguments: { name: 'mcp__weather' },
      agent,
      signal,
    })
    expect(result.isError).toBe(false)
    const value = String((result as { value: unknown }).value)
    expect(value).toContain('mcp__weather')
    expect(value).toContain('location')

    // A second reveal for the same tool must stay idempotent and still succeed.
    const again = await ctx.tools.execute({
      callId: 't2' as CallId,
      name: 'tool_search',
      arguments: { name: 'mcp__weather' },
      agent,
      signal,
    })
    expect(again.isError).toBe(false)

    const after = await assembleScope(ctx, scope)
    expect(isStripped(findTool(after, 'mcp__weather'))).toBe(false)
    expect(JSON.stringify(findTool(after, 'mcp__weather').parameters)).toContain('location')
  })
})

describe('pattern matching is name-only and glob-scoped', () => {
  it('defers only the matching tool', async () => {
    const ctx = await harness({ deferPatterns: ['bar'] })
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    const assembly = await assembleScope(ctx, scopeOf(agent.ctx))
    expect(isStripped(findTool(assembly, 'bar'))).toBe(true)
    expect(isStripped(findTool(assembly, 'mcp__weather'))).toBe(false)
  })
})

describe('apply with no config', () => {
  it('defaults to disabled (no stripping) yet still registers tool_search', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    Deferred.apply(ctx, {})
    ctx.tools.register(defineContentToolFixture({
      name: 'mcp__weather',
      description: 'Get the weather for a city',
      parameters: { location: { type: 'string', required: true, description: 'city' } },
      async execute() { return [{ type: 'text', text: 'ok' }] },
    }))
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    const assembly = await assembleScope(ctx, scopeOf(agent.ctx))
    expect(isStripped(findTool(assembly, 'mcp__weather'))).toBe(false)
    expect(findTool(assembly, 'tool_search').parameters).toBeDefined()
  })
})

describe('tool_search error paths', () => {
  it('fails a call with no agent', async () => {
    const ctx = await harness({ deferPatterns: ['mcp__*'] })
    const result = await ctx.tools.execute({
      callId: 't1' as CallId,
      name: 'tool_search',
      arguments: { name: 'mcp__weather' },
      signal,
    })
    expect(result.isError).toBe(true)
    expect(String((result as { error?: { message?: string } }).error?.message)).toContain('agent turn')
  })

  it('fails an unscoped agent', async () => {
    const ctx = await harness({ deferPatterns: ['mcp__*'] })
    const unscoped = { ctx: new Context() } as unknown as Agent
    const result = await ctx.tools.execute({
      callId: 't1' as CallId,
      name: 'tool_search',
      arguments: { name: 'mcp__weather' },
      agent: unscoped,
      signal,
    })
    expect(result.isError).toBe(true)
    expect(String((result as { error?: { message?: string } }).error?.message)).toContain('scoped agent')
  })

  it('fails an unknown tool name', async () => {
    const ctx = await harness({ deferPatterns: ['mcp__*'] })
    const agent = await ctx.agentLoop.create(SessionId('a1'), { provider: 'mock', model: 'mock' })
    const result = await ctx.tools.execute({
      callId: 't1' as CallId,
      name: 'tool_search',
      arguments: { name: 'nope' },
      agent,
      signal,
    })
    expect(result.isError).toBe(true)
    expect(String((result as { error?: { message?: string } }).error?.message)).toContain('unknown tool')
  })
})
