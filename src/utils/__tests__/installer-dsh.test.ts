/**
 * Tests for installing dsh-ccg into a DeepSeek Harness profile.
 *
 * This installer rewrites a file the user owns and did not ask us to own — the
 * profile manifest that decides which plugins their harness loads. So what is
 * pinned here is mostly about restraint: touch both halves a plugin needs and
 * neither more, append rather than reorder, and never rewrite a manifest that
 * did not parse.
 *
 * The package-manager step is injected. What it does is `pnpm install`; what
 * matters is everything decided before it runs.
 */

import { tmpdir } from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'
import fs from 'fs-extra'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DSH_PLUGIN_NAME,
  dshPluginDir,
  findDshProfiles,
  hasDshHome,
  installDshPlugin,
  uninstallDshPlugin,
} from '../installer-dsh'

let dshHome: string

/** A linker that records its calls instead of spawning one. */
function recordingLinker(): { calls: string[], link: (dir: string, name: string) => undefined } {
  const calls: string[] = []
  return { calls, link: (_dir, name) => { calls.push(name); return undefined } }
}

/** Write a profile manifest under the temp harness home. */
async function makeProfile(name: string, pkg: Record<string, any>): Promise<string> {
  const dir = join(dshHome, 'profiles', name)
  await fs.ensureDir(dir)
  await fs.writeJson(join(dir, 'package.json'), pkg, { spaces: 2 })
  return dir
}

/** The shape a real profile has. */
const profileManifest = (bundles: string[] = ['@deepseek-ai/dsh-base']) => ({
  name: 'dsh-profile-test',
  private: true,
  dependencies: { 'some-other-plugin': '^1.0.0' },
  dsh: { profile: { bundles } },
})

beforeEach(async () => {
  dshHome = await mkdtemp(join(tmpdir(), 'ccg-dsh-'))
})

afterEach(async () => {
  await rm(dshHome, { recursive: true, force: true })
})

describe('findDshProfiles', () => {
  it('finds profiles and reports which already carry the plugin', async () => {
    await makeProfile('web', profileManifest(['@deepseek-ai/dsh-base', DSH_PLUGIN_NAME]))
    await makeProfile('headless', profileManifest())

    const found = await findDshProfiles(dshHome)
    expect(found.map(p => p.name)).toEqual(['headless', 'web'])
    expect(found.find(p => p.name === 'web')!.installed).toBe(true)
    expect(found.find(p => p.name === 'headless')!.installed).toBe(false)
  })

  it('skips the shared node_modules and anything without a bundles list', async () => {
    await makeProfile('web', profileManifest())
    // The profiles directory holds the shared dependency tree alongside the
    // profiles; it has a package.json and is not one.
    await fs.ensureDir(join(dshHome, 'profiles', 'node_modules'))
    await fs.writeJson(join(dshHome, 'profiles', 'node_modules', 'package.json'), { name: 'x' })
    await makeProfile('not-a-profile', { name: 'x', dependencies: {} })

    expect((await findDshProfiles(dshHome)).map(p => p.name)).toEqual(['web'])
  })

  it('ignores a manifest it cannot parse rather than risking a rewrite', async () => {
    await makeProfile('web', profileManifest())
    const broken = join(dshHome, 'profiles', 'broken')
    await fs.ensureDir(broken)
    await fs.writeFile(join(broken, 'package.json'), '{ not json')

    expect((await findDshProfiles(dshHome)).map(p => p.name)).toEqual(['web'])
  })

  it('answers for a machine with no harness at all', async () => {
    expect(await findDshProfiles(join(dshHome, 'nope'))).toEqual([])
    expect(await hasDshHome(join(dshHome, 'nope'))).toBe(false)
    await fs.ensureDir(join(dshHome, 'profiles'))
    expect(await hasDshHome(dshHome)).toBe(true)
  })
})

