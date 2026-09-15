import { homedir } from 'node:os'
import fs from 'fs-extra'
import { join } from 'pathe'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { SPONSORS, getSponsor, type CodexProviderSpec } from './sponsors'

export type { CodexProviderSpec }

/**
 * Codex CLI model-provider tables written into ~/.codex/config.toml.
 *
 * Codex speaks the OpenAI wire protocol, so every `base_url` KEEPS the /v1
 * suffix — the opposite of Claude Code, where ANTHROPIC_BASE_URL must omit it
 * because Claude Code appends /v1/messages itself. Getting these two backwards
 * yields a silent 404, so they are deliberately defined in separate places
 * (see `sponsors.ts`).
 *
 * Auth is always `env_key`, never a write to ~/.codex/auth.json: flipping
 * OPENAI_API_KEY there would clobber a ChatGPT-subscription login.
 */

export type CodexApiResult = {
  success: boolean
  message: string
  /** true when `model_provider` was actually switched to this table */
  activated: boolean
  configPath?: string
}

async function readCodexConfig(configPath: string): Promise<Record<string, any>> {
  if (!(await fs.pathExists(configPath)))
    return {}
  return parseToml(await fs.readFile(configPath, 'utf-8')) as Record<string, any>
}

async function writeCodexConfig(configPath: string, config: Record<string, any>): Promise<void> {
  const tmpPath = `${configPath}.tmp`
  await fs.writeFile(tmpPath, stringifyToml(config), 'utf-8')
  await fs.rename(tmpPath, configPath)
}

/**
 * Register a selectable model provider. Additive: the table is written so Codex
 * knows how to reach it, but `model_provider` is left untouched unless the
 * caller explicitly passes `activate: true`.
 *
 * That default is deliberate: flipping `model_provider` globally diverts EVERY
 * Codex request away from the user's ChatGPT subscription onto pay-as-you-go
 * billing. Silently rerouting someone's paid usage is not a side effect an
 * installer gets to have, so activation stays an explicit, informed choice.
 */
async function configureProvider(
  id: string,
  spec: CodexProviderSpec,
  activate: boolean,
): Promise<CodexApiResult> {
  try {
    const codexHome = join(homedir(), '.codex')
    const configPath = join(codexHome, 'config.toml')
    await fs.ensureDir(codexHome)

    const config = await readCodexConfig(configPath)
    if (!config.model_providers || typeof config.model_providers !== 'object')
      config.model_providers = {}
    config.model_providers[id] = { ...spec }

    let activated = false
    if (activate) {
      config.model_provider = id
      activated = true
    }

    await writeCodexConfig(configPath, config)

    return {
      success: true,
      activated,
      configPath,
      message: activated
        ? `${spec.name} registered and set as the active Codex model provider`
        : `${spec.name} registered as a Codex model provider (not activated)`,
    }
  }
  catch (error) {
    return { success: false, activated: false, message: `Failed to configure ${spec.name} for Codex: ${error}` }
  }
}

/**
 * Remove one provider table. If it is currently the active provider,
 * `model_provider` is dropped too — leaving it pointing at a table that no
 * longer exists would break Codex on the next run. Sibling tables are left
 * alone.
 */
async function removeProvider(id: string, label: string): Promise<CodexApiResult> {
  try {
    const configPath = join(homedir(), '.codex', 'config.toml')
    if (!(await fs.pathExists(configPath)))
      return { success: true, activated: false, message: 'No Codex config to clean' }

    const config = await readCodexConfig(configPath)
    let changed = false

    if (config.model_providers?.[id]) {
      delete config.model_providers[id]
      if (Object.keys(config.model_providers).length === 0)
        delete config.model_providers
      changed = true
    }
    if (config.model_provider === id) {
      delete config.model_provider
      changed = true
    }

    if (!changed)
      return { success: true, activated: false, message: `${label} not present in Codex config` }

    await writeCodexConfig(configPath, config)
    return { success: true, activated: false, configPath, message: `${label} removed from Codex config` }
  }
  catch (error) {
    return { success: false, activated: false, message: `Failed to remove ${label} from Codex: ${error}` }
  }
}

export function configureSponsorForCodex(id: string, activate = false): Promise<CodexApiResult> {
  const sponsor = getSponsor(id)
  if (!sponsor)
    return Promise.resolve({ success: false, activated: false, message: `Unknown sponsor: ${id}` })
  return configureProvider(sponsor.id, sponsor.codex, activate)
}

export function removeSponsorFromCodex(id: string): Promise<CodexApiResult> {
  const sponsor = getSponsor(id)
  if (!sponsor)
    return Promise.resolve({ success: true, activated: false, message: `Unknown sponsor: ${id}` })
  return removeProvider(sponsor.id, sponsor.name)
}

/** Silent registration of every sponsored Codex table. Never activates. */
export async function configureAllSponsorsForCodex(): Promise<void> {
  for (const sponsor of SPONSORS)
    await configureSponsorForCodex(sponsor.id, false)
}

/** Drop every sponsored table CCG added. Sibling user tables are left alone. */
export async function removeAllSponsorsFromCodex(): Promise<{
  success: boolean
  removed: string[]
  configPath?: string
}> {
  const removed: string[] = []
  let configPath: string | undefined
  for (const sponsor of SPONSORS) {
    const result = await removeSponsorFromCodex(sponsor.id)
    if (result.success && result.configPath) {
      removed.push(sponsor.id)
      configPath = result.configPath
    }
  }
  return { success: true, removed, configPath }
}

/** @deprecated use configureSponsorForCodex('apimart') */
export function configureApiMartForCodex(activate = false): Promise<CodexApiResult> {
  return configureSponsorForCodex('apimart', activate)
}

/** @deprecated use removeSponsorFromCodex('apimart') */
export function removeApiMartFromCodex(): Promise<CodexApiResult> {
  return removeSponsorFromCodex('apimart')
}

/** @deprecated use configureSponsorForCodex('packycode') */
export function configurePackyCodeForCodex(activate = false): Promise<CodexApiResult> {
  return configureSponsorForCodex('packycode', activate)
}

/** @deprecated use removeSponsorFromCodex('packycode') */
export function removePackyCodeFromCodex(): Promise<CodexApiResult> {
  return removeSponsorFromCodex('packycode')
}
