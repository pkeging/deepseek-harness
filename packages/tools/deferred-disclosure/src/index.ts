/**
 * Progressive tool disclosure for the DeepSeek Harness.
 *
 * With many tools (especially MCP-discovered ones) the per-request tool schema
 * cost dominates the prompt and crowds out task context. This plugin withholds a
 * tool's parameter schema until the model explicitly asks for it via
 * `tool_search`, then reveals that tool's full schema for every later request in
 * the same agent scope. The model sees only each deferred tool's name and a
 * one-line hint, so large tool catalogs stop inflating every turn.
 *
 * @module @deepseek-ai/dsh-deferred-disclosure
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { scopeOf, type ScopeKey } from '@deepseek-ai/dsh-scope'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import type { AssembleContext, PromptAssembly } from '@deepseek-ai/dsh-system-prompt'

/** The model-facing loader tool this plugin always keeps fully visible. */
export const TOOL_SEARCH_NAME = 'tool_search'

/** Scope-key sentinel for the global (no-agent) assembly. */
const GLOBAL_SCOPE: ScopeKey = {}

/** Plugin name registered with Cordis. */
export const name = 'deferred-disclosure'
/** Services this plugin requires before it can apply. */
export const inject = ['tools', 'systemPrompt']

/** Plugin config: which tool names start deferred. */
export interface DeferredDisclosureConfig {
  /**
   * Glob patterns matched against tool names. A tool whose name matches any
   * pattern starts with its parameter schema withheld; the model loads it via
   * `tool_search`. An empty list disables the plugin (all schemas stay visible).
   * Patterns support `*` wildcards, e.g. `mcp__*`.
   */
  deferPatterns?: string[]
}

/** Raw schemastery config schema. */
export const Config = z.object({
  deferPatterns: z.array(z.string()).default([]),
})

/** Escape a literal segment of a glob pattern for regex construction. */
function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Match a tool name against one `*`-wildcard glob pattern. */
function matchGlob(pattern: string, name: string): boolean {
  const source = `^${pattern.split('*').map(escapeRegex).join('.*')}$`
  return new RegExp(source).test(name)
}

/** Per-scope set of tool names whose full schema is currently revealed. */
class RevealStore {
  private readonly scopes = new Map<ScopeKey, Set<string>>()

  private setFor(key: ScopeKey): Set<string> {
    let set = this.scopes.get(key)
    if (set === undefined) {
      set = new Set()
      this.scopes.set(key, set)
    }
    return set
  }

  /** Reveal a tool for the given scope so later assemblies keep its full schema. */
  reveal(scope: ScopeKey, toolName: string): void {
    this.setFor(scope).add(toolName)
  }

  /** Whether a tool is currently revealed (or always-visible) for a scope. */
  isRevealed(scope: ScopeKey | undefined, toolName: string): boolean {
    const set = this.scopes.get(scope ?? GLOBAL_SCOPE)
    return set === undefined ? false : set.has(toolName)
  }
}

/**
 * Apply progressive tool disclosure.
 * @param ctx - the Cordis context the plugin mounts into.
 * @param config - resolved plugin config.
 */
export function apply(ctx: Context, config: DeferredDisclosureConfig): void {
  const patterns = config.deferPatterns ?? []
  const revealed = new RevealStore()

  const toolSearch = defineTool({
    name: TOOL_SEARCH_NAME,
    description: 'Load the full parameter schema of a deferred tool by name so you can call it. Call this before using any tool whose description ends with a "[deferred …]" hint.',
    parameters: {
      name: { type: 'string', required: true, description: 'Exact name of the tool to load' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute(args: { name: string }, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        throw new Error(`${TOOL_SEARCH_NAME} requires an agent turn`)
      }
      const scope = scopeOf(agent.ctx)
      if (scope === undefined) {
        throw new Error(`${TOOL_SEARCH_NAME} requires a scoped agent`)
      }
      const definition = ctx.tools.get(args.name, scope)
      if (definition === undefined) {
        throw new Error(`unknown tool "${args.name}"`)
      }
      revealed.reveal(scope, args.name)
      const schema: ToolSchema = {
        name: definition.name,
        description: definition.description,
        parameters: (definition.parameters as Record<string, unknown> | undefined)
          ?? { type: 'object', properties: {} },
      }
      return Promise.resolve(JSON.stringify(schema, null, 2))
    },
  })

  ctx.tools.register(toolSearch)

  ctx.on('system-prompt/assemble', async (
    _assembly: PromptAssembly,
    context: AssembleContext,
    next: () => Promise<PromptAssembly>,
  ): Promise<PromptAssembly> => {
    const base = await next()
    if (patterns.length === 0) return base
    base.tools = base.tools.map((schema) => {
      if (schema.name === TOOL_SEARCH_NAME) return schema
      if (revealed.isRevealed(context.scope, schema.name)) return schema
      if (!patterns.some(pattern => matchGlob(pattern, schema.name))) return schema
      return {
        ...schema,
        description: `${schema.description}\n[deferred — call ${TOOL_SEARCH_NAME}("${schema.name}") to load its parameters before using it]`,
        parameters: { type: 'object', properties: {} },
      }
    })
    return base
  })
}
