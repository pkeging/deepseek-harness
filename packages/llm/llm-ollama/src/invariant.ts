/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-llm-ollama`.
 * @module @deepseek-ai/dsh-llm-ollama/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-llm-ollama'

/** Cordis companion plugin name. */
export const name = 'llm-ollama-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the adapter owns one HTTP transport and publishes no
 * package-owned event or snapshot an independent companion can observe. The
 * stream it produces reaches the model layer through the same `llm` seam every
 * other adapter uses.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
