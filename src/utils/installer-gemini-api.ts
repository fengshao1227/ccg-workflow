import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import fs from 'fs-extra'
import { join } from 'pathe'
import { isWindows } from './platform'

const execFileAsync = promisify(execFile)

/**
 * Third-party (gateway) API setup for Gemini CLI — no Google account needed.
 *
 * Gemini CLI selects AuthType.GATEWAY by itself when GOOGLE_GEMINI_BASE_URL is
 * present in the process environment, and sends GEMINI_API_KEY as the
 * x-goog-api-key header (verified against gemini-cli 0.53.1 with a local
 * capture server: POST /v1beta/models/<model>:streamGenerateContent).
 *
 * The environment is the ONLY channel that works on 0.53.1. Everything else
 * was tested and is dead: ~/.gemini/.env and project .env are no longer read
 * (dotenv loading was removed), settings.json has no env-injection field, and
 * security.auth carries no baseUrl/apiKey — headless runs just fail with
 * "Invalid auth method selected". So we persist the variables where the shell
 * provides them: a fenced block in the user's rc file (Unix) or user-level
 * variables via setx (Windows).
 *
 * ⚠ The gateway must speak the NATIVE Gemini API (/v1beta/models/...). An
 * OpenAI-compatible relay endpoint will 404 — surface this in the prompt copy.
 */

export const GEMINI_ENV_MANAGED_KEYS = ['GOOGLE_GEMINI_BASE_URL', 'GEMINI_API_KEY', 'GEMINI_MODEL'] as const

const BLOCK_BEGIN = '# >>> CCG Gemini CLI gateway >>>'
const BLOCK_END = '# <<< CCG Gemini CLI gateway <<<'

export type GeminiCliApiOptions = {
  baseUrl: string
  apiKey: string
  /** Optional model override many relays require (empty = keep CLI default) */
  model?: string
}

export type GeminiCliApiResult = {
  success: boolean
  message: string
  /** Unix: the rc file that received the fenced block */
  rcPath?: string
  /** true when a new shell (or `source`) is needed before gemini sees it */
  needsReload?: boolean
}

/** Pick the rc file matching the user's login shell. Exported for tests. */
export function resolveShellRcPath(shell: string | undefined, home: string): string {
  const name = (shell || '').split('/').pop() || ''
  if (name === 'zsh')
    return join(home, '.zshrc')
  if (name === 'bash')
    return join(home, '.bashrc')
  if (name === 'fish')
    return join(home, '.config', 'fish', 'conf.d', 'ccg-gemini.fish')
  // Unknown shells still read ~/.profile in most login setups
  return join(home, '.profile')
}

/** Replace (or append) the fenced CCG block. Exported for tests. */
export function upsertFencedBlock(content: string, blockLines: string[]): string {
  const block = [BLOCK_BEGIN, ...blockLines, BLOCK_END].join('\n')
  const pattern = new RegExp(`${escapeRegExp(BLOCK_BEGIN)}[\\s\\S]*?${escapeRegExp(BLOCK_END)}`)
  if (pattern.test(content))
    return content.replace(pattern, block)
  const sep = content.length === 0 || content.endsWith('\n') ? '' : '\n'
  return `${content}${sep}${block}\n`
}

/** Remove the fenced CCG block entirely. Exported for tests. */
export function removeFencedBlock(content: string): string {
  const pattern = new RegExp(`\\n?${escapeRegExp(BLOCK_BEGIN)}[\\s\\S]*?${escapeRegExp(BLOCK_END)}\\n?`)
  return content.replace(pattern, '\n').replace(/\n{3,}/g, '\n\n')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function fishExportLines(entries: Array<[string, string]>): string[] {
  return entries.map(([k, v]) => `set -gx ${k} ${JSON.stringify(v)}`)
}

function posixExportLines(entries: Array<[string, string]>): string[] {
  return entries.map(([k, v]) => `export ${k}=${JSON.stringify(v)}`)
}

/**
 * Persist the gateway variables where the user's shell will export them.
 * Idempotent: the fenced block is replaced wholesale on every run.
 */
export async function configureGeminiCliApi(options: GeminiCliApiOptions): Promise<GeminiCliApiResult> {
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, '')
  const apiKey = options.apiKey.trim()
  const model = options.model?.trim() || ''
  if (!baseUrl || !apiKey)
    return { success: false, message: 'baseUrl and apiKey are required' }

  const entries: Array<[string, string]> = [
    ['GOOGLE_GEMINI_BASE_URL', baseUrl],
    ['GEMINI_API_KEY', apiKey],
    ...(model ? [['GEMINI_MODEL', model] as [string, string]] : []),
  ]

  if (isWindows()) {
    try {
      for (const [key, value] of entries)
        await execFileAsync('setx', [key, value])
      return { success: true, message: 'Gemini CLI gateway configured (user environment variables)', needsReload: true }
    }
    catch (error) {
      return { success: false, message: `setx failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  try {
    const rcPath = resolveShellRcPath(process.env.SHELL, homedir())
    await fs.ensureDir(join(rcPath, '..'))
    let content = ''
    if (await fs.pathExists(rcPath))
      content = await fs.readFile(rcPath, 'utf-8')

    const lines = rcPath.endsWith('.fish') ? fishExportLines(entries) : posixExportLines(entries)
    await fs.writeFile(rcPath, upsertFencedBlock(content, lines), 'utf-8')
    return { success: true, message: 'Gemini CLI gateway configured', rcPath, needsReload: true }
  }
  catch (error) {
    return { success: false, message: `Failed to update shell profile: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * Remove the gateway variables (explicit user action from the menu —
 * deliberately NOT wired into CCG uninstall, which must not break a working
 * Gemini CLI setup).
 */
export async function removeGeminiCliApi(): Promise<GeminiCliApiResult> {
  if (isWindows()) {
    try {
      for (const key of GEMINI_ENV_MANAGED_KEYS) {
        // setx cannot delete; clear via the registry, ignoring missing values
        await execFileAsync('reg', ['delete', 'HKCU\\Environment', '/v', key, '/f']).catch(() => {})
      }
      return { success: true, message: 'Gemini CLI gateway variables removed', needsReload: true }
    }
    catch (error) {
      return { success: false, message: `Failed to clear variables: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  try {
    const rcPath = resolveShellRcPath(process.env.SHELL, homedir())
    if (!(await fs.pathExists(rcPath)))
      return { success: true, message: 'Nothing to clean', rcPath }
    const content = await fs.readFile(rcPath, 'utf-8')
    await fs.writeFile(rcPath, removeFencedBlock(content), 'utf-8')
    return { success: true, message: 'Gemini CLI gateway block removed', rcPath, needsReload: true }
  }
  catch (error) {
    return { success: false, message: `Failed to update shell profile: ${error instanceof Error ? error.message : String(error)}` }
  }
}
