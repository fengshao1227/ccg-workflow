import fs from 'fs-extra'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'pathe'
import { parse } from 'smol-toml'
import { version } from '../../package.json'
import { ccgHookTrustEntries } from './codex-hook-trust'
import type { SkillManagerOptions } from './skill-manager'
import { listSkills, SKILL_MANIFEST_FILE } from './skill-manager'

export type DoctorStatus = 'pass' | 'warn' | 'fail' | 'skip'
export interface DoctorCheck {
  id: string
  label: string
  status: DoctorStatus
  detail: string
  remediation: string | null
}
export interface DoctorReport {
  schemaVersion: 1
  version: string
  mode: 'claude' | 'codex' | 'both' | 'skills' | 'none'
  backends: string[]
  checks: DoctorCheck[]
  failureCount: number
  warningCount: number
}
export interface DoctorDependencies {
  home?: string
  installDir?: string
  codexDir?: string
  configPath?: string
  platform?: NodeJS.Platform
  nodeVersion?: string
  exec?: (file: string, args: string[]) => string | null
  output?: (text: string) => void
  setExitCode?: (code: number) => void
  skillPaths?: Partial<Record<'claude' | 'codex', SkillManagerOptions>>
}
type RecordValue = Record<string, unknown>
const HOOK_FILES = ['task-utils.js', 'workflow-state.js', 'session-start.js', 'subagent-context.js', 'skill-router.js']
const HOOK_EVENTS: Record<string, string[]> = {
  UserPromptSubmit: ['workflow-state.js', 'skill-router.js'],
  SessionStart: ['session-start.js'],
  PreToolUse: ['subagent-context.js'],
}
const BACKENDS: Record<string, { label: string, commands: string[], windows: string[] }> = {
  codex: { label: 'Codex CLI', commands: ['codex'], windows: ['codex.cmd', 'codex.exe'] },
  gemini: { label: 'Gemini CLI', commands: ['gemini'], windows: ['gemini.cmd'] },
  antigravity: { label: 'Antigravity CLI', commands: ['agy'], windows: ['agy.exe', 'agy.cmd'] },
  claude: { label: 'Claude CLI', commands: ['claude'], windows: ['claude.exe', 'claude.cmd'] },
  kimi: { label: 'Kimi Code CLI', commands: ['kimi'], windows: ['kimi.exe'] },
  grok: { label: 'Grok CLI', commands: ['grok'], windows: ['grok.exe'] },
  opencode: { label: 'OpenCode CLI', commands: ['opencode'], windows: ['opencode.exe', 'opencode.cmd'] },
}

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
}
async function readText(path: string): Promise<string | null> {
  try { return await fs.readFile(path, 'utf8') }
  catch { return null }
}
async function files(path: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(path, { withFileTypes: true })
    return entries.filter(e => e.isFile()).map(e => e.name)
  }
  catch { return [] }
}
function check(id: string, label: string, status: DoctorStatus, detail: string, remediation?: string): DoctorCheck {
  return { id, label, status, detail, remediation: status === 'pass' || status === 'skip' ? null : remediation || 'Run npx ccg-workflow to repair the installation.' }
}
function executeVersion(file: string, args: string[]): string | null {
  try {
    // Only fixed npm shim names use cmd.exe. Paths and configuration values
    // never become shell commands; native executables use execFile directly.
    if (process.platform === 'win32' && /^[\w-]+\.cmd$/.test(file)) {
      return execFileSync('cmd.exe', ['/d', '/s', '/c', `${file} --version`], { stdio: 'pipe', timeout: 10000 }).toString().trim()
    }
    return execFileSync(file, args, { stdio: 'pipe', timeout: 10000 }).toString().trim()
  }
  catch { return null }
}
function versionDetail(raw: string): string {
  // Do not echo arbitrary executable output (or terminal escape sequences).
  const match = raw.match(/\b(?:v)?(\d+\.\d+(?:\.\d+)?(?:-[\w.-]+)?)\b/)
  return match ? `v${match[1]}` : 'Available (--version succeeded)'
}

