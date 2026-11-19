import { homedir, tmpdir } from 'node:os'
import { join as nativeJoin } from 'node:path'
import fs from 'fs-extra'
import { join } from 'pathe'
import { parse as parseToml } from 'smol-toml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ccgHookTrustEntries, codexHookHash, mergeCcgHooks, trustCcgCodexHooks, uninstallCcgCodexHooks } from '../codex-hook-trust'
import { installCodexMode, uninstallCodexMode } from '../installer'

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: vi.fn() }
})

let home: string
let codexHome: string
const ccgCommand = () => `python3 ${join(home, '.codex', 'hooks', 'ccg-workflow.py')}`
const userGroup = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user', timeout: 5 }] }
const ccgGroup = () => ({ hooks: [{ type: 'command', command: ccgCommand(), timeout: 10 }] })
const readConfig = async () => parseToml(await fs.readFile(join(codexHome, 'config.toml'), 'utf-8')) as Record<string, any>

beforeEach(async () => {
  home = await fs.mkdtemp(join(tmpdir(), 'ccg-hook-trust-'))
  codexHome = join(home, '.codex')
  vi.mocked(homedir).mockReturnValue(home)
})
afterEach(async () => {
  await fs.remove(home)
})

describe('codexHookHash', () => {
  it('matches the hash codex-cli 0.170.0 reported via hooks/list', () => {
    const handler = { type: 'command', command: 'python3 /Users/li/.tmp-agent/codexhome.me7288co/hook.py', timeout: 10 }
    expect(codexHookHash('user_prompt_submit', handler))
      .toBe('sha256:dd457ececaac7639475f50928b368e457aa3adf8928902419058fa68c9ddd69a')
  })

  it('hashes a missing timeout as Codex default of 600 seconds', () => {
    const base = { type: 'command', command: 'x' }
    expect(codexHookHash('stop', base)).toBe(codexHookHash('stop', { ...base, timeout: 600 }))
    expect(codexHookHash('stop', base)).not.toBe(codexHookHash('stop', { ...base, timeout: 10 }))
  })
})

describe('mergeCcgHooks', () => {
  it('keeps user hooks, replaces an older CCG group and appends the new one last', () => {
    const existing = { hooks: { UserPromptSubmit: [ccgGroup(), userGroup], PreToolUse: [userGroup] } }
    const merged = mergeCcgHooks(existing, { hooks: { UserPromptSubmit: [ccgGroup()] } })
    expect(merged.hooks.UserPromptSubmit).toEqual([userGroup, ccgGroup()])
    expect(merged.hooks.PreToolUse).toEqual([userGroup])
  })

  it('keys trust by native hooks.json path and position', () => {
    const doc = { hooks: { UserPromptSubmit: [userGroup, ccgGroup()] } }
    const [entry] = ccgHookTrustEntries(doc, codexHome)
    expect(entry.key).toBe(`${nativeJoin(codexHome, 'hooks.json')}:user_prompt_submit:1:0`)
  })
})

describe('trust records', () => {
  it('trusts only CCG handlers and leaves the rest of config.toml alone', async () => {
    await fs.outputJSON(join(codexHome, 'hooks.json'), { hooks: { UserPromptSubmit: [userGroup, ccgGroup()] } })
    await fs.outputFile(join(codexHome, 'config.toml'), 'model = "gpt-5"\n[hooks.state."other:stop:0:0"]\nenabled = false\n')
    expect(await trustCcgCodexHooks(codexHome)).toBe(1)
    const config = await readConfig()
    expect(config.model).toBe('gpt-5')
    expect(config.hooks.state['other:stop:0:0']).toEqual({ enabled: false })
    const key = `${nativeJoin(codexHome, 'hooks.json')}:user_prompt_submit:1:0`
    expect(config.hooks.state[key].trusted_hash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('uninstall removes CCG trust and group but keeps the user hook file', async () => {
    await fs.outputJSON(join(codexHome, 'hooks.json'), { hooks: { UserPromptSubmit: [userGroup, ccgGroup()] } })
    await trustCcgCodexHooks(codexHome)
    await uninstallCcgCodexHooks(codexHome)
    expect(await fs.readJSON(join(codexHome, 'hooks.json'))).toEqual({ hooks: { UserPromptSubmit: [userGroup] } })
    expect((await readConfig()).hooks).toBeUndefined()
  })

  it('uninstall deletes hooks.json when only CCG hooks were in it', async () => {
    await fs.outputJSON(join(codexHome, 'hooks.json'), { hooks: { UserPromptSubmit: [ccgGroup()] } })
    expect(await uninstallCcgCodexHooks(codexHome)).toContain('~/.codex/hooks.json')
    expect(await fs.pathExists(join(codexHome, 'hooks.json'))).toBe(false)
  })
})

describe('codex-mode install/uninstall', () => {
  it('merges into an existing hooks.json, trusts the CCG hook, and gives the user file back on uninstall', async () => {
    await fs.outputJSON(join(codexHome, 'hooks.json'), { hooks: { PreToolUse: [userGroup] } })
    const installed = await installCodexMode()
    expect(installed.success).toBe(true)
    const hooksJson = await fs.readJSON(join(codexHome, 'hooks.json'))
    expect(hooksJson.hooks.PreToolUse).toEqual([userGroup])
    const [entry] = ccgHookTrustEntries(hooksJson, codexHome)
    expect((await readConfig()).hooks.state[entry.key].trusted_hash).toBe(entry.hash)

    const removed = await uninstallCodexMode()
    expect(removed.success).toBe(true)
    expect(await fs.readJSON(join(codexHome, 'hooks.json'))).toEqual({ hooks: { PreToolUse: [userGroup] } })
    expect((await readConfig()).hooks).toBeUndefined()
  })
})
