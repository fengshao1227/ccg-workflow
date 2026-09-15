import { homedir } from 'node:os'
import fs from 'fs-extra'
import { join } from 'pathe'
import { parse as parseToml } from 'smol-toml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  configureAllSponsorsForCodex,
  configureApiMartForCodex,
  configureSponsorForCodex,
  removeAllSponsorsFromCodex,
  removeApiMartFromCodex,
  removeSponsorFromCodex,
} from '../installer-codex-api'
import { SPONSORS, getSponsor } from '../sponsors'

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

describe('SPONSORS registry', () => {
  it('has unique ids and a lookup for every entry', () => {
    const ids = SPONSORS.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const sponsor of SPONSORS)
      expect(getSponsor(sponsor.id)).toBe(sponsor)
    expect(getSponsor('not-a-sponsor')).toBeUndefined()
  })

  it('never puts /v1 on ANTHROPIC_BASE_URL and always keeps it on Codex base_url', () => {
    expect(SPONSORS.length).toBeGreaterThanOrEqual(2)
    for (const sponsor of SPONSORS) {
      expect(sponsor.anthropicBaseUrl.endsWith('/v1'), sponsor.id).toBe(false)
      expect(sponsor.codex.base_url.endsWith('/v1'), sponsor.id).toBe(true)
      expect(sponsor.codex.wire_api).toBe('responses')
      expect(sponsor.codex.env_key).toMatch(/^[A-Z0-9_]+$/)
      expect(sponsor.signupUrl.startsWith('https://')).toBe(true)
    }
  })

  it('locks the two current gateways to their documented bases', () => {
    const apimart = getSponsor('apimart')!
    expect(apimart.anthropicBaseUrl).toBe('https://api.apimart.ai')
    expect(apimart.codex.base_url).toBe('https://api.apimart.ai/v1')
    expect(apimart.codex.env_key).toBe('APIMART_API_KEY')

    const packy = getSponsor('packycode')!
    expect(packy.anthropicBaseUrl).toBe('https://cf.api.fan')
    expect(packy.codex.base_url).toBe('https://cf.api.fan/v1')
    expect(packy.codex.env_key).toBe('PACKYCODE_API_KEY')
    expect(packy.signupUrl).toContain('aff=m21P')
  })
})

describe('configureSponsorForCodex', () => {
  it('registers without activating by default', async () => {
    await fs.writeFile(configPath, EXISTING_CONFIG, 'utf-8')

    const result = await configureSponsorForCodex('apimart')

    expect(result.success).toBe(true)
    expect(result.activated).toBe(false)
    const config = await readConfig()
    expect(config.model_providers.apimart).toEqual({ ...getSponsor('apimart')!.codex })
    expect(config.model_provider).toBeUndefined()
  })

  it('activates only when explicitly asked', async () => {
    const result = await configureSponsorForCodex('packycode', true)
    expect(result.activated).toBe(true)
    expect((await readConfig()).model_provider).toBe('packycode')
  })

  it('preserves every pre-existing user setting', async () => {
    await fs.writeFile(configPath, EXISTING_CONFIG, 'utf-8')
    await configureSponsorForCodex('apimart', true)

    const config = await readConfig()
    expect(config.approval_policy).toBe('never')
    expect(config.model).toBe('gpt-5.6-sol')
    expect(config.service_tier).toBe('priority')
    expect(config.features.multi_agent_v2).toBe(true)
    expect(config.mcp_servers.existing_thing.command).toBe('/usr/bin/true')
  })

  it('creates the config when none exists yet', async () => {
    expect(await fs.pathExists(configPath)).toBe(false)
    const result = await configureSponsorForCodex('apimart')
    expect(result.success).toBe(true)
    expect(await fs.pathExists(configPath)).toBe(true)
  })

  it('rejects an unknown id without writing a table', async () => {
    const result = await configureSponsorForCodex('not-a-sponsor')
    expect(result.success).toBe(false)
    expect(await fs.pathExists(configPath)).toBe(false)
  })
})

describe('removeSponsorFromCodex', () => {
  it('round-trips back to the original config, leaving no residue', async () => {
    await fs.writeFile(configPath, EXISTING_CONFIG, 'utf-8')
    const before = await readConfig()

    await configureSponsorForCodex('apimart', true)
    await removeSponsorFromCodex('apimart')

    expect(await readConfig()).toEqual(before)
  })

  it('drops a dangling model_provider so Codex does not break on next run', async () => {
    await configureSponsorForCodex('packycode', true)
    await removeSponsorFromCodex('packycode')

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

    await configureSponsorForCodex('apimart')
    await removeSponsorFromCodex('apimart')

    const config = await readConfig()
    expect(config.model_provider).toBe('custom')
    expect(config.model_providers.custom.name).toBe('Custom')
    expect(config.model_providers.apimart).toBeUndefined()
  })

  it('is a no-op when there is no config at all', async () => {
    const result = await removeSponsorFromCodex('apimart')
    expect(result.success).toBe(true)
    expect(await fs.pathExists(configPath)).toBe(false)
  })
})

describe('configureAllSponsorsForCodex / removeAllSponsorsFromCodex', () => {
  it('registers every table without activating any', async () => {
    await configureAllSponsorsForCodex()

    const config = await readConfig()
    expect(config.model_provider).toBeUndefined()
    for (const sponsor of SPONSORS)
      expect(config.model_providers[sponsor.id]).toEqual({ ...sponsor.codex })
  })

  it('removing one sponsor leaves the others', async () => {
    await configureSponsorForCodex('apimart', true)
    await configureSponsorForCodex('packycode')
    await removeSponsorFromCodex('packycode')

    const config = await readConfig()
    expect(config.model_provider).toBe('apimart')
    expect(config.model_providers.apimart).toEqual({ ...getSponsor('apimart')!.codex })
    expect(config.model_providers.packycode).toBeUndefined()
  })

  it('removeAll drops every CCG table and a dangling model_provider', async () => {
    await fs.writeFile(configPath, EXISTING_CONFIG, 'utf-8')
    const before = await readConfig()

    await configureAllSponsorsForCodex()
    await configureSponsorForCodex('apimart', true)
    const result = await removeAllSponsorsFromCodex()

    expect(result.removed.sort()).toEqual(SPONSORS.map(s => s.id).sort())
    expect(await readConfig()).toEqual(before)
  })
})

describe('deprecated named wrappers still work', () => {
  it('configureApiMartForCodex writes the apimart table', async () => {
    await configureApiMartForCodex()
    expect((await readConfig()).model_providers.apimart.env_key).toBe('APIMART_API_KEY')
    await removeApiMartFromCodex()
    expect((await readConfig()).model_providers).toBeUndefined()
  })
})
