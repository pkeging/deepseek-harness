/**
 * Guards the private-package exclusion list.
 *
 * A wrong entry is silent: the catalog generators simply stop documenting a
 * package. The checks below reject the three ways an entry goes wrong — a
 * duplicated or mistyped directory, a directory that holds no package, and the
 * expensive one, a product package that a shipped bundle depends on.
 *
 * @module scripts/private-packages.spec
 */
import { existsSync, globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PRIVATE_PACKAGE_DIRECTORIES } from './private-packages.ts'

const root = resolve(import.meta.dirname, '..')

/** Parse one repository-relative JSON file. */
function readJson(path: string): { name?: string; dependencies?: Record<string, string> } {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8')) as never
}

describe('PRIVATE_PACKAGE_DIRECTORIES', () => {
  it('lists unique directories in the packages/<group>/<package>/ shape', () => {
    expect(new Set(PRIVATE_PACKAGE_DIRECTORIES).size).toBe(PRIVATE_PACKAGE_DIRECTORIES.length)
    for (const directory of PRIVATE_PACKAGE_DIRECTORIES) {
      expect(directory, `${directory} is not a package directory prefix`).toMatch(/^packages\/[^/]+\/[^/]+\/$/)
    }
  })

  it('names a directory that declares a package manifest', () => {
    for (const directory of PRIVATE_PACKAGE_DIRECTORIES) {
      expect(existsSync(resolve(root, directory, 'package.json')), `${directory} has no package.json`).toBe(true)
    }
  })

  it('excludes no package a shipped product bundle depends on', () => {
    const shipped = new Set<string>()
    for (const bundle of globSync('packages/bundle/*/package.json', { cwd: root })) {
      for (const name of Object.keys(readJson(bundle).dependencies ?? {})) shipped.add(name)
    }
    for (const directory of PRIVATE_PACKAGE_DIRECTORIES) {
      const name = readJson(`${directory}package.json`).name ?? ''
      expect(shipped.has(name), `${directory} (${name}) is shipped by a product bundle`).toBe(false)
    }
  })
})