async function readConfiguration(path: string): Promise<{ config: RecordValue, result: DoctorCheck }> {
  const text = await readText(path)
  if (text === null) {
    return { config: {}, result: check('config', 'CCG config', 'warn', 'Not found or unreadable', 'Run npx ccg-workflow to configure model routing.') }
  }
  try {
    const config = record(parse(text))
    const configured = Object.keys(record(config.routing)).length > 0
    return { config, result: check('config', 'CCG config', configured ? 'pass' : 'fail', configured ? 'Readable TOML with model routing' : 'Missing model routing', 'Reconfigure model routing with npx ccg-workflow.') }
  }
  catch {
    return { config: {}, result: check('config', 'CCG config', 'fail', 'Invalid TOML', 'Repair config.toml syntax or run npx ccg-workflow to reconfigure.') }
  }
}

function selectedBackends(config: RecordValue): { names: string[], invalid: boolean } {
  const names = new Set<string>()
  const routing = record(config.routing)
  let invalid = false
  for (const section of ['frontend', 'backend', 'review']) {
    const route = record(routing[section])
    if ((section !== 'review' && typeof route.primary !== 'string') || !Array.isArray(route.models)) invalid = true
    const values = [route.primary, ...(Array.isArray(route.models) ? route.models : [])].filter(v => v !== undefined)
    for (const value of values) {
      if (typeof value !== 'string' || !Object.hasOwn(BACKENDS, value)) invalid = true
      else names.add(value)
    }
    if (Array.isArray(route.models) && route.models.length === 0) invalid = true
  }
  return { names: [...names].sort(), invalid }
}

async function modeChecks(installDir: string, codexDir: string, hasNativeSkills: boolean) {
  const commandFiles = (await files(join(installDir, 'commands', 'ccg'))).filter(f => f.endsWith('.md'))
  const claude = commandFiles.length > 0 || await fs.pathExists(join(installDir, 'commands', 'ccg.md'))
  const marker = await readText(join(codexDir, '.ccg-version'))
  const agents = await readText(join(codexDir, 'AGENTS.md'))
  const codex = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(marker?.trim() || '') || !!agents?.includes('<!-- CCG:START')
  const mode: DoctorReport['mode'] = claude ? (codex ? 'both' : 'claude') : (codex ? 'codex' : hasNativeSkills ? 'skills' : 'none')
  return { mode, commandFiles, managedAgents: !!agents?.includes('<!-- CCG:START') }
}