describe('installDshPlugin', () => {
  it('writes both halves a profile needs, and copies the plugin somewhere stable', async () => {
    const dir = await makeProfile('web', profileManifest())
    const { calls, link } = recordingLinker()

    const result = await installDshPlugin({ dshHome, link })
    expect(result.success).toBe(true)
    expect(result.profiles).toEqual(['web'])
    expect(result.warnings).toEqual([])
    expect(calls).toEqual(['web'])

    const pkg = await fs.readJson(join(dir, 'package.json'))
    // A dependency alone does not load a plugin, and a bundle entry alone does
    // not resolve one. Both, or the profile silently does nothing.
    expect(pkg.dependencies[DSH_PLUGIN_NAME]).toBe(`file:${dshPluginDir(dshHome)}`)
    expect(pkg.dsh.profile.bundles).toContain(DSH_PLUGIN_NAME)

    // Pointing at PACKAGE_ROOT would break the moment npx evicts its cache, so
    // the plugin is copied to a path this installer owns.
    expect(await fs.pathExists(join(dshPluginDir(dshHome), 'src', 'index.js'))).toBe(true)
    expect(await fs.pathExists(join(dshPluginDir(dshHome), 'package.json'))).toBe(true)
    // The repo checkout carries tests and a node_modules symlink; a user's dsh
    // home has no use for either.
    expect(await fs.pathExists(join(dshPluginDir(dshHome), 'test'))).toBe(false)
    expect(await fs.pathExists(join(dshPluginDir(dshHome), 'node_modules'))).toBe(false)
  })

  it('leaves the rest of the manifest exactly as it found it', async () => {
    const dir = await makeProfile('web', profileManifest(['@deepseek-ai/dsh-base', 'their-plugin']))
    await installDshPlugin({ dshHome, link: recordingLinker().link })

    const pkg = await fs.readJson(join(dir, 'package.json'))
    expect(pkg.dependencies['some-other-plugin']).toBe('^1.0.0')
    // Appended, never inserted: bundle order is patch order, so moving an entry
    // would re-layer someone else's configuration.
    expect(pkg.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', 'their-plugin', DSH_PLUGIN_NAME])
  })

  it('is idempotent — installing twice adds one entry, not two', async () => {
    const dir = await makeProfile('web', profileManifest())
    await installDshPlugin({ dshHome, link: recordingLinker().link })
    await installDshPlugin({ dshHome, link: recordingLinker().link })

    const bundles: string[] = (await fs.readJson(join(dir, 'package.json'))).dsh.profile.bundles
    expect(bundles.filter(entry => entry === DSH_PLUGIN_NAME)).toHaveLength(1)
  })

  it('installs into only the named profiles', async () => {
    await makeProfile('web', profileManifest())
    const headless = await makeProfile('headless', profileManifest())

    const result = await installDshPlugin({ dshHome, profiles: ['headless'], link: recordingLinker().link })
    expect(result.profiles).toEqual(['headless'])
    expect((await fs.readJson(join(headless, 'package.json'))).dsh.profile.bundles).toContain(DSH_PLUGIN_NAME)

    const web = await fs.readJson(join(dshHome, 'profiles', 'web', 'package.json'))
    expect(web.dsh.profile.bundles).not.toContain(DSH_PLUGIN_NAME)
  })

  it('says what to do instead of failing silently when there is no profile', async () => {
    const result = await installDshPlugin({ dshHome, link: recordingLinker().link })
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/dsh web/)
  })

  it('reports a failed link as a warning, because the manifest is already right', async () => {
    await makeProfile('web', profileManifest())
    const result = await installDshPlugin({ dshHome, link: () => 'ENOENT: pnpm not found' })

    // Half-done is not failed: everything durable was written, and the one
    // remaining step is a command the user can run.
    expect(result.success).toBe(true)
    expect(result.warnings.join('\n')).toMatch(/linking failed/)
    expect(result.warnings.join('\n')).toMatch(/dsh plugin --profile web install/)
  })
})

describe('uninstallDshPlugin', () => {
  it('removes both halves and the copy, and leaves other plugins alone', async () => {
    const dir = await makeProfile('web', profileManifest(['@deepseek-ai/dsh-base', 'their-plugin']))
    await installDshPlugin({ dshHome, link: recordingLinker().link })
    expect(await fs.pathExists(dshPluginDir(dshHome))).toBe(true)

    const result = await uninstallDshPlugin({ dshHome, link: recordingLinker().link })
    expect(result.success).toBe(true)
    expect(result.profiles).toEqual(['web'])

    const pkg = await fs.readJson(join(dir, 'package.json'))
    expect(pkg.dependencies[DSH_PLUGIN_NAME]).toBeUndefined()
    expect(pkg.dependencies['some-other-plugin']).toBe('^1.0.0')
    expect(pkg.dsh.profile.bundles).toEqual(['@deepseek-ai/dsh-base', 'their-plugin'])
    expect(await fs.pathExists(dshPluginDir(dshHome))).toBe(false)
  })

  it('touches no manifest that never carried it', async () => {
    const dir = await makeProfile('web', profileManifest())
    const before = await fs.readFile(join(dir, 'package.json'), 'utf-8')

    const result = await uninstallDshPlugin({ dshHome, link: recordingLinker().link })
    expect(result.success).toBe(true)
    expect(result.profiles).toEqual([])
    expect(await fs.readFile(join(dir, 'package.json'), 'utf-8')).toBe(before)
  })
})
