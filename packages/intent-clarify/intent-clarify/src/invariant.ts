/**
 * Intent-clarify invariant companion.
 * @module @deepseek-ai/dsh-intent-clarify/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-intent-clarify'
export const name = 'intent-clarify-invariant'
export const inject = ['invariants'] as const

/**
 * No runtime invariant: the clarifier is an observer plugin that injects
 * context messages but does not modify any deterministic service state.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
