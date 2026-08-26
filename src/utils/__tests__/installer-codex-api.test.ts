import { homedir } from 'node:os'
import fs from 'fs-extra'
import { join } from 'pathe'
import { parse as parseToml } from 'smol-toml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APIMART_CODEX_PROVIDER, configureApiMartForCodex, removeApiMartFromCodex } from '../installer-codex-api'

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: vi.fn() }
})

const EXISTING_CONFIG = `approval_policy = 'never'
model = 'gpt-5.6-sol'
service_tier = 'priority'

[features]
multi_agent_v2 = true

[mcp_servers.existing_thing]
command = "/usr/bin/true"
`

let tmpHome: string
let configPath: string

async function readConfig(): Promise<Record<string, any>> {
  return parseToml(await fs.readFile(configPath, 'utf-8')) as Record<string, any>
}

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(join(await fs.realpath('/tmp'), 'ccg-codex-api-'))
  configPath = join(tmpHome, '.codex', 'config.toml')
  await fs.ensureDir(join(tmpHome, '.codex'))
  vi.mocked(homedir).mockReturnValue(tmpHome)
})

afterEach(async () => {
  await fs.remove(tmpHome)
  vi.restoreAllMocks()
})

describe('configureApiMartForCodex', () => {
  it('registers the provider without activating it by default', async () => {
    await fs.writeFile(configPath, EXISTING_CONFIG, 'utf-8')

    const result = await configureApiMartForCodex()

    expect(result.success).toBe(true)
    expect(result.activated).toBe(false)

    const config = await readConfig()
    expect(config.model_providers.apimart).toEqual({ ...APIMART_CODEX_PROVIDER })
    // The critical guarantee: never silently reroute paid usage.
    expect(config.model_provider).toBeUndefined()
  })

  it('keeps the /v1 suffix — Codex speaks OpenAI, unlike ANTHROPIC_BASE_URL', async () => {
    await configureApiMartForCodex()
    const config = await readConfig()
    expect(config.model_providers.apimart.base_url).toBe('https://api.apimart.ai/v1')
    expect(config.model_providers.apimart.wire_api).toBe('responses')
  })

  it('preserves every pre-existing user setting', async () => {
    await fs.writeFile(configPath, EXISTING_CONFIG, 'utf-8')

    await configureApiMartForCodex(true)

    const config = await readConfig()
    expect(config.approval_policy).toBe('never')
    expect(config.model).toBe('gpt-5.6-sol')
    expect(config.service_tier).toBe('priority')
    expect(config.features.multi_agent_v2).toBe(true)
    expect(config.mcp_servers.existing_thing.command).toBe('/usr/bin/true')
  })

  it('activates only when explicitly asked', async () => {
    const result = await configureApiMartForCodex(true)

    expect(result.activated).toBe(true)
    expect((await readConfig()).model_provider).toBe('apimart')
  })

  it('creates the config when none exists yet', async () => {
    expect(await fs.pathExists(configPath)).toBe(false)

    const result = await configureApiMartForCodex()

    expect(result.success).toBe(true)
    expect(await fs.pathExists(configPath)).toBe(true)
  })
})

describe('removeApiMartFromCodex', () => {
  it('round-trips back to the original config, leaving no residue', async () => {
    await fs.writeFile(configPath, EXISTING_CONFIG, 'utf-8')
    const before = await readConfig()

    await configureApiMartForCodex(true)
    await removeApiMartFromCodex()

    expect(await readConfig()).toEqual(before)
  })

  it('drops a dangling model_provider so Codex does not break on next run', async () => {
    await configureApiMartForCodex(true)
    await removeApiMartFromCodex()

    const config = await readConfig()
    expect(config.model_provider).toBeUndefined()
    expect(config.model_providers).toBeUndefined()
  })

  it('leaves other providers and their activation alone', async () => {
    await fs.writeFile(configPath, `model_provider = "custom"

[model_providers.custom]
name = "Custom"
base_url = "https://example.test/v1"
`, 'utf-8')

    await configureApiMartForCodex()
    await removeApiMartFromCodex()

    const config = await readConfig()
    expect(config.model_provider).toBe('custom')
    expect(config.model_providers.custom.name).toBe('Custom')
    expect(config.model_providers.apimart).toBeUndefined()
  })

  it('is a no-op when there is no config at all', async () => {
    const result = await removeApiMartFromCodex()
    expect(result.success).toBe(true)
    expect(await fs.pathExists(configPath)).toBe(false)
  })
})
