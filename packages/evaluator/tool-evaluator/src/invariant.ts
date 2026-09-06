/**
 * Tool-evaluator invariant companion.
 * @module @deepseek-ai/dsh-tool-evaluator/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-evaluator'
export const name = 'tool-evaluator-invariant'
export const inject = ['invariants'] as const

/** No runtime invariant: the tool delegates to ctx.evaluator.evaluate(). */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
