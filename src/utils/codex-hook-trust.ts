import { createHash } from 'node:crypto'
// node:path, not pathe: Codex keys trust by the native path (backslashes on Windows).
import { join } from 'node:path'
import fs from 'fs-extra'
import { readCodexConfig, writeCodexConfig } from './installer-codex-api'

/**
 * Codex hook trust (codex-cli ≥ 0.129).
 *
 * Codex only runs a non-managed hook after the user has reviewed it in `/hooks`.
 * The approval is stored in config.toml as
 *
 *   [hooks.state."<hooks.json path>:<event>:<group>:<handler>"]
 *   trusted_hash = "sha256:<hex>"
 *
 * An untrusted hook is skipped, and in `codex exec` the skip prints nothing at
 * all, so a fresh `ccg codex-mode install` used to leave Codex mode silently
 * inert. CCG records trust for the one hook it installs itself, the same way
 * the `/hooks` screen would. Only CCG's own handlers are touched.
 *
 * The hash mirrors codex-rs `hook_hash`: sha256 over key-sorted compact JSON of
 * `{event_name, matcher?, hooks: [normalized handler]}`. Verified against
 * `hooks/list` on codex-cli 0.170.0. If a later Codex changes normalization the
 * hook shows as "modified" and the user trusts it once in `/hooks`.
 */

const CCG_HOOK_SCRIPT = 'ccg-workflow.py'
const DEFAULT_TIMEOUT_SEC = 600

/** Events Codex hashes without a matcher. CCG only installs hooks for these. */
const MATCHERLESS_EVENTS: Record<string, string> = {
  UserPromptSubmit: 'user_prompt_submit',
  Stop: 'stop',
}

