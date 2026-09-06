/**
 * Evaluator invariant companion.
 * @module @deepseek-ai/dsh-evaluator/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-evaluator'
export const name = 'evaluator-invariant'
export const inject = ['invariants'] as const

/** No runtime invariant: evaluator providers are stateless transforms. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
