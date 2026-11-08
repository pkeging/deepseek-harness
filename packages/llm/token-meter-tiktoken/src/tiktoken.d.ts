/**
 * Type declarations for tiktoken (optional dependency).
 *
 * @module tiktoken
 */

declare module 'tiktoken' {
  export interface TiktokenEncoding {
    encode(text: string): number[]
    close(): void
  }

  export function get_encoding(name: string): TiktokenEncoding
}
