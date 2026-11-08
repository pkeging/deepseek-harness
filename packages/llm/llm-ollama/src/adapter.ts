/**
 * Ollama chat adapter.
 *
 * One instance owns the single route it is registered under and serves a local
 * daemon over `/api/chat`. Ollama carries text and tool calls only: a message's
 * structured blocks are flattened to the text they contribute, and an
 * assistant's tool calls are replayed through the native `tool_calls` field.
 * Attachments have no wire field, so image and file blocks become the same
 * placeholder text a text-only route receives rather than being dropped
 * silently.
 *
 * @module @deepseek-ai/dsh-llm-ollama/adapter
 */

import { attributionHeaders, LlmAdapter, LlmError, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock,
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmReasoningEffortInfo,
  LlmResolvedModelInfo,
  RequestMessage,
  StreamChunk,
  ToolCallId,
  ToolSchema,
} from '@deepseek-ai/dsh-llm'
import type { ResolvedConfig } from './config.ts'
import { decodeChunk, decodeLines } from './wire.ts'
import type { OllamaChatMessage, OllamaTagsResponse, OllamaToolCall } from './wire.ts'

/** Placeholder an attachment block becomes; Ollama has no field to carry it. */
const ATTACHMENT_PLACEHOLDER = '[attachment omitted: this route carries text and tool calls only]'

/** Effort that disables the daemon's thinking for a request. */
const REASONING_OFF = ReasoningEffortId('off')

/** Effort that sends no thinking field, leaving the decision to the daemon and the model. */
const REASONING_DEFAULT = ReasoningEffortId('default')

/**
 * Efforts this route accepts. The daemon's thinking is a switch rather than a
 * scale, so the only wire effect is disabling it; a level the daemon would have
 * to interpret stays with the daemon.
 */
const REASONING_EFFORTS: readonly LlmReasoningEffortInfo[] = [
  { id: REASONING_OFF, name: 'Off', description: 'Turn off the daemon\'s thinking for this session.' },
  { id: REASONING_DEFAULT, name: 'Daemon default', description: 'Send no thinking field; the daemon and the model decide.' },
]

/** The one adapter serving local Ollama models over `/api/chat`. */
export class OllamaAdapter extends LlmAdapter {
  /**
   * @param config - resolved connection facts this instance serves every request with.
   */
  constructor(private readonly config: ResolvedConfig) {
    super()
  }