type Json = Record<string, any>
export type CcgHookTrust = { key: string, hash: string }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Json).sort()
      .filter(k => (value as Json)[k] !== undefined && (value as Json)[k] !== null)
      .map(k => `${JSON.stringify(k)}:${canonical((value as Json)[k])}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

export function codexHookHash(eventLabel: string, handler: Json): string {
  const timeout = typeof handler.timeout === 'number' ? Math.max(1, handler.timeout) : DEFAULT_TIMEOUT_SEC
  const normalized = {
    type: 'command',
    command: handler.command,
    timeout,
    async: handler.async === true,
    statusMessage: handler.statusMessage,
  }
  const identity = canonical({ event_name: eventLabel, hooks: [normalized] })
  return `sha256:${createHash('sha256').update(identity).digest('hex')}`
}

function isCcgHandler(handler: unknown): boolean {
  const h = handler as Json
  return h?.type === 'command' && typeof h.command === 'string'
    && h.command.replaceAll('\\', '/').includes(`/hooks/${CCG_HOOK_SCRIPT}`)
}

function isCcgGroup(group: unknown): boolean {
  const hooks = (group as Json)?.hooks
  return Array.isArray(hooks) && hooks.some(isCcgHandler)
}

/** Trust keys and hashes for every CCG handler in `<codexHome>/hooks.json`. */
export function ccgHookTrustEntries(hooksJson: Json, codexHome: string): CcgHookTrust[] {
  const hooksPath = join(codexHome, 'hooks.json')
  const result: CcgHookTrust[] = []
  for (const [event, label] of Object.entries(MATCHERLESS_EVENTS)) {
    const groups = hooksJson?.hooks?.[event]
    if (!Array.isArray(groups)) continue
    groups.forEach((group: Json, g: number) => {
      if (!Array.isArray(group?.hooks)) return
      group.hooks.forEach((handler: Json, h: number) => {
        if (isCcgHandler(handler))
          result.push({ key: `${hooksPath}:${label}:${g}:${h}`, hash: codexHookHash(label, handler) })
      })
    })
  }
  return result
}

/** Drop CCG groups from a hooks.json document, keeping everything the user added. */
export function withoutCcgHooks(hooksJson: Json | null): Json {
  const doc: Json = { ...(hooksJson || {}), hooks: { ...(hooksJson?.hooks || {}) } }
  for (const [event, groups] of Object.entries(doc.hooks)) {
    if (!Array.isArray(groups)) continue
    const kept = groups.filter(g => !isCcgGroup(g))
    if (kept.length) doc.hooks[event] = kept
    else delete doc.hooks[event]
  }
  return doc
}

/**
 * Merge CCG's hook groups into an existing hooks.json document. Earlier CCG
 * groups are replaced, and the new ones go last: Codex keys trust by position,
 * so appending keeps the user's own hooks at the indices they trusted.
 */
export function mergeCcgHooks(existing: Json | null, template: Json): Json {
  const doc = withoutCcgHooks(existing)
  for (const [event, groups] of Object.entries(template.hooks || {})) {
    if (Array.isArray(groups)) doc.hooks[event] = [...(doc.hooks[event] || []), ...groups]
  }
  return doc
}

export async function readHooksJson(path: string): Promise<Json | null> {
  if (!(await fs.pathExists(path))) return null
  return JSON.parse(await fs.readFile(path, 'utf-8')) as Json
}

/** Persist Codex trust for CCG's hooks. Returns how many handlers were trusted. */
export async function trustCcgCodexHooks(codexHome: string): Promise<number> {
  const hooksJson = await readHooksJson(join(codexHome, 'hooks.json'))
  const entries = hooksJson ? ccgHookTrustEntries(hooksJson, codexHome) : []
  if (!entries.length) return 0
  const configPath = join(codexHome, 'config.toml')
  const config = await readCodexConfig(configPath)
  config.hooks = config.hooks || {}
  config.hooks.state = config.hooks.state || {}
  for (const { key, hash } of entries)
    config.hooks.state[key] = { ...(config.hooks.state[key] || {}), trusted_hash: hash }
  await writeCodexConfig(configPath, config)
  return entries.length
}

/** Remove the trust records for the given keys, leaving other hook state alone. */
export async function forgetCodexHookTrust(codexHome: string, keys: string[]): Promise<number> {
  const configPath = join(codexHome, 'config.toml')
  if (!keys.length || !(await fs.pathExists(configPath))) return 0
  const config = await readCodexConfig(configPath)
  const state = config.hooks?.state
  if (!state) return 0
  const present = keys.filter(k => k in state)
  if (!present.length) return 0
  for (const key of present) delete state[key]
  if (!Object.keys(state).length) delete config.hooks.state
  if (!Object.keys(config.hooks).length) delete config.hooks
  await writeCodexConfig(configPath, config)
  return present.length
}

/**
 * Take CCG's hooks back out of ~/.codex: its trust records and its hooks.json
 * groups. The file is deleted only when nothing of the user's is left in it.
 */
export async function uninstallCcgCodexHooks(codexHome: string): Promise<string[]> {
  const hooksPath = join(codexHome, 'hooks.json')
  const hooksJson = await readHooksJson(hooksPath)
  if (!hooksJson) return []
  const removed: string[] = []
  const keys = ccgHookTrustEntries(hooksJson, codexHome).map(e => e.key)
  const forgotten = await forgetCodexHookTrust(codexHome, keys)
  if (forgotten) removed.push(`~/.codex/config.toml [hooks.state] (${forgotten} CCG trust record${forgotten > 1 ? 's' : ''})`)
  const rest = withoutCcgHooks(hooksJson)
  if (!Object.keys(rest.hooks).length && Object.keys(rest).length === 1) {
    await fs.remove(hooksPath)
    removed.push('~/.codex/hooks.json')
  }
  else if (JSON.stringify(rest) !== JSON.stringify(hooksJson)) {
    await fs.writeFile(hooksPath, `${JSON.stringify(rest, null, 2)}\n`, 'utf-8')
    removed.push('~/.codex/hooks.json (CCG hook only; your hooks kept)')
  }
  return removed
}
