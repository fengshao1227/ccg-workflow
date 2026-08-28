import { homedir } from 'node:os'
import fs from 'fs-extra'
import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureGeminiCliApi, removeFencedBlock, removeGeminiCliApi, resolveShellRcPath, upsertFencedBlock } from '../installer-gemini-api'

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: vi.fn() }
})

vi.mock('../platform', () => ({ isWindows: () => false }))

let tmpHome: string
let rcPath: string
const origShell = process.env.SHELL

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(join(await fs.realpath('/tmp'), 'ccg-gemini-api-'))
  process.env.SHELL = '/bin/zsh'
  rcPath = join(tmpHome, '.zshrc')
  vi.mocked(homedir).mockReturnValue(tmpHome)
})

afterEach(async () => {
  process.env.SHELL = origShell
  await fs.remove(tmpHome)
  vi.restoreAllMocks()
})

describe('resolveShellRcPath', () => {
  it('maps login shells to their rc files', () => {
    expect(resolveShellRcPath('/bin/zsh', '/h')).toBe('/h/.zshrc')
    expect(resolveShellRcPath('/usr/bin/bash', '/h')).toBe('/h/.bashrc')
    expect(resolveShellRcPath('/opt/fish', '/h')).toBe('/h/.config/fish/conf.d/ccg-gemini.fish')
    expect(resolveShellRcPath(undefined, '/h')).toBe('/h/.profile')
  })
})

describe('fenced block helpers', () => {
  it('appends a block to content without one, replaces wholesale when present', () => {
    const v1 = upsertFencedBlock('alias ll="ls -l"\n', ['export A="1"'])
    expect(v1).toContain('alias ll="ls -l"\n')
    expect(v1).toContain('# >>> CCG Gemini CLI gateway >>>\nexport A="1"\n# <<< CCG Gemini CLI gateway <<<\n')

    const v2 = upsertFencedBlock(v1, ['export A="2"', 'export B="3"'])
    expect(v2).not.toContain('export A="1"')
    expect(v2).toContain('export A="2"\nexport B="3"')
    expect(v2.match(/>>> CCG Gemini CLI gateway >>>/g)).toHaveLength(1)
  })

  it('removeFencedBlock strips the block and keeps user lines', () => {
    const withBlock = upsertFencedBlock('# mine\nexport PATH="$PATH:/x"\n', ['export A="1"'])
    const cleaned = removeFencedBlock(withBlock)
    expect(cleaned).toContain('# mine\nexport PATH="$PATH:/x"\n')
    expect(cleaned).not.toContain('CCG Gemini CLI gateway')
    expect(cleaned).not.toContain('export A="1"')
  })
})

describe('configureGeminiCliApi', () => {
  it('writes the export block into the shell rc from scratch', async () => {
    const result = await configureGeminiCliApi({ baseUrl: 'https://relay.example.com', apiKey: 'sk-test-1' })

    expect(result.success).toBe(true)
    expect(result.rcPath).toBe(rcPath)
    expect(result.needsReload).toBe(true)
    const content = await fs.readFile(rcPath, 'utf-8')
    expect(content).toContain('export GOOGLE_GEMINI_BASE_URL="https://relay.example.com"')
    expect(content).toContain('export GEMINI_API_KEY="sk-test-1"')
    expect(content).not.toContain('GEMINI_MODEL')
  })

  it('includes GEMINI_MODEL only when supplied and preserves existing rc lines', async () => {
    await fs.writeFile(rcPath, '# user stuff\nexport EDITOR=vim\n', 'utf-8')

    const result = await configureGeminiCliApi({ baseUrl: 'https://relay.example.com', apiKey: 'k', model: 'gemini-3.1-pro' })

    expect(result.success).toBe(true)
    const content = await fs.readFile(rcPath, 'utf-8')
    expect(content).toContain('# user stuff\nexport EDITOR=vim\n')
    expect(content).toContain('export GEMINI_MODEL="gemini-3.1-pro"')
  })

  it('is idempotent — rerunning replaces the block instead of stacking', async () => {
    await configureGeminiCliApi({ baseUrl: 'https://relay.example.com', apiKey: 'k1' })
    await configureGeminiCliApi({ baseUrl: 'https://relay2.example.com', apiKey: 'k2' })

    const content = await fs.readFile(rcPath, 'utf-8')
    expect(content.match(/GOOGLE_GEMINI_BASE_URL/g)).toHaveLength(1)
    expect(content).toContain('relay2.example.com')
    expect(content).not.toContain('relay.example.com"')
  })

  it('strips trailing slashes and rejects blank input', async () => {
    const ok = await configureGeminiCliApi({ baseUrl: 'https://relay.example.com//', apiKey: 'k' })
    expect(ok.success).toBe(true)
    expect(await fs.readFile(rcPath, 'utf-8')).toContain('GOOGLE_GEMINI_BASE_URL="https://relay.example.com"')

    const bad = await configureGeminiCliApi({ baseUrl: '   ', apiKey: 'k' })
    expect(bad.success).toBe(false)
  })

  it('writes fish syntax when the login shell is fish', async () => {
    process.env.SHELL = '/usr/bin/fish'
    const result = await configureGeminiCliApi({ baseUrl: 'https://relay.example.com', apiKey: 'k' })

    expect(result.success).toBe(true)
    const fishPath = join(tmpHome, '.config', 'fish', 'conf.d', 'ccg-gemini.fish')
    const content = await fs.readFile(fishPath, 'utf-8')
    expect(content).toContain('set -gx GOOGLE_GEMINI_BASE_URL "https://relay.example.com"')
  })
})

describe('removeGeminiCliApi', () => {
  it('removes the block and keeps the rest of the rc file', async () => {
    await fs.writeFile(rcPath, 'export EDITOR=vim\n', 'utf-8')
    await configureGeminiCliApi({ baseUrl: 'https://relay.example.com', apiKey: 'k' })

    const result = await removeGeminiCliApi()

    expect(result.success).toBe(true)
    const content = await fs.readFile(rcPath, 'utf-8')
    expect(content).toContain('export EDITOR=vim\n')
    expect(content).not.toContain('CCG Gemini CLI gateway')
  })

  it('succeeds quietly when the rc file does not exist', async () => {
    const result = await removeGeminiCliApi()
    expect(result.success).toBe(true)
  })
})