  /**
   * Describe the local daemon route.
   * @param provider - the route passed to `registerAdapter()`.
   * @returns display metadata whose id is the registered route.
   */
  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Ollama (local daemon)' }
  }

  /**
   * Declare the reasoning switch every model on this route accepts.
   * @param provider - the route passed to `registerAdapter()`.
   * @param model - exact model id the caller selected.
   * @returns the route's identity plus its two thinking efforts.
   */
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      reasoning: { efforts: REASONING_EFFORTS, defaultEffort: REASONING_DEFAULT },
    })
  }

  /**
   * List the models this daemon currently serves.
   * @param provider - the route these entries belong to.
   * @returns one entry per installed model, text-only because the wire carries no attachment field.
   * @throws {LlmError} when the daemon cannot be reached or rejects the listing.
   */
  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    let response: Response
    try {
      response = await fetch(`${this.config.baseURL}/api/tags`, {
        headers: { ...attributionHeaders() },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      })
    } catch (error: unknown) {
      throw new LlmError(
        `Ollama model listing against ${this.config.baseURL} failed: ${messageOf(error)}`,
        'TRANSPORT',
        { cause: error instanceof Error ? error : new Error(String(error)) },
      )
    }
    if (!response.ok) {
      throw new LlmError(`Ollama rejected the model listing (${response.status})`, codeOf(response.status), { status: response.status })
    }
    const body = await response.json() as OllamaTagsResponse
    return (body.models ?? []).map(tag => ({
      provider,
      id: tag.name,
      name: tag.details?.parameter_size === undefined ? tag.name : `${tag.name} (${tag.details.parameter_size})`,
      inputModalities: ['text'],
    }))
  }

  /**
   * Stream one model response.
   * @param options - the assembled request.
   * @returns chunks in the harness stream vocabulary, ending with `finish`.
   * @throws {LlmError} when the daemon rejects the request or reports an in-band failure.
   */
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const response = await this.request(options)
    const body = response.body
    if (body === null) throw new LlmError('Ollama returned no response body', 'EMPTY_RESPONSE')
    yield* this.readChunks(body)
  }

  /**
   * Send one `/api/chat` request with streaming enabled.
   * @param options - the assembled request.
   * @returns the streaming response.
   * @throws {LlmError} when the daemon answers with a non-2xx status.
   */
  private async request(options: GenerateOptions): Promise<Response> {
    const model = options.model.length > 0 ? options.model : this.config.model
    const payload: Record<string, unknown> = {
      model,
      messages: toWireMessages(options),
      stream: true,
    }
    const generation: Record<string, unknown> = {}
    if (options.temperature !== undefined) generation.temperature = options.temperature
    const maxTokens = options.maxTokens ?? this.config.maxTokens
    if (maxTokens !== undefined) generation.num_predict = maxTokens
    if (options.stop !== undefined && options.stop.length > 0) generation.stop = options.stop
    if (Object.keys(generation).length > 0) payload.options = generation
    if (this.config.keepAlive !== undefined) payload.keep_alive = this.config.keepAlive
    if (options.reasoningEffort === REASONING_OFF) payload.think = false
    if (options.tools !== undefined && options.tools.length > 0) payload.tools = toWireTools(options.tools)

    let response: Response
    try {
      response = await fetch(`${this.config.baseURL}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...attributionHeaders() },
        body: JSON.stringify(payload),
        signal: mergeDeadline(options.signal, this.config.timeoutMs),
      })
    } catch (error: unknown) {
      throw new LlmError(
        `Ollama request to ${this.config.baseURL} failed: ${messageOf(error)}`,
        'TRANSPORT',
        { cause: error instanceof Error ? error : new Error(String(error)) },
      )
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new LlmError(
        `Ollama rejected the request (${response.status})${detail.length > 0 ? `: ${detail.slice(0, 400)}` : ''}`,
        codeOf(response.status),
        { status: response.status },
      )
    }
    return response
  }

  /**
   * Translate one decoded stream into harness chunks.
   * @param body - the daemon's newline-delimited JSON body.
   * @returns chunks for the reasoning and text blocks, any tool calls, usage, and the finish reason.
   * @throws {LlmError} when a line reports an in-band error.
   */
  private async *readChunks(body: ReadableStream<Uint8Array>): AsyncIterable<StreamChunk> {
    let reasoningIndex: number | undefined
    let reasoning = ''
    let textIndex: number | undefined
    let text = ''
    const calls: OllamaToolCall[] = []
    let nextIndex = 0
    let done = false
    let promptTokens = 0
    let outputTokens = 0
    let reason: string | undefined

    for await (const line of decodeLines(body)) {
      const chunk = decodeChunk(line)
      if (chunk === undefined) continue
      if (chunk.error !== undefined) throw new LlmError(`Ollama reported: ${chunk.error}`, 'SERVER')
      // A thinking model streams its reasoning before the answer; blocks open in
      // arrival order so the block indices a consumer replays stay chronological.
      const thinking = chunk.message?.thinking ?? ''
      if (thinking.length > 0) {
        if (reasoningIndex === undefined) {
          reasoningIndex = nextIndex
          nextIndex += 1
          yield { type: 'block-start', index: reasoningIndex, blockType: 'reasoning' }
        }
        reasoning += thinking
        yield { type: 'reasoning-delta', index: reasoningIndex, text: thinking }
      }
      const delta = chunk.message?.content ?? ''
      if (delta.length > 0) {
        if (textIndex === undefined) {
          textIndex = nextIndex
          nextIndex += 1
          yield { type: 'block-start', index: textIndex, blockType: 'text' }
        }
        text += delta
        yield { type: 'text-delta', index: textIndex, text: delta }
      }
      for (const call of chunk.message?.tool_calls ?? []) calls.push(call)
      if (chunk.done === true) {
        done = true
        promptTokens += chunk.prompt_eval_count ?? 0
        outputTokens += chunk.eval_count ?? 0
        reason = chunk.done_reason
      }
    }

    if (reasoningIndex !== undefined) yield { type: 'block-end', index: reasoningIndex, block: { type: 'reasoning', text: reasoning } }
    if (textIndex !== undefined) yield { type: 'block-end', index: textIndex, block: { type: 'text', text } }

    for (const call of calls) {
      const index = nextIndex
      nextIndex += 1
      yield { type: 'block-start', index, blockType: 'tool-call' }
      const block = toToolCallBlock(call, index)
      yield { type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: block.arguments }
      yield { type: 'block-end', index, block }
    }

    if (done) {
      yield { type: 'usage', usage: { inputTokens: promptTokens, outputTokens } }
      yield { type: 'finish', reason: finishOf(reason, calls.length > 0) }
    }
  }
}

/** The message text one content-block list contributes to a text-only route. */
function textOf(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    switch (block.type) {
      case 'text':
        parts.push(block.text)
        break
      case 'reasoning':
        break
      case 'image':
      case 'file':
        parts.push(ATTACHMENT_PLACEHOLDER)
        break
      default:
        break
    }
  }
  return parts.join('\n')
}

/** Convert one assembled request into the daemon's message list. */
function toWireMessages(options: GenerateOptions): OllamaChatMessage[] {
  const messages: OllamaChatMessage[] = []
  if (options.system !== undefined && options.system.length > 0) {
    messages.push({ role: 'system', content: options.system })
  }
  for (const message of options.messages) {
    const wire = toWireMessage(message)
    if (wire !== undefined) messages.push(wire)
  }
  return messages
}

/** Convert one request message, or `undefined` when it carries nothing to send. */
function toWireMessage(message: RequestMessage): OllamaChatMessage | undefined {
  switch (message.role) {
    case 'system':
    case 'developer':
      return { role: 'system', content: textOf(message.content) }
    case 'user':
      return { role: 'user', content: textOf(message.content) }
    case 'assistant': {
      const calls = message.content
        .filter((block): block is Extract<ContentBlock, { type: 'tool-call' }> => block.type === 'tool-call')
        .map(block => ({ function: { name: block.name, arguments: parseArguments(block.arguments) } }))
      const text = textOf(message.content)
      if (text.length === 0 && calls.length === 0) return undefined
      return { role: 'assistant', content: text, ...calls.length === 0 ? {} : { tool_calls: calls } }
    }
    case 'tool':
      return { role: 'tool', content: textOf(message.content) }
  }
}

/** Decode a stored tool-call argument string, keeping an undecodable value visible. */
function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** Convert harness tool schemas into the daemon's `tools` field. */
function toWireTools(tools: readonly ToolSchema[]): unknown[] {
  return tools.map(tool => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }))
}

/** Build the harness tool-call block for one daemon call. */
function toToolCallBlock(call: OllamaToolCall, index: number): Extract<ContentBlock, { type: 'tool-call' }> {
  return {
    type: 'tool-call',
    // Ollama issues no call id; the block index correlates the result within this response.
    id: `ollama-call-${index}` as ToolCallId,
    name: call.function.name,
    arguments: typeof call.function.arguments === 'string'
      ? call.function.arguments
      : JSON.stringify(call.function.arguments ?? {}),
  }
}

/** Map the daemon's stop reason onto the harness finish vocabulary. */
function finishOf(reason: string | undefined, hasCalls: boolean): { kind: 'stop' | 'tool-calls' | 'max-tokens' } {
  if (hasCalls) return { kind: 'tool-calls' }
  if (reason === 'length') return { kind: 'max-tokens' }
  return { kind: 'stop' }
}

/** Classify one non-2xx status into a stable machine code. */
function codeOf(status: number): string {
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 404) return 'INVALID_REQUEST'
  if (status === 429) return 'RATE_LIMIT'
  if (status >= 500) return 'SERVER'
  return `HTTP_${status}`
}

/** Abort the request when either the caller's signal or the deadline fires. */
function mergeDeadline(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const deadline = AbortSignal.timeout(timeoutMs)
  if (signal === undefined) return deadline
  return AbortSignal.any([signal, deadline])
}

/** One thrown value's message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
