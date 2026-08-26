import { homedir } from 'node:os'
import fs from 'fs-extra'
import { join } from 'pathe'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'

/**
 * APIMart provider registration for Codex CLI (~/.codex/config.toml).
 *
 * Codex speaks the OpenAI wire protocol, so its base_url KEEPS the /v1 suffix —
 * the opposite of Claude Code, where ANTHROPIC_BASE_URL must omit it because
 * Claude Code appends /v1/messages itself. Getting these two backwards yields a
 * silent 404, so they are deliberately defined in separate places.
 *
 * Source: https://docs.apimart.ai/en/integrations/dev-tool/codex-cli.md
 */
export const APIMART_CODEX_PROVIDER_ID = 'apimart'

export const APIMART_CODEX_PROVIDER = {
  name: 'APIMart',
  base_url: 'https://api.apimart.ai/v1',
  wire_api: 'responses',
  env_key: 'APIMART_API_KEY',
} as const

export type CodexApiResult = {
  success: boolean
  message: string
  /** true when `model_provider` was actually switched to APIMart */
  activated: boolean
  configPath?: string
}

/**
 * Register APIMart as a selectable model provider in ~/.codex/config.toml.
 *
 * Additive by design. The [model_providers.apimart] table is written so Codex
 * knows how to reach APIMart, but `model_provider` is left untouched unless the
 * caller explicitly passes `activate: true`.
 *
 * That default is deliberate: flipping `model_provider` globally diverts EVERY
 * Codex request away from the user's ChatGPT subscription onto pay-as-you-go
 * billing. Silently rerouting someone's paid usage is not a side effect an
 * installer gets to have, so activation stays an explicit, informed choice.
 *
 * The user's existing config is preserved — we parse, mutate one table, and
 * write atomically (temp + rename), mirroring syncMcpToCodex().
 */
export async function configureApiMartForCodex(activate = false): Promise<CodexApiResult> {
  try {
    const codexHome = join(homedir(), '.codex')
    const configPath = join(codexHome, 'config.toml')
    await fs.ensureDir(codexHome)

    let config: Record<string, any> = {}
    if (await fs.pathExists(configPath)) {
      const content = await fs.readFile(configPath, 'utf-8')
      config = parseToml(content) as Record<string, any>
    }

    if (!config.model_providers || typeof config.model_providers !== 'object') {
      config.model_providers = {}
    }
    config.model_providers[APIMART_CODEX_PROVIDER_ID] = { ...APIMART_CODEX_PROVIDER }

    let activated = false
    if (activate) {
      config.model_provider = APIMART_CODEX_PROVIDER_ID
      activated = true
    }

    const tmpPath = `${configPath}.tmp`
    await fs.writeFile(tmpPath, stringifyToml(config), 'utf-8')
    await fs.rename(tmpPath, configPath)

    return {
      success: true,
      activated,
      configPath,
      message: activated
        ? 'APIMart registered and set as the active Codex model provider'
        : 'APIMart registered as a Codex model provider (not activated)',
    }
  }
  catch (error) {
    return { success: false, activated: false, message: `Failed to configure APIMart for Codex: ${error}` }
  }
}

/**
 * Remove the APIMart provider from ~/.codex/config.toml.
 *
 * If APIMart is currently the active provider, `model_provider` is dropped too —
 * leaving it pointing at a table that no longer exists would break Codex on the
 * next run.
 */
export async function removeApiMartFromCodex(): Promise<CodexApiResult> {
  try {
    const configPath = join(homedir(), '.codex', 'config.toml')
    if (!(await fs.pathExists(configPath))) {
      return { success: true, activated: false, message: 'No Codex config to clean' }
    }

    const config = parseToml(await fs.readFile(configPath, 'utf-8')) as Record<string, any>
    let changed = false

    if (config.model_providers?.[APIMART_CODEX_PROVIDER_ID]) {
      delete config.model_providers[APIMART_CODEX_PROVIDER_ID]
      // Drop the parent table once it is empty — an orphaned [model_providers]
      // is valid TOML but pure litter in a file the user reads and edits.
      if (Object.keys(config.model_providers).length === 0)
        delete config.model_providers
      changed = true
    }
    if (config.model_provider === APIMART_CODEX_PROVIDER_ID) {
      delete config.model_provider
      changed = true
    }

    if (!changed) {
      return { success: true, activated: false, message: 'APIMart not present in Codex config' }
    }

    const tmpPath = `${configPath}.tmp`
    await fs.writeFile(tmpPath, stringifyToml(config), 'utf-8')
    await fs.rename(tmpPath, configPath)

    return { success: true, activated: false, configPath, message: 'APIMart removed from Codex config' }
  }
  catch (error) {
    return { success: false, activated: false, message: `Failed to remove APIMart from Codex: ${error}` }
  }
}
