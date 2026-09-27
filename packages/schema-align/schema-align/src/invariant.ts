/**
 * Schema-align invariant companion.
 * @module @deepseek-ai/dsh-schema-align/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-schema-align'
export const name = 'schema-align-invariant'
export const inject = ['invariants'] as const

/**
 * No runtime invariant: contracts are static metadata registered at load
 * time; there is no mutable service state to observe.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
