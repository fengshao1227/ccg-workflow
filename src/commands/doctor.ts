import ansis from 'ansis'
import fs from 'fs-extra'
import { execSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'pathe'
import { readCcgConfig } from '../utils/config'
import { version as packageVersion } from '../../package.json'

const OK = ansis.green('✓')
const WARN = ansis.yellow('⚠')
const FAIL = ansis.red('✗')

async function fileExists(p: string): Promise<boolean> {
  return fs.pathExists(p)
}

async function dirFiles(p: string): Promise<string[]> {
  if (!(await fs.pathExists(p))) return []
  return (await fs.readdir(p)).filter(f => !f.startsWith('.'))
}

// `execSync` is imported at the top, not required here. `dist/cli.mjs` is an ES
// module built without a `createRequire` shim, so a `require()` in this scope
// throws ReferenceError — and this catch would swallow it and answer `null`,
// which every caller reads as "not installed". A working binary reported as
// missing (#161), on every platform, with reinstalling unable to help.
function execSafe(cmd: string): string | null {
  try {
    return execSync(cmd, { stdio: 'pipe', timeout: 10000 }).toString().trim()
  }
  catch { return null }
}

export async function doctor(): Promise<void> {
  const installDir = join(homedir(), '.claude')
  const checks: { label: string, status: string, detail: string }[] = []

  // 1. Node version
  const nodeVer = process.version
  const major = Number.parseInt(nodeVer.slice(1))
  checks.push({
    label: 'Node.js',
    status: major >= 20 ? OK : FAIL,
    detail: `${nodeVer}${major < 20 ? ' (requires >=20)' : ''}`,
  })

  // 2. CCG config
  const config = await readCcgConfig()
  checks.push({
    label: 'CCG config',
    status: config ? OK : WARN,
    detail: config ? `v${config.general?.version || '?'}, lang=${config.general?.language || '?'}` : 'Not found (~/.claude/.ccg/config.toml)',
  })

  // 3. Commands
  const cmds = await dirFiles(join(installDir, 'commands', 'ccg'))
  const cmdCount = cmds.filter(f => f.endsWith('.md')).length
  checks.push({
    label: 'Commands',
    status: cmdCount > 0 ? OK : FAIL,
    detail: `${cmdCount} installed`,
  })

  // 4. Hooks
  const hookDir = join(installDir, 'hooks', 'ccg')
  const hooks = await dirFiles(hookDir)
  const hookCount = hooks.filter(f => f.endsWith('.js')).length
  checks.push({
    label: 'Hooks',
    status: hookCount >= 4 ? OK : hookCount > 0 ? WARN : FAIL,
    detail: `${hookCount}/5 scripts`,
  })

  // 5. Hooks registered in settings.json
  let hooksRegistered = 0
  const settingsPath = join(installDir, 'settings.json')
  if (await fileExists(settingsPath)) {
    try {
      const settings = await fs.readJSON(settingsPath)
      const hooksConfig = settings.hooks || {}
      for (const entries of Object.values(hooksConfig) as any[]) {
        for (const entry of (Array.isArray(entries) ? entries : [])) {
          const cmds = (entry?.hooks || []) as any[]
          if (cmds.some((h: any) => typeof h?.command === 'string' && h.command.includes('hooks/ccg/'))) {
            hooksRegistered++
          }
        }
      }
    }
    catch { /* ignore */ }
  }
  checks.push({
    label: 'Hook registration',
    status: hooksRegistered >= 3 ? OK : hooksRegistered > 0 ? WARN : FAIL,
    detail: `${hooksRegistered} events in settings.json`,
  })

  // 6. Binary
  const wrapperName = process.platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'
  const wrapperPath = join(installDir, 'bin', wrapperName)
  let binaryVer: string | null = null
  if (await fileExists(wrapperPath)) {
    binaryVer = execSafe(`"${wrapperPath}" --version`)
    if (binaryVer) binaryVer = binaryVer.replace(/^.*version\s*/, '')
  }
  checks.push({
    label: 'Binary',
    status: binaryVer ? OK : FAIL,
    detail: binaryVer ? `v${binaryVer}` : `Not found (${wrapperPath})`,
  })

  // 7. Skills
  const skillDir = join(installDir, 'skills', 'ccg')
  const hasSkills = await fileExists(skillDir)
  checks.push({
    label: 'Skills',
    status: hasSkills ? OK : WARN,
    detail: hasSkills ? 'Installed' : 'Not found',
  })

  // 8. Rules
  const rulesDir = join(installDir, 'rules')
  const rules = (await dirFiles(rulesDir)).filter(f => f.startsWith('ccg-'))
  checks.push({
    label: 'Rules',
    status: rules.length >= 2 ? OK : rules.length > 0 ? WARN : FAIL,
    detail: rules.length > 0 ? rules.join(', ') : 'None',
  })

  // 9. MCP servers
  const claudeJsonPath = join(homedir(), '.claude.json')
  let mcpServers: string[] = []
  if (await fileExists(claudeJsonPath)) {
    try {
      const cj = await fs.readJSON(claudeJsonPath)
      mcpServers = Object.keys(cj.mcpServers || {})
    }
    catch { /* ignore */ }
  }
  checks.push({
    label: 'MCP servers',
    status: mcpServers.length > 0 ? OK : WARN,
    detail: mcpServers.length > 0 ? mcpServers.join(', ') : 'None configured',
  })

  // 10. Codex mode
  const codexAgentsMd = join(homedir(), '.codex', 'AGENTS.md')
  const hasCodexMode = await fileExists(codexAgentsMd)
  checks.push({
    label: 'Codex mode',
    status: hasCodexMode ? OK : ansis.gray('—'),
    detail: hasCodexMode ? 'Installed' : 'Not installed (optional)',
  })

  // 11. Grok CLI (only when routing uses grok)
  const routingModels = [
    config?.routing?.frontend?.primary,
    config?.routing?.backend?.primary,
    ...(config?.routing?.frontend?.models || []),
    ...(config?.routing?.backend?.models || []),
  ]
  if (routingModels.includes('opencode')) {
    const ocVer = execSafe('opencode --version')
    checks.push({
      label: 'OpenCode CLI',
      status: ocVer ? OK : FAIL,
      detail: ocVer ? `v${ocVer.split('\n')[0]}` : 'Not found — install: npm i -g opencode-ai',
    })
  }

  if (routingModels.includes('claude') && config?.routing?.frontend?.primary === 'claude' && config?.routing?.backend?.primary === 'claude') {
    checks.push({
      label: 'Pure Claude Code',
      status: OK,
      detail: 'Agent Teams mode — no external model CLI required',
    })
  }

  if (routingModels.includes('kimi')) {
    const kimiVer = execSafe('kimi --version')
    const kimiHome = join(homedir(), '.kimi-code')
    const loggedIn = await fileExists(join(kimiHome, 'config.toml')) || await fileExists(join(kimiHome, 'auth.json'))
    checks.push({
      label: 'Kimi Code CLI',
      status: kimiVer ? (loggedIn ? OK : WARN) : FAIL,
      detail: kimiVer
        ? `v${kimiVer.split('\n')[0]}${loggedIn ? '' : ' — not logged in (run: kimi, then /login)'}`
        : 'Not found — install: npm i -g @moonshot-ai/kimi-code',
    })
  }

  if (routingModels.includes('grok')) {
    const grokName = process.platform === 'win32' ? 'grok.exe' : 'grok'
    const grokFallback = join(homedir(), '.grok', 'bin', grokName)
    const grokVer = execSafe('grok --version') || (await fileExists(grokFallback) ? execSafe(`"${grokFallback}" --version`) : null)
    const grokAuth = await fileExists(join(homedir(), '.grok', 'auth.json'))
    checks.push({
      label: 'Grok CLI',
      status: grokVer ? (grokAuth ? OK : WARN) : FAIL,
      detail: grokVer
        ? `${grokVer.split('\n')[0]}${grokAuth ? '' : ' — not logged in (run: grok login; tokens expire after 7 days)'}`
        : 'Not found — install: curl -fsSL https://x.ai/cli/install.sh | bash',
    })
  }

  // Output
  console.log()
  console.log(ansis.cyan.bold(`  CCG Doctor v${packageVersion}`))
  console.log()
  for (const { label, status, detail } of checks) {
    console.log(`  ${status} ${ansis.bold(label.padEnd(20))} ${ansis.gray(detail)}`)
  }

  const failures = checks.filter(c => c.status === FAIL)
  console.log()
  if (failures.length === 0) {
    console.log(ansis.green('  All checks passed.'))
  }
  else {
    console.log(ansis.red(`  ${failures.length} issue(s) found. Run ${ansis.cyan('npx ccg-workflow')} to reinstall.`))
  }
  console.log()
}

export async function status(): Promise<void> {
  const installDir = join(homedir(), '.claude')

  // Version
  const config = await readCcgConfig()
  const installedVer = config?.general?.version || 'unknown'
  const latestVer = execSafe('npm view ccg-workflow version') || 'unknown'

  // Commands
  const cmds = (await dirFiles(join(installDir, 'commands', 'ccg'))).filter(f => f.endsWith('.md'))

  // Hooks
  const hooks = (await dirFiles(join(installDir, 'hooks', 'ccg'))).filter(f => f.endsWith('.js'))

  // Binary
  const wrapperName = process.platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'
  const wrapperPath = join(installDir, 'bin', wrapperName)
  let binaryVer = '—'
  if (await fileExists(wrapperPath)) {
    const raw = execSafe(`"${wrapperPath}" --version`)
    if (raw) binaryVer = raw.replace(/^.*version\s*/, 'v')
  }

  // Model routing
  const frontend = config?.routing?.frontend?.primary || '—'
  const backend = config?.routing?.backend?.primary || '—'

  // MCP
  let mcpServers: string[] = []
  const claudeJsonPath = join(homedir(), '.claude.json')
  if (await fileExists(claudeJsonPath)) {
    try {
      const cj = await fs.readJSON(claudeJsonPath)
      mcpServers = Object.keys(cj.mcpServers || {})
    }
    catch { /* ignore */ }
  }

  // Active tasks
  let activeTasks = 0
  const tasksDir = join(process.cwd(), '.ccg', 'tasks')
  if (await fileExists(tasksDir)) {
    for (const d of await fs.readdir(tasksDir)) {
      if (d === 'archive') continue
      const taskJson = join(tasksDir, d, 'task.json')
      if (await fileExists(taskJson)) {
        try {
          const t = await fs.readJSON(taskJson)
          const s = String(t.status || '').toLowerCase()
          if (!['completed', 'complete', 'done', 'finished', 'archived', 'cancelled', 'closed'].includes(s)) {
            activeTasks++
          }
        }
        catch { /* ignore */ }
      }
    }
  }

  // Codex mode
  const codexMode = await fileExists(join(homedir(), '.codex', 'AGENTS.md'))

  // Output
  console.log()
  console.log(ansis.cyan.bold('  CCG Status'))
  console.log()
  console.log(`  ${ansis.bold('Version')}        ${installedVer}${installedVer !== latestVer ? ansis.yellow(` (latest: ${latestVer})`) : ansis.green(' (up to date)')}`)
  console.log(`  ${ansis.bold('Commands')}       ${cmds.length}`)
  console.log(`  ${ansis.bold('Hooks')}          ${hooks.length} scripts`)
  console.log(`  ${ansis.bold('Binary')}         ${binaryVer}`)
  console.log(`  ${ansis.bold('Frontend')}       ${frontend}`)
  console.log(`  ${ansis.bold('Backend')}        ${backend}`)
  console.log(`  ${ansis.bold('MCP')}            ${mcpServers.length > 0 ? mcpServers.join(', ') : ansis.gray('none')}`)
  console.log(`  ${ansis.bold('Codex mode')}     ${codexMode ? 'installed' : ansis.gray('not installed')}`)
  console.log(`  ${ansis.bold('Active tasks')}   ${activeTasks > 0 ? ansis.yellow(String(activeTasks)) : '0'}`)
  console.log()
}
