/**
 * Intent-guard invariant companion.
 * @module @deepseek-ai/dsh-intent-guard/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-intent-guard'

export const name = 'intent-guard-invariant'
export const inject = ['invariants'] as const

/**
 * No runtime invariant: drift signals are advisory and observer-only; they
 * do not affect the deterministic shape of any logged event.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