function normalized(command: string): string { return command.replaceAll('\\', '/') }
function registeredCommands(settings: RecordValue, event: string): string[] {
  const entries = record(settings.hooks)[event]
  if (!Array.isArray(entries)) return []
  return entries.flatMap((entry) => {
    const handlers = record(entry).hooks
    return Array.isArray(handlers)
      ? handlers.filter(h => record(h).type === 'command' && typeof record(h).command === 'string').map(h => String(record(h).command))
      : []
  })
}
function references(command: string, path: string): boolean {
  const value = normalized(command)
  const expected = normalized(path)
  const start = value.indexOf(expected)
  if (start < 0) return false
  const before = value[start - 1]
  const after = value[start + expected.length]
  return (!before || /[\s"']/.test(before)) && (!after || /[\s"']/.test(after))
}

async function claudeChecks(installDir: string, commandFiles: string[]): Promise<DoctorCheck[]> {
  const hookDir = join(installDir, 'hooks', 'ccg')
  const hookFiles = await files(hookDir)
  const missing = HOOK_FILES.filter(f => !hookFiles.includes(f))
  const settings = await readText(join(installDir, 'settings.json'))
  let registered = 0
  try {
    const json = record(JSON.parse(settings || '{}'))
    for (const [event, handlers] of Object.entries(HOOK_EVENTS)) {
      const commands = registeredCommands(json, event)
      registered += handlers.filter(name => commands.some(cmd => references(cmd, join(hookDir, name)))).length
    }
  }
  catch { /* Report broken registration without echoing settings or errors. */ }
  const rules = (await files(join(installDir, 'rules'))).filter(f => f.startsWith('ccg-') && f.endsWith('.md'))
  const hasEngineCommand = await fs.pathExists(join(installDir, 'commands', 'ccg.md'))
  return [
    check('claude.commands', 'Commands', commandFiles.length > 0 || hasEngineCommand ? 'pass' : 'fail', `${commandFiles.length} workflow commands${hasEngineCommand ? ', engine entry installed' : ''}`),
    check('claude.hooks', 'Hooks', missing.length === 0 ? 'pass' : 'fail', `${5 - missing.length}/5 scripts${missing.length ? `; missing: ${missing.join(', ')}` : ''}`),
    check('claude.hook-registration', 'Hook registration', registered === 4 ? 'pass' : 'fail', `${registered}/4 handlers across 3 events in settings.json`),
    check('claude.rules', 'Rules', rules.length >= 2 ? 'pass' : 'warn', `${rules.length} CCG rules installed`),
  ]
}

async function codexChecks(codexDir: string, managedAgents: boolean): Promise<DoctorCheck[]> {
  const required = ['agents/ccg-implement.toml', 'agents/ccg-review.toml', 'agents/ccg-research.toml', 'hooks/ccg-workflow.py']
  const present = await Promise.all(required.map(path => fs.pathExists(join(codexDir, path))))
  let hookRegistered = false
  let settings: RecordValue = {}
  try {
    settings = record(JSON.parse(await readText(join(codexDir, 'hooks.json')) || '{}'))
    hookRegistered = registeredCommands(settings, 'UserPromptSubmit').some(cmd => references(cmd, join(codexDir, 'hooks', 'ccg-workflow.py')))
  }
  catch { /* Do not expose user hook commands. */ }
  let validConfig = false
  let parsedConfig: RecordValue = {}
  const configText = await readText(join(codexDir, 'config.toml'))
  try {
    parsedConfig = configText === null ? {} : record(parse(configText))
    validConfig = configText !== null
  }
  catch { /* Configuration contents and errors may contain provider secrets. */ }
  const trustState = record(record(parsedConfig.hooks).state)
  const trustEntries = ccgHookTrustEntries(settings, codexDir)
  const hookTrusted = trustEntries.length > 0 && trustEntries.every(e => record(trustState[e.key]).trusted_hash === e.hash)
  const marker = await readText(join(codexDir, '.ccg-version'))
  return [
    check('codex.agents', 'Codex mode', managedAgents ? 'pass' : 'fail', managedAgents ? 'CCG managed AGENTS.md installed' : 'CCG managed AGENTS.md missing', 'Run ccg codex-mode install.'),
    check('codex.artifacts', 'Codex files', present.every(Boolean) ? 'pass' : 'fail', `${present.filter(Boolean).length}/${required.length} managed agent and hook files`, 'Run ccg codex-mode install.'),
    check('codex.hook-registration', 'Codex hooks', hookRegistered ? 'pass' : 'fail', hookRegistered ? 'CCG workflow hook registered' : 'CCG workflow hook not registered', 'Run ccg codex-mode install.'),
    ...(hookRegistered ? [check('codex.hook-trust', 'Codex hook trust', hookTrusted ? 'pass' : 'warn', hookTrusted ? 'CCG workflow hook trusted' : 'CCG workflow hook not trusted; codex-cli >= 0.129 skips it', 'Run ccg codex-mode install, or trust it in Codex with /hooks.')] : []),
    check('codex.config', 'Codex config', validConfig ? 'pass' : 'fail', validConfig ? 'Readable Codex TOML' : 'Missing or invalid Codex TOML', 'Run ccg codex-mode install or repair the existing Codex config.toml.'),
    check('codex.version', 'Codex marker', /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(marker?.trim() || '') ? 'pass' : 'fail', marker ? 'CCG version marker present' : 'CCG version marker missing', 'Run ccg codex-mode install.'),
  ]
}

async function standaloneDelegationChecks(installDir: string, codexDir: string, home: string, platform: NodeJS.Platform, exec: NonNullable<DoctorDependencies['exec']>): Promise<DoctorCheck[]> {
  const wrapper = join(installDir, 'bin', platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper')
  const raw = await fs.pathExists(wrapper) ? exec(wrapper, ['--version']) : null
  const agents = await readText(join(codexDir, 'AGENTS.md')) || ''
  const names = [...new Set([...agents.matchAll(/--backend ([a-z][a-z0-9-]*)\b/g)].map(match => match[1]))].filter(name => Object.hasOwn(BACKENDS, name))
  const promptFiles = names.flatMap(name => ['analyzer', 'reviewer'].map(role => join(installDir, '.ccg', 'prompts', name, `${role}.md`)))
  const hasPrompts = promptFiles.length > 0 && (await Promise.all(promptFiles.map(path => fs.pathExists(path)))).every(Boolean)
  const drivers = await backendChecks(names.filter(name => name !== 'codex'), false, home, platform, exec)
  return [
    check('binary.wrapper', 'External delegation', raw ? 'pass' : 'warn', raw ? versionDetail(raw) : 'Wrapper not installed; M+ external model delegation is unavailable', 'Run ccg init to install the external model delegation toolchain.'),
    check('codex.role-prompts', 'Delegation prompts', hasPrompts ? 'pass' : 'warn', hasPrompts ? 'External role prompts found' : 'Role prompts not installed; external model delegation is incomplete', 'Run ccg init to install role prompts and configure external model CLIs.'),
    ...drivers.map(driver => ({ ...driver, id: driver.id.replace('cli.', 'cli.delegation.'), status: driver.status === 'fail' ? 'warn' as const : driver.status, detail: driver.status === 'fail' ? `${driver.detail}; external model delegation is unavailable` : driver.detail })),
  ]
}

async function backendChecks(names: string[], pureClaude: boolean, home: string, platform: NodeJS.Platform, exec: NonNullable<DoctorDependencies['exec']>) {
  if (pureClaude) return [check('routing.pure-claude', 'Pure Claude Code', 'pass', 'Agent Teams mode; no external model CLI required')]
  const checks: DoctorCheck[] = []
  for (const name of names) {
    const spec = BACKENDS[name]
    const candidates = platform === 'win32' ? spec.windows : spec.commands
    let output: string | null = null
    for (const command of candidates) {
      output = exec(command, ['--version'])
      if (output) break
    }
    if (!output && name === 'grok') {
      const fallback = join(home, '.grok', 'bin', platform === 'win32' ? 'grok.exe' : 'grok')
      if (await fs.pathExists(fallback)) output = exec(fallback, ['--version'])
    }
    checks.push(check(`cli.${name}`, spec.label, output ? 'pass' : 'fail', output ? versionDetail(output) : 'Not found or --version failed', `Install ${spec.label} and ensure ${spec.commands[0]} is on PATH, then run ccg doctor.`))
  }
  return checks
}

async function mcpCheck(home: string, codexDir: string, mode: DoctorReport['mode']): Promise<DoctorCheck> {
  let count = 0
  let invalid = false
  for (const [path, kind] of [[join(home, '.claude.json'), 'json'], [join(codexDir, 'config.toml'), 'toml']]) {
    if ((kind === 'json' && mode === 'codex') || (kind === 'toml' && mode === 'claude')) continue
    const text = await readText(path)
    if (!text) continue
    try {
      const parsed = record(kind === 'json' ? JSON.parse(text) : parse(text))
      count += Object.keys(record(parsed[kind === 'json' ? 'mcpServers' : 'mcp_servers'])).length
    }
    catch { invalid = true }
  }
  return check('mcp.config', 'MCP servers', invalid ? 'warn' : count ? 'pass' : 'warn', invalid ? 'MCP configuration unreadable' : `${count} configured (connectivity not tested)`, 'Run ccg diagnose-mcp for MCP configuration and connectivity checks.')
}

function nativeSkillPaths(home: string, installDir: string, target: 'claude' | 'codex', deps: DoctorDependencies) {
  const root = target === 'claude' ? installDir : join(home, '.agents')
  return { nativeDir: join(root, 'skills'), storeDir: join(root, '.ccg-skills'), ...deps.skillPaths?.[target], target }
}

async function skillChecks(home: string, installDir: string, mode: DoctorReport['mode'], deps: DoctorDependencies): Promise<DoctorCheck[]> {
  const candidates: ('claude' | 'codex')[] = mode === 'both' || mode === 'skills' ? ['claude', 'codex'] : mode === 'none' ? [] : [mode]
  const targets: ('claude' | 'codex')[] = []
  for (const target of candidates) {
    const paths = nativeSkillPaths(home, installDir, target, deps)
    if (mode !== 'skills' || await fs.pathExists(join(paths.storeDir, SKILL_MANIFEST_FILE))) targets.push(target)
  }
  return Promise.all(targets.map(async (target) => {
    const paths = nativeSkillPaths(home, installDir, target, deps)
    const id = `${target}.skills`
    if (!await fs.pathExists(join(paths.storeDir, SKILL_MANIFEST_FILE))) {
      const legacy = await fs.pathExists(join(installDir, 'skills', 'ccg', 'SKILL.md'))
      return check(id, `${target === 'claude' ? 'Claude' : 'Codex'} skills`, 'warn', legacy ? 'Legacy bundled skills found; native selection not configured' : 'No managed native skill selection', `Run ccg skills list --target ${target} to select native skills.`)
    }
    try {
      const entries = (await listSkills(paths)).filter(entry => entry.installed)
      const broken = entries.filter(entry => !entry.healthy)
      return check(id, `${target === 'claude' ? 'Claude' : 'Codex'} skills`, broken.length ? 'fail' : 'pass', `${entries.length - broken.length}/${entries.length} managed skills healthy`, `Run ccg skills update --target ${target} to repair managed skills.`)
    }
    catch {
      return check(id, `${target === 'claude' ? 'Claude' : 'Codex'} skills`, 'fail', 'Managed skill manifest or directories are invalid', `Inspect managed skill paths and run ccg skills list --target ${target}.`)
    }
  }))
}

export async function collectDoctorReport(deps: DoctorDependencies = {}): Promise<DoctorReport> {
  const home = deps.home || homedir()
  const installDir = deps.installDir || join(home, '.claude')
  const codexDir = deps.codexDir || join(home, '.codex')
  const configPath = deps.configPath || join(installDir, '.ccg', 'config.toml')
  const platform = deps.platform || process.platform
  const exec = deps.exec || executeVersion
  const nodeVersion = deps.nodeVersion || process.version
  const { config, result } = await readConfiguration(configPath)
  const nativeManifests = await Promise.all((['claude', 'codex'] as const).map(target => fs.pathExists(join(nativeSkillPaths(home, installDir, target, deps).storeDir, SKILL_MANIFEST_FILE))))
  const { mode, commandFiles, managedAgents } = await modeChecks(installDir, codexDir, nativeManifests.some(Boolean))
  const workflowInstalled = mode === 'claude' || mode === 'both'
  if (mode === 'codex') {
    result.status = result.status === 'warn' ? 'skip' : result.status === 'fail' ? 'warn' : 'pass'
    if (result.status === 'skip') result.detail = 'Claude routing config is optional for standalone Codex mode'
    result.remediation = result.status === 'warn' ? 'Repair optional Claude routing config before enabling external model delegation.' : null
  }
  if (workflowInstalled && result.status === 'warn') result.status = 'fail'
  const { names, invalid } = workflowInstalled ? selectedBackends(config) : { names: mode === 'codex' ? ['codex'] : [], invalid: false }
  const pureClaude = names.length === 1 && names[0] === 'claude' && !invalid
  const checks: DoctorCheck[] = [
    check('runtime.node', 'Node.js', Number.parseInt(nodeVersion.slice(1)) >= 20 ? 'pass' : 'fail', nodeVersion, 'Install Node.js 20 or newer.'),
    result,
    check('installation.mode', 'Installation', mode === 'none' ? 'fail' : 'pass', mode === 'none' ? 'No CCG managed installation found' : `CCG ${mode} mode`),
  ]
  if (workflowInstalled && Object.keys(config).length > 0) checks.push(check('routing.backends', 'Model routing', invalid ? 'fail' : 'pass', invalid ? 'Invalid or unsupported backend routing' : names.join(', '), 'Reconfigure frontend, backend and review routing with npx ccg-workflow.'))
  if (mode === 'claude' || mode === 'both') checks.push(...await claudeChecks(installDir, commandFiles))
  if (mode === 'codex' || mode === 'both') checks.push(...await codexChecks(codexDir, managedAgents))
  if (mode === 'codex') checks.push(...await standaloneDelegationChecks(installDir, codexDir, home, platform, exec))
  if (!pureClaude && workflowInstalled) {
    const wrapper = join(installDir, 'bin', platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper')
    const raw = await fs.pathExists(wrapper) ? exec(wrapper, ['--version']) : null
    checks.push(check('binary.wrapper', 'Binary', raw ? 'pass' : 'fail', raw ? versionDetail(raw) : 'codeagent-wrapper not found or --version failed'))
  }
  checks.push(...await backendChecks(names, pureClaude, home, platform, exec))
  checks.push(...await skillChecks(home, installDir, mode, deps))
  checks.push(await mcpCheck(home, codexDir, mode))
  return { schemaVersion: 1, version, mode, backends: names, checks, failureCount: checks.filter(c => c.status === 'fail').length, warningCount: checks.filter(c => c.status === 'warn').length }
}
