import ansis from 'ansis'
import inquirer from 'inquirer'
import { i18n } from '../i18n'

export type CodexProviderSpec = {
  name: string
  base_url: string
  wire_api: string
  env_key: string
}

/**
 * Sponsored API gateways. Adding a new one means one object here plus a
 * README banner — init Step 1, the API menu, Codex registration, and
 * uninstall all iterate this list.
 *
 * Two Base URLs, never mix them: `anthropicBaseUrl` has NO `/v1` (Claude
 * Code appends `/v1/messages`); `codex.base_url` KEEPS `/v1` (OpenAI
 * protocol). Getting these backwards is a silent 404.
 */
export type SponsorGateway = {
  id: string
  name: string
  signupUrl: string
  /** ANTHROPIC_BASE_URL — no /v1 */
  anthropicBaseUrl: string
  tagline: { 'zh-CN': string, en: string }
  /** Suffix after "Sign up and get your API Key". Include punctuation/space. */
  getKeyNote: { 'zh-CN': string, en: string }
  codex: CodexProviderSpec
}

export const SPONSORS: readonly SponsorGateway[] = [
  {
    id: 'apimart',
    name: 'APIMart',
    signupUrl: 'https://go.apimart.ai/gh-ccg-workflow',
    anthropicBaseUrl: 'https://api.apimart.ai',
    tagline: {
      'zh-CN': '低价 AI 网关，Claude / GPT / Gemini 一个 Key 通吃',
      en: 'low-cost AI gateway — Claude / GPT / Gemini on one key',
    },
    getKeyNote: { 'zh-CN': '', en: '' },
    codex: {
      name: 'APIMart',
      base_url: 'https://api.apimart.ai/v1',
      wire_api: 'responses',
      env_key: 'APIMART_API_KEY',
    },
  },
  {
    id: 'packycode',
    name: 'PackyCode',
    signupUrl: 'https://www.packyapi.ai/register?aff=m21P',
    anthropicBaseUrl: 'https://cf.api.fan',
    tagline: {
      'zh-CN': '统一域名统一密钥，专属 Codex / Claude Code 高速通道',
      en: 'one domain, one key, dedicated Codex / Claude Code routes',
    },
    getKeyNote: {
      'zh-CN': '（新用户 $1 体验额度）',
      en: ' ($1 in free credits for new users)',
    },
    codex: {
      name: 'PackyCode',
      base_url: 'https://cf.api.fan/v1',
      wire_api: 'responses',
      env_key: 'PACKYCODE_API_KEY',
    },
  },
]

const BY_ID = new Map(SPONSORS.map(s => [s.id, s]))

export function getSponsor(id: string): SponsorGateway | undefined {
  return BY_ID.get(id)
}

function locOf(lang?: string): 'zh-CN' | 'en' {
  return (lang || i18n.language || 'zh-CN').startsWith('zh') ? 'zh-CN' : 'en'
}

export function sponsorCopy(sponsor: SponsorGateway, lang?: string) {
  const loc = locOf(lang)
  return {
    name: sponsor.name,
    id: sponsor.id,
    tagline: sponsor.tagline[loc],
    note: sponsor.getKeyNote[loc],
  }
}

/** Inquirer list entries for init Step 1 and the API menu. */
export function sponsorInquirerChoices(): { name: string, value: string }[] {
  return SPONSORS.map(s => ({
    name: `${ansis.yellow('★')} ${i18n.t('init:api.sponsorOption', sponsorCopy(s))} ${ansis.gray(`— ${s.signupUrl}`)}`,
    value: s.id,
  }))
}

async function promptSponsorKey(sponsor: SponsorGateway, requiredKey: string): Promise<string> {
  const copy = sponsorCopy(sponsor)
  console.log()
  console.log(`    ${ansis.yellow('★')} ${i18n.t('init:api.sponsorGetKey', copy)}: ${ansis.cyan.underline(sponsor.signupUrl)}`)
  console.log()
  const { key } = await inquirer.prompt([{
    type: 'password',
    name: 'key',
    message: `${sponsor.name} API Key ${ansis.gray(`(${i18n.t(requiredKey)})`)}`,
    mask: '*',
    validate: (v: string) => v.trim() !== '' || i18n.t('init:api.enterKey'),
  }])
  return key?.trim() || ''
}

/** Init Step 1: key + optional Codex register/activate. */
export async function promptSponsorInit(sponsor: SponsorGateway): Promise<{
  apiKey: string
  wireCodex: boolean
  activateCodex: boolean
}> {
  const copy = sponsorCopy(sponsor)
  const apiKey = await promptSponsorKey(sponsor, 'init:api.keyRequired')

  const { wire } = await inquirer.prompt([{
    type: 'confirm',
    name: 'wire',
    message: i18n.t('init:api.sponsorCodexPrompt', copy),
    default: true,
  }])

  let activateCodex = false
  if (wire) {
    // Activation defaults to NO: flipping model_provider reroutes every
    // Codex request off the user's subscription onto pay-as-you-go.
    const { activate } = await inquirer.prompt([{
      type: 'confirm',
      name: 'activate',
      message: i18n.t('init:api.sponsorCodexActivatePrompt', copy),
      default: false,
    }])
    activateCodex = activate
  }

  return { apiKey, wireCodex: wire, activateCodex }
}

/** Menu API config: key only — menu does not touch Codex. */
export function promptSponsorMenuKey(sponsor: SponsorGateway): Promise<string> {
  return promptSponsorKey(sponsor, 'menu:api.keyRequired')
}
