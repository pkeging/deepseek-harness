/**
 * Memory-integrity invariant companion.
 * @module @deepseek-ai/dsh-memory-integrity/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-memory-integrity'
export const name = 'memory-integrity-invariant'
export const inject = ['invariants'] as const

/**
 * No runtime invariant: the integrity provider is a transparent wrapper
 * around ctx.memory that adds digest computation/verification without
 * changing the deterministic event shape.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
