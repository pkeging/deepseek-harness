/**
 * Ollama HTTP wire types and streaming framing.
 *
 * The daemon answers `/api/chat` with newline-delimited JSON when `stream` is
 * true: one object per partial assistant message, then a final object carrying
 * `done: true` with the token counts. A failure mid-stream arrives as an object
 * with an `error` field instead of an HTTP status, so the reader treats either
 * as one failure path.
 *
 * @module @deepseek-ai/dsh-llm-ollama/wire
 */

/** One function call the model requested. */
export interface OllamaToolCall {
  /** Called tool and its already-decoded arguments. */
  readonly function: {
    readonly name: string
    /** Arguments as Ollama decoded them; the schema shape is the tool's business. */
    readonly arguments: unknown
  }
}

/** One chat message as `/api/chat` accepts and returns it. */
export interface OllamaChatMessage {
  /** Conversation role; `tool` answers one earlier tool call. */
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  /** Rendered text content. Ollama carries no structured blocks. */
  readonly content: string
  /** Reasoning a thinking model streamed before its answer. */
  readonly thinking?: string
  /** Base64-encoded images attached to a user message. */
  readonly images?: readonly string[]
  /** Tool calls an assistant message requests. */
  readonly tool_calls?: readonly OllamaToolCall[]
  /** Name of the tool a `tool` message answers. */
  readonly tool_name?: string
}

/** One line of the `/api/chat` streaming response. */
export interface OllamaChatChunk {
  /** Partial or complete assistant message for this line. */
  readonly message?: OllamaChatMessage
  /** Present and `true` only on the final line. */
  readonly done?: boolean
  /** Why generation stopped; `stop`, `length`, or a tool-call reason. */
  readonly done_reason?: string
  /** Prompt tokens the daemon evaluated. */
  readonly prompt_eval_count?: number
  /** Tokens the daemon generated. */
  readonly eval_count?: number
  /** In-band failure; the daemon reports these without changing the status. */
  readonly error?: string
}

/** One entry of the `/api/tags` model list. */
export interface OllamaModelTag {
  /** Model name to pass as `model`. */
  readonly name: string
  /** Digest-qualified name when the daemon reports one. */
  readonly model?: string
  /** On-disk size in bytes. */
  readonly size?: number
  /** Parameter-count label, when the daemon reports one. */
  readonly details?: { readonly parameter_size?: string }
}

/** Response body of `/api/tags`. */
export interface OllamaTagsResponse {
  /** Installed models. */
  readonly models?: readonly OllamaModelTag[]
}

/**
 * Split one streamed response body into lines as they arrive.
 *
 * A body is chunked at arbitrary byte offsets, so a multi-byte character and a
 * line boundary can both straddle two chunks; the decoder and the pending
 * buffer carry them across.
 * @param body - the response body stream.
 * @returns each complete line without its terminator, in arrival order.
 */
export async function* decodeLines(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder()
  let pending = ''
  for await (const chunk of body) {
    pending += decoder.decode(chunk, { stream: true })
    let newline = pending.indexOf('\n')
    while (newline >= 0) {
      yield pending.slice(0, newline)
      pending = pending.slice(newline + 1)
      newline = pending.indexOf('\n')
    }
  }
  pending += decoder.decode()
  if (pending.trim().length > 0) yield pending
}

/**
 * Decode one streamed line.
 * @param line - one raw line from the response body, without its newline.
 * @returns the decoded chunk, or `undefined` for a blank line.
 * @throws when the line is not a JSON object.
 */
export function decodeChunk(line: string): OllamaChatChunk | undefined {
  const trimmed = line.trim()
  if (trimmed.length === 0) return undefined
  const parsed: unknown = JSON.parse(trimmed)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('ollama: stream line is not a JSON object')
  }
  return parsed
}
