/**
 * Evaluator-static invariant companion.
 * @module @deepseek-ai/dsh-evaluator-static/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-evaluator-static'
export const name = 'evaluator-static-invariant'
export const inject = ['invariants'] as const

/** No runtime invariant: the provider is a stateless function plugin. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
