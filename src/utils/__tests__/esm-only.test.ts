/**
 * Regression guard: the CLI ships as one ES module, so nothing in `src/` may
 * reach for a CommonJS-only global.
 *
 * `dist/cli.mjs` is built with `emitCJS: false` and no `createRequire` shim, so
 * `require` is simply not defined there. TypeScript does not object — `require`
 * is declared by `@types/node` regardless of module system — and unbuild
 * passes the call straight through. The failure lands at runtime, inside
 * whichever `try` was there to make the call safe.
 *
 * That is exactly how it got shipped (#161): `doctor`'s `execSafe()` required
 * `node:child_process` inside a `try/catch`, so every version probe it made
 * answered `null` and `doctor` reported a working binary as `Not found` on
 * every platform, with reinstalling unable to help. A swallowed ReferenceError
 * looks identical to a missing program.
 *
 * `__dirname` and `__filename` are checked as declarations rather than uses,
 * because the ESM way to get them is to derive them from `import.meta.url` —
 * which several modules here correctly do, under those very names.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'pathe'
import { describe, expect, it } from 'vitest'
import { PACKAGE_ROOT } from '../installer-template'

/** Every TypeScript source file the bundle is built from, tests excluded. */
function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry !== '__tests__') found.push(...sourceFiles(path))
    }
    else if (entry.endsWith('.ts')) {
      found.push(path)
    }
  }
  return found
}

/**
 * Source with comments and string literals removed.
 *
 * Both are scrubbed so a note explaining why a call was removed cannot be
 * mistaken for the call itself — this test's own subject is documented in
 * prose in the file it guards.
 */
function code(path: string): string {
  return readFileSync(path, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
}

describe('the CLI bundle stays pure ESM', () => {
  const files = sourceFiles(join(PACKAGE_ROOT, 'src'))

  it('finds the sources it is meant to scan', () => {
    expect(files.length).toBeGreaterThan(10)
    expect(files.some(path => path.endsWith('doctor.ts'))).toBe(true)
  })

  it('calls no CommonJS require()', () => {
    const offenders = files.filter(path => /(?<![.\w])require\s*\(/.test(code(path)))
    expect(offenders.map(path => path.slice(PACKAGE_ROOT.length))).toEqual([])
  })

  it('assigns no module.exports or exports.x', () => {
    const offenders = files.filter(path => /\bmodule\.exports\b|(?<![.\w])exports\s*\./.test(code(path)))
    expect(offenders.map(path => path.slice(PACKAGE_ROOT.length))).toEqual([])
  })

  it('uses __dirname and __filename only where it derives them itself', () => {
    for (const path of files) {
      const body = code(path)
      for (const name of ['__dirname', '__filename']) {
        if (!body.includes(name)) continue
        expect(
          new RegExp(`(?:const|let|var)\\s+${name}\\s*=`).test(body),
          `${path.slice(PACKAGE_ROOT.length)} uses ${name} without deriving it from import.meta.url`,
        ).toBe(true)
      }
    }
  })
})
