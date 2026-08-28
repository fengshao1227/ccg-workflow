import ansis from 'ansis'
import inquirer from 'inquirer'
import ora from 'ora'
import { exec, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'pathe'
import fs from 'fs-extra'
import { parse as parseTOML } from 'smol-toml'
import { version } from '../../package.json'
import { configMcp } from './config-mcp'
import { i18n } from '../i18n'
import { configureGeminiCliApi, installCodexMode, removeGeminiCliApi, uninstallCodexMode, uninstallWorkflows } from '../utils/installer'
import { readCcgConfig, writeCcgConfig } from '../utils/config'
import { init } from './init'
import { update } from './update'
import { isWindows } from '../utils/platform'

const execAsync = promisify(exec)

// ═══════════════════════════════════════════════════════
// UI Helpers
// ═══════════════════════════════════════════════════════

/**
 * Get visual display width of a string (CJK = 2, ASCII = 1)
 */
function visWidth(s: string): number {
  const stripped = s.replace(/\x1B\[[0-9;]*m/g, '')
  let w = 0
  for (const ch of stripped) {
    const code = ch.codePointAt(0) || 0
    // CJK Unified Ideographs + common fullwidth ranges
    if (
      (code >= 0x2E80 && code <= 0x9FFF)
      || (code >= 0xF900 && code <= 0xFAFF)
      || (code >= 0xFE30 && code <= 0xFE4F)
      || (code >= 0xFF00 && code <= 0xFF60)
      || (code >= 0xFFE0 && code <= 0xFFE6)
      || (code >= 0x1F300 && code <= 0x1F9FF) // Emojis
      || (code >= 0x20000 && code <= 0x2FA1F) // CJK Extension B+
    ) {
      w += 2
    }
    else {
      w += 1
    }
  }
  return w
}

/**
 * Pad a string to a fixed visible width (ANSI + CJK aware)
 */
function pad(s: string, w: number): string {
  const diff = w - visWidth(s)
  return diff > 0 ? s + ' '.repeat(diff) : s
}

const INNER_W = 60

/**
 * Center a string (with ANSI) inside a fixed-width area
 */
function centerLine(s: string, w: number): string {
  const vis = visWidth(s)
  const left = Math.max(0, Math.floor((w - vis) / 2))
  const right = Math.max(0, w - vis - left)
  return ' '.repeat(left) + s + ' '.repeat(right)
}

/**
 * Draw a boxed row: ║ <content padded to INNER_W> ║
 */
function boxRow(content: string): string {
  const vis = visWidth(content)
  const gap = Math.max(0, INNER_W - vis)
  return ansis.cyan('║') + content + ' '.repeat(gap) + ansis.cyan('║')
}

function drawHeader(statusParts: string[]): void {
  const top = ansis.cyan('╔' + '═'.repeat(INNER_W) + '╗')
  const bot = ansis.cyan('╚' + '═'.repeat(INNER_W) + '╝')
  const empty = boxRow(' '.repeat(INNER_W))

  // ASCII Art Logo
  const logo = [
    '  ██████╗  ██████╗  ██████╗ ',
    ' ██╔════╝ ██╔════╝ ██╔════╝ ',
    ' ██║      ██║      ██║  ███╗',
    ' ██║      ██║      ██║   ██║',
    ' ╚██████╗ ╚██████╗ ╚██████╔╝',
    '  ╚═════╝  ╚═════╝  ╚═════╝ ',
  ]

  console.log()
  console.log(top)
  console.log(empty)
  for (const line of logo) {
    console.log(boxRow(centerLine(ansis.bold.white(line), INNER_W)))
  }
  console.log(empty)
  console.log(boxRow(centerLine(ansis.gray('Claude + Codex + Gemini'), INNER_W)))
  console.log(boxRow(centerLine(ansis.gray('Multi-Model Collaboration'), INNER_W)))
  console.log(empty)
  if (statusParts.length > 0) {
    const statusLine = statusParts.join(ansis.gray('  |  '))
    console.log(boxRow(centerLine(statusLine, INNER_W)))
    console.log(empty)
  }
  console.log(bot)
  console.log()
}

function groupSep(label: string): InstanceType<typeof inquirer.Separator> {
  const w = 42
  const labelW = visWidth(label)
  const remaining = Math.max(0, w - labelW - 2)
  const left = Math.floor(remaining / 2)
  const right = remaining - left
  return new inquirer.Separator(ansis.gray(`${'─'.repeat(left)} ${label} ${'─'.repeat(right)}`))
}

// ═══════════════════════════════════════════════════════
// Main Menu
// ═══════════════════════════════════════════════════════

export async function showMainMenu(): Promise<void> {
  while (true) {
    // Read config for status display
    const config = await readCcgConfig()
    const cmdCount = config?.workflows?.installed?.length || 0
    const lang = config?.general?.language || 'zh-CN'
    const mcpProvider = config?.mcp?.provider || '—'

    // Build status parts
    const statusParts = [
      ansis.green(`v${version}`),
      ansis.white(`${cmdCount} commands`),
      ansis.yellow(lang),
    ]
    if (mcpProvider && mcpProvider !== '—' && mcpProvider !== 'skip') {
      statusParts.push(ansis.magenta(mcpProvider))
    }

    drawHeader(statusParts)

    const isZh = lang === 'zh-CN'

    // Build menu item helper: "  N. Label  - description"
    const item = (key: string, label: string, desc: string) => ({
      name: `  ${ansis.green(key + '.')} ${pad(label, 20)} ${ansis.gray('- ' + desc)}`,
      value: key,
    })

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: i18n.t('menu:title'),
      pageSize: 20,
      choices: [
        groupSep(isZh ? 'Claude Code' : 'Claude Code'),
        item('1', i18n.t('menu:options.init'), isZh ? '安装 CCG 工作流' : 'Install CCG workflows'),
        item('2', i18n.t('menu:options.update'), isZh ? '更新到最新版本' : 'Update to latest version'),
        item('3', i18n.t('menu:options.configMcp'), isZh ? '代码检索 MCP 工具' : 'Code retrieval MCP tool'),
        item('4', i18n.t('menu:options.configApi'), isZh ? '自定义 API 端点' : 'Custom API endpoint'),
        item('5', i18n.t('menu:options.configStyle'), isZh ? '选择输出人格' : 'Choose output personality'),
        item('6', i18n.t('menu:options.configModel'), isZh ? '前端/后端模型切换' : 'Switch frontend/backend models'),

        groupSep(isZh ? '其他工具' : 'Tools'),
        item('X', isZh ? 'Codex 模式' : 'Codex Mode', isZh ? '安装 Codex 主导的多模型编排' : 'Install Codex-led multi-model orchestration'),
        item('T', i18n.t('menu:options.tools'), 'ccusage, CCometixLine'),
        item('C', i18n.t('menu:options.installClaude'), isZh ? '安装/重装 CLI' : 'Install/reinstall CLI'),

        groupSep('CCG'),
        item('H', i18n.t('menu:options.help'), isZh ? '查看全部斜杠命令' : 'View all slash commands'),
        item('-', i18n.t('menu:options.uninstall'), isZh ? '移除 CCG 配置' : 'Remove CCG config'),

        new inquirer.Separator(ansis.gray('─'.repeat(42))),
        { name: `  ${ansis.red('Q.')} ${i18n.t('menu:options.exit')}`, value: 'Q' },
      ],
    }])

    switch (action) {
      case '1':
        await init()
        break
      case '2':
        await update()
        break
      case '3':
        await configMcp()
        break
      case '4':
        await configApi()
        break
      case '5':
        await configOutputStyle()
        break
      case '6':
        await configModelRouting()
        break
      case 'X':
        await handleCodexMode()
        break
      case 'T':
        await handleTools()
        break
      case 'C':
        await handleInstallClaude()
        break
      case '-':
        await uninstall()
        break
      case 'H':
        showHelp()
        break
      case 'Q':
        console.log()
        console.log(ansis.gray(`  ${i18n.t('common:goodbye')}`))
        console.log()
        return
    }

    // Pause after action so user can see results
    console.log()
    await inquirer.prompt([{
      type: 'input',
      name: 'continue',
      message: ansis.gray(i18n.t('common:pressEnterToReturn')),
    }])
  }
}

// (visWidth and pad are defined in UI Helpers section above)

// ═══════════════════════════════════════════════════════
// Help
// ═══════════════════════════════════════════════════════

function showHelp(): void {
  const config = readCcgConfigSync()
  const isZh = (config?.general?.language || 'zh-CN') === 'zh-CN'

  console.log()
  console.log(ansis.cyan.bold(`  ${i18n.t('menu:help.title')}`))
  console.log()

  const col1 = 22 // command column width
  const section = (title: string) => console.log(ansis.yellow.bold(`  ${title}`))
  const cmd = (name: string, desc: string) => console.log(`  ${ansis.green(name.padEnd(col1))} ${ansis.gray(desc)}`)

  // Core Engine
  section(i18n.t('menu:help.sections.engine'))
  cmd('/ccg:go', i18n.t('menu:help.descriptions.go'))
  console.log()

  // OpenSpec Workflows
  section(i18n.t('menu:help.sections.opsx'))
  cmd('/ccg:spec-init', i18n.t('menu:help.descriptions.specInit'))
  cmd('/ccg:spec-research', i18n.t('menu:help.descriptions.specResearch'))
  cmd('/ccg:spec-plan', i18n.t('menu:help.descriptions.specPlan'))
  cmd('/ccg:spec-impl', i18n.t('menu:help.descriptions.specImpl'))
  cmd('/ccg:spec-review', i18n.t('menu:help.descriptions.specReview'))
  console.log()

  // Git Tools
  section(i18n.t('menu:help.sections.gitTools'))
  cmd('/ccg:commit', i18n.t('menu:help.descriptions.commit'))
  cmd('/ccg:rollback', i18n.t('menu:help.descriptions.rollback'))
  cmd('/ccg:clean-branches', i18n.t('menu:help.descriptions.cleanBranches'))
  cmd('/ccg:worktree', i18n.t('menu:help.descriptions.worktree'))
  console.log()

  // Project Management
  section(i18n.t('menu:help.sections.projectMgmt'))
  cmd('/ccg:init', i18n.t('menu:help.descriptions.init'))
  cmd('/ccg:context', i18n.t('menu:help.descriptions.context'))
  console.log()

  // Quality Gates
  section(i18n.t('menu:help.sections.qualityGates'))
  cmd('/ccg:verify-security', i18n.t('menu:help.descriptions.verifySecurity'))
  cmd('/ccg:verify-quality', i18n.t('menu:help.descriptions.verifyQuality'))
  cmd('/ccg:verify-change', i18n.t('menu:help.descriptions.verifyChange'))
  cmd('/ccg:verify-module', i18n.t('menu:help.descriptions.verifyModule'))
  console.log()

  console.log(ansis.gray(`  ${i18n.t('menu:help.hint')}`))
  console.log()
}

/**
 * Synchronous config read for non-async contexts (help display)
 */
function readCcgConfigSync(): any {
  try {
    const configPath = join(homedir(), '.claude', '.ccg', 'config.toml')
    if (fs.pathExistsSync(configPath)) {
      return parseTOML(fs.readFileSync(configPath, 'utf-8'))
    }
  }
  catch { /* ignore */ }
  return null
}

// ═══════════════════════════════════════════════════════
// API Configuration
// ═══════════════════════════════════════════════════════

async function configApi(): Promise<void> {
  console.log()
  console.log(ansis.cyan.bold(`  ${i18n.t('menu:api.title')}`))
  console.log()

  const settingsPath = join(homedir(), '.claude', 'settings.json')
  let settings: Record<string, any> = {}

  if (await fs.pathExists(settingsPath)) {
    settings = await fs.readJson(settingsPath)
  }

  // Show current config
  const currentUrl = settings.env?.ANTHROPIC_BASE_URL
  const currentKey = settings.env?.ANTHROPIC_AUTH_TOKEN || settings.env?.ANTHROPIC_API_KEY
  if (currentUrl || currentKey) {
    console.log(ansis.gray(`  ${i18n.t('menu:api.currentConfig')}`))
    if (currentUrl)
      console.log(ansis.gray(`    URL: ${currentUrl}`))
    if (currentKey)
      console.log(ansis.gray(`    Key: ${currentKey.slice(0, 8)}...${currentKey.slice(-4)}`))
    console.log()
  }

  const { apiProvider } = await inquirer.prompt([{
    type: 'list',
    name: 'apiProvider',
    message: i18n.t('menu:api.providerPrompt'),
    choices: [
      { name: `${ansis.green('●')} ${i18n.t('menu:api.officialOption')}`, value: 'official' },
      { name: `${ansis.cyan('●')} ${i18n.t('menu:api.thirdPartyOption')}`, value: 'thirdparty' },
      { name: `${ansis.yellow('★')} ${i18n.t('menu:api.sponsorAPIMart')} ${ansis.gray('— https://go.apimart.ai/gh-ccg-workflow')}`, value: 'apimart' },
      { name: `${ansis.magenta('●')} ${i18n.t('init:api.geminiCliOption')}`, value: 'gemini-cli' },
    ],
  }])

  // Gemini CLI gateway lives in ~/.gemini/.env, not Claude Code's
  // settings.json — handle it as its own flow and return early so the
  // ANTHROPIC_* writing below never runs for this choice.
  if (apiProvider === 'gemini-cli') {
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: i18n.t('init:api.geminiCliActionPrompt'),
      choices: [
        { name: `${ansis.green('●')} ${i18n.t('init:api.geminiCliConfigureOption')}`, value: 'configure' },
        { name: `${ansis.gray('○')} ${i18n.t('init:api.geminiCliRemoveOption')}`, value: 'remove' },
      ],
    }])

    if (action === 'remove') {
      const removed = await removeGeminiCliApi()
      console.log()
      console.log(removed.success
        ? ansis.green(`  ✓ ${i18n.t('init:api.geminiCliRemoved')}`)
        : ansis.yellow(`  ! ${removed.message}`))
      return
    }

    console.log(`    ${ansis.yellow('!')} ${i18n.t('init:api.geminiCliProtocolHint')}`)
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'url',
        message: `${i18n.t('init:api.geminiCliUrlPrompt')} ${ansis.gray(`(${i18n.t('menu:api.urlRequired')})`)}`,
        validate: (v: string) => v.trim() !== '' || i18n.t('menu:api.enterUrl'),
      },
      {
        type: 'password',
        name: 'key',
        message: `Gemini API Key ${ansis.gray(`(${i18n.t('menu:api.keyRequired')})`)}`,
        mask: '*',
        validate: (v: string) => v.trim() !== '' || i18n.t('menu:api.enterKey'),
      },
      {
        type: 'input',
        name: 'model',
        message: i18n.t('init:api.geminiCliModelPrompt'),
      },
    ])
    const result = await configureGeminiCliApi({
      baseUrl: answers.url.trim(),
      apiKey: answers.key.trim(),
      model: answers.model?.trim() || undefined,
    })
    console.log()
    if (result.success) {
      console.log(ansis.green(`  ✓ ${i18n.t('init:api.geminiCliSaved')}`))
      if (result.rcPath)
        console.log(ansis.gray(`    ${i18n.t('common:configFile')}: ${result.rcPath}`))
      if (result.needsReload)
        console.log(ansis.gray(`    ${i18n.t('init:api.geminiCliReloadHint')}`))
    }
    else {
      console.log(ansis.yellow(`  ! ${result.message}`))
    }
    return
  }

  if (apiProvider === 'official') {
    // Clear third-party config, let Claude Code use official auth
    if (!settings.env)
      settings.env = {}
    delete settings.env.ANTHROPIC_BASE_URL
    delete settings.env.ANTHROPIC_AUTH_TOKEN
    delete settings.env.ANTHROPIC_API_KEY
  }
  else if (apiProvider === 'apimart') {
    console.log()
    console.log(`    ${ansis.yellow('★')} ${i18n.t('menu:api.sponsorAPIMartGetKey')}: ${ansis.cyan.underline('https://go.apimart.ai/gh-ccg-workflow')}`)
    console.log()
    const { key } = await inquirer.prompt([{
      type: 'password',
      name: 'key',
      message: `APIMart API Key ${ansis.gray(`(${i18n.t('menu:api.keyRequired')})`)}`,
      mask: '*',
      validate: (v: string) => v.trim() !== '' || i18n.t('menu:api.enterKey'),
    }])

    if (!settings.env)
      settings.env = {}
    // No /v1 suffix: Claude Code appends /v1/messages to ANTHROPIC_BASE_URL itself.
    settings.env.ANTHROPIC_BASE_URL = 'https://api.apimart.ai'
    settings.env.ANTHROPIC_AUTH_TOKEN = key.trim()
    delete settings.env.ANTHROPIC_API_KEY
  }
  else {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'url',
        message: `API URL ${ansis.gray(`(${i18n.t('menu:api.urlRequired')})`)}`,
        default: currentUrl || '',
        validate: (v: string) => v.trim() !== '' || i18n.t('menu:api.enterUrl'),
      },
      {
        type: 'password',
        name: 'key',
        message: `API Key ${ansis.gray(`(${i18n.t('menu:api.keyRequired')})`)}`,
        mask: '*',
        validate: (v: string) => v.trim() !== '' || i18n.t('menu:api.enterKey'),
      },
    ])

    if (!settings.env)
      settings.env = {}
    settings.env.ANTHROPIC_BASE_URL = answers.url.trim()
    settings.env.ANTHROPIC_AUTH_TOKEN = answers.key.trim()
    delete settings.env.ANTHROPIC_API_KEY
  }

  // Default optimization config
  settings.env.DISABLE_TELEMETRY = '1'
  settings.env.DISABLE_ERROR_REPORTING = '1'
  settings.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  settings.env.CLAUDE_CODE_ATTRIBUTION_HEADER = '0'
  settings.env.MCP_TIMEOUT = '60000'

  // codeagent-wrapper permission allowlist
  if (!settings.permissions)
    settings.permissions = {}
  if (!settings.permissions.allow)
    settings.permissions.allow = []
  const wrapperPerms = [
    'Bash(~/.claude/bin/codeagent-wrapper*)',
    'Bash(*codeagent-wrapper*)',
  ]
  for (const perm of wrapperPerms) {
    if (!settings.permissions.allow.includes(perm))
      settings.permissions.allow.push(perm)
  }

  await fs.ensureDir(join(homedir(), '.claude'))
  await fs.writeJson(settingsPath, settings, { spaces: 2 })

  console.log()
  console.log(ansis.green(`  ✓ ${i18n.t('menu:api.saved')}`))
  console.log(ansis.gray(`    ${i18n.t('common:configFile')}: ${settingsPath}`))
}

// ═══════════════════════════════════════════════════════
// Output Style Configuration
// ═══════════════════════════════════════════════════════

const OUTPUT_STYLES = [
  { id: 'default', nameKey: 'menu:style.default', descKey: 'menu:style.defaultDesc' },
  { id: 'engineer-professional', nameKey: 'menu:style.engineerPro', descKey: 'menu:style.engineerProDesc' },
  { id: 'nekomata-engineer', nameKey: 'menu:style.nekomata', descKey: 'menu:style.nekomataDesc' },
  { id: 'laowang-engineer', nameKey: 'menu:style.laowang', descKey: 'menu:style.laowangDesc' },
  { id: 'ojousama-engineer', nameKey: 'menu:style.ojousama', descKey: 'menu:style.ojousamaDesc' },
  { id: 'abyss-cultivator', nameKey: 'menu:style.abyss', descKey: 'menu:style.abyssDesc' },
  { id: 'abyss-concise', nameKey: 'menu:style.abyssConcise', descKey: 'menu:style.abyssConciseDesc' },
  { id: 'abyss-command', nameKey: 'menu:style.abyssCommand', descKey: 'menu:style.abyssCommandDesc' },
  { id: 'abyss-ritual', nameKey: 'menu:style.abyssRitual', descKey: 'menu:style.abyssRitualDesc' },
]

// ═══════════════════════════════════════════════════════
// Model Routing Configuration
// ═══════════════════════════════════════════════════════

async function configModelRouting(): Promise<void> {
  const config = await readCcgConfig()
  const isZh = (config?.general?.language || 'zh-CN') === 'zh-CN'

  console.log()
  console.log(ansis.cyan.bold(`  ${i18n.t('init:model.title')}`))
  console.log()

  // Show current routing
  const currentFrontend = config?.routing?.frontend?.primary || 'antigravity'
  const currentBackend = config?.routing?.backend?.primary || 'codex'
  const currentGeminiModel = config?.routing?.geminiModel || 'gemini-3.1-pro-preview'
  const currentGrokModel = config?.routing?.grokModel || 'grok-4.5'
  const currentKimiModel = config?.routing?.kimiModel || ''

  console.log(ansis.gray(`  ${i18n.t('init:model.currentRouting')}:`))
  console.log(`  ${ansis.cyan('Frontend:')} ${ansis.green(currentFrontend)}`)
  console.log(`  ${ansis.cyan('Backend:')}  ${ansis.blue(currentBackend)}`)
  if (currentFrontend === 'gemini' || currentBackend === 'gemini') {
    console.log(`  ${ansis.cyan('Gemini:')}   ${ansis.gray(currentGeminiModel)}`)
  }
  if (currentFrontend === 'grok' || currentBackend === 'grok') {
    console.log(`  ${ansis.cyan('Grok:')}     ${ansis.gray(currentGrokModel)}`)
  }
  console.log()

  // Frontend model selection
  const { selectedFrontend } = await inquirer.prompt([{
    type: 'list',
    name: 'selectedFrontend',
    message: i18n.t('init:model.selectFrontend'),
    choices: [
      { name: `Antigravity ${ansis.green(`(${i18n.t('init:model.recommended')})`)}`, value: 'antigravity' },
      { name: 'Grok', value: 'grok' },
      { name: 'Kimi', value: 'kimi' },
      { name: 'Codex', value: 'codex' },
      { name: 'OpenCode', value: 'opencode' },
      { name: `Claude Code ${ansis.cyan(`(${i18n.t('init:model.agentTeams')})`)}`, value: 'claude' },
      { name: `Gemini ${ansis.gray(`(${i18n.t('init:model.deprecated')})`)}`, value: 'gemini' },
    ],
    default: currentFrontend,
  }])

  // Backend model selection
  const { selectedBackend } = await inquirer.prompt([{
    type: 'list',
    name: 'selectedBackend',
    message: i18n.t('init:model.selectBackend'),
    choices: [
      { name: `Codex ${ansis.green(`(${i18n.t('init:model.recommended')})`)}`, value: 'codex' },
      { name: 'Grok', value: 'grok' },
      { name: 'Kimi', value: 'kimi' },
      { name: 'Antigravity', value: 'antigravity' },
      { name: 'OpenCode', value: 'opencode' },
      { name: `Claude Code ${ansis.cyan(`(${i18n.t('init:model.agentTeams')})`)}`, value: 'claude' },
      { name: `Gemini ${ansis.gray(`(${i18n.t('init:model.deprecated')})`)}`, value: 'gemini' },
    ],
    default: currentBackend,
  }])

  // Gemini model name (if gemini is selected for any role)
  let geminiModel = currentGeminiModel
  if (selectedFrontend === 'gemini' || selectedBackend === 'gemini') {
    const { selectedGeminiModel } = await inquirer.prompt([{
      type: 'list',
      name: 'selectedGeminiModel',
      message: i18n.t('init:model.selectGeminiModel'),
      choices: [
        { name: `gemini-3.1-pro-preview ${ansis.green(`(${i18n.t('init:model.recommended')})`)}`, value: 'gemini-3.1-pro-preview' },
        { name: 'gemini-2.5-flash', value: 'gemini-2.5-flash' },
        { name: `${i18n.t('init:model.custom')}`, value: 'custom' },
      ],
      default: currentGeminiModel,
    }])

    if (selectedGeminiModel === 'custom') {
      const { customModel } = await inquirer.prompt([{
        type: 'input',
        name: 'customModel',
        message: i18n.t('init:model.enterCustomModel'),
        validate: (v: string) => v.trim() !== '' || i18n.t('init:model.enterCustomModel'),
      }])
      geminiModel = customModel.trim()
    }
    else {
      geminiModel = selectedGeminiModel
    }
  }

  // Grok model name (if grok is selected for any role)
  let grokModel = currentGrokModel
  if (selectedFrontend === 'grok' || selectedBackend === 'grok') {
    const { selectedGrokModel } = await inquirer.prompt([{
      type: 'list',
      name: 'selectedGrokModel',
      message: i18n.t('init:model.selectGrokModel'),
      choices: [
        { name: `grok-4.5 ${ansis.green(`(${i18n.t('init:model.recommended')})`)}`, value: 'grok-4.5' },
        { name: 'grok-composer-2.5-fast', value: 'grok-composer-2.5-fast' },
        { name: `${i18n.t('init:model.custom')}`, value: 'custom' },
      ],
      default: currentGrokModel,
    }])

    if (selectedGrokModel === 'custom') {
      const { customModel } = await inquirer.prompt([{
        type: 'input',
        name: 'customModel',
        message: i18n.t('init:model.enterCustomModel'),
        validate: (v: string) => v.trim() !== '' || i18n.t('init:model.enterCustomModel'),
      }])
      grokModel = customModel.trim()
    }
    else {
      grokModel = selectedGrokModel
    }
  }

  // Check if anything changed
  if (selectedFrontend === currentFrontend && selectedBackend === currentBackend && geminiModel === currentGeminiModel && grokModel === currentGrokModel) {
    console.log(ansis.gray(`  ${i18n.t('common:configNotModified')}`))
    return
  }

  // Update config.toml
  if (config) {
    config.routing.frontend = {
      models: [selectedFrontend as any],
      primary: selectedFrontend as any,
      strategy: 'fallback',
    }
    config.routing.backend = {
      models: [selectedBackend as any],
      primary: selectedBackend as any,
      strategy: 'fallback',
    }
    config.routing.review = {
      models: [...new Set([selectedFrontend, selectedBackend])] as any,
      strategy: 'parallel',
    }
    config.routing.geminiModel = geminiModel
    config.routing.grokModel = grokModel
    config.routing.kimiModel = currentKimiModel
    await writeCcgConfig(config)
  }

  console.log()
  console.log(ansis.green(`  ✓ ${i18n.t('init:model.routingUpdated')}`))

  // Reinstall templates with new config
  const spinner = ora(i18n.t('init:model.reinstalling')).start()
  try {
    const { execSync } = await import('node:child_process')
    execSync('npx --yes ccg-workflow init --force --skip-prompt --skip-mcp', {
      timeout: 300000,
      stdio: 'pipe',
      env: { ...process.env, CCG_UPDATE_MODE: 'true' },
    })
    spinner.succeed(i18n.t('init:model.reinstallDone'))
  }
  catch {
    spinner.fail(i18n.t('init:model.reinstallFailed'))
  }

  console.log(ansis.gray(`  ${i18n.t('common:restartToApply')}`))
}

async function configOutputStyle(): Promise<void> {
  console.log()
  console.log(ansis.cyan.bold(`  ${i18n.t('menu:style.title')}`))
  console.log()

  const settingsPath = join(homedir(), '.claude', 'settings.json')
  let settings: Record<string, any> = {}
  if (await fs.pathExists(settingsPath)) {
    settings = await fs.readJson(settingsPath)
  }

  const currentStyle = settings.outputStyle || 'default'
  console.log(ansis.gray(`  ${i18n.t('menu:style.currentStyle')}: ${currentStyle}`))
  console.log()

  const { style } = await inquirer.prompt([{
    type: 'list',
    name: 'style',
    message: i18n.t('menu:style.selectStyle'),
    choices: OUTPUT_STYLES.map(s => ({
      name: `${i18n.t(s.nameKey)} ${ansis.gray(`- ${i18n.t(s.descKey)}`)}`,
      value: s.id,
    })),
    default: currentStyle,
  }])

  if (style === currentStyle) {
    console.log(ansis.gray(i18n.t('menu:style.notChanged')))
    return
  }

  // Copy style file if not default
  if (style !== 'default') {
    const outputStylesDir = join(homedir(), '.claude', 'output-styles')
    await fs.ensureDir(outputStylesDir)

    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)
    let pkgRoot = dirname(dirname(__dirname))
    if (!await fs.pathExists(join(pkgRoot, 'templates'))) {
      pkgRoot = dirname(pkgRoot)
    }
    const templatePath = join(pkgRoot, 'templates', 'output-styles', `${style}.md`)
    const destPath = join(outputStylesDir, `${style}.md`)

    if (await fs.pathExists(templatePath)) {
      await fs.copy(templatePath, destPath)
      console.log(ansis.green(`  ✓ ${i18n.t('menu:style.installed', { style })}`))
    }
  }

  // Update settings.json
  if (style === 'default') {
    delete settings.outputStyle
  }
  else {
    settings.outputStyle = style
  }

  await fs.writeJson(settingsPath, settings, { spaces: 2 })

  console.log()
  console.log(ansis.green(`  ✓ ${i18n.t('menu:style.set', { style })}`))
  console.log(ansis.gray(`    ${i18n.t('common:restartToApply')}`))
}

// ═══════════════════════════════════════════════════════
// Install Claude Code
// ═══════════════════════════════════════════════════════

async function handleCodexMode(): Promise<void> {
  const isZh = i18n.language === 'zh-CN'
  console.log()
  console.log(ansis.cyan.bold(isZh ? '  Codex 多模型编排模式' : '  Codex Multi-Model Orchestration Mode'))
  console.log()

  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: isZh ? '选择操作' : 'Select action',
    choices: [
      { name: isZh ? '安装 / 更新 Codex 模式' : 'Install / Update Codex Mode', value: 'install' },
      { name: isZh ? '卸载 Codex 模式（只删 CCG 文件，保留用户配置）' : 'Uninstall Codex Mode (CCG files only, preserves user config)', value: 'uninstall' },
      { name: isZh ? '返回' : 'Back', value: 'back' },
    ],
  }])

  if (action === 'back') return

  if (action === 'uninstall') {
    const spinner = ora(isZh ? '卸载 Codex 模式...' : 'Uninstalling Codex mode...').start()
    const result = await uninstallCodexMode()
    if (result.success) {
      spinner.succeed(isZh ? 'Codex 模式已卸载' : 'Codex mode uninstalled')
      if (result.removed.length > 0) {
        console.log()
        for (const f of result.removed) {
          console.log(`  ${ansis.red('✗')} ${f}`)
        }
      }
      if (result.skipped.length > 0) {
        console.log()
        for (const f of result.skipped) {
          console.log(`  ${ansis.gray('○')} ${f}`)
        }
      }
    }
    else {
      spinner.fail(isZh ? '卸载失败' : 'Uninstall failed')
    }
    return
  }

  // Install
  console.log(isZh
    ? '  安装 CCG Codex 模式到 ~/.codex/，让 Codex CLI 作为主导者编排多模型。'
    : '  Install CCG Codex mode to ~/.codex/, enabling Codex CLI as lead orchestrator.',
  )
  console.log()
  console.log(isZh ? '  将安装:' : '  Will install:')
  console.log('    ~/.codex/AGENTS.md              — orchestration instructions')
  console.log('    ~/.codex/config.toml             — multi-agent + timeout config')
  console.log('    ~/.codex/hooks.json + hooks/     — adaptive guardrail hook')
  console.log('    ~/.codex/agents/ccg-*.toml       — sub-agent definitions')
  console.log()

  const { confirm } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirm',
    message: isZh ? '确认安装？' : 'Confirm install?',
    default: true,
  }])

  if (!confirm) return

  const spinner = ora(isZh ? '安装 Codex 模式...' : 'Installing Codex mode...').start()
  const result = await installCodexMode()
  if (result.success) {
    spinner.succeed(isZh ? 'Codex 模式安装完成' : 'Codex mode installed')
    console.log()
    console.log(ansis.green(result.message))
    console.log()
    console.log(ansis.yellow(isZh
      ? '  使用方法: 在项目目录运行 codex，AGENTS.md 会自动生效'
      : '  Usage: run codex in your project directory, AGENTS.md takes effect automatically',
    ))
  }
  else {
    spinner.fail(result.message)
  }
}

// ═══════════════════════════════════════════════════════

async function handleInstallClaude(): Promise<void> {
  console.log()
  console.log(ansis.cyan.bold(`  ${i18n.t('menu:claude.title')}`))
  console.log()

  // Check if already installed
  let isInstalled = false
  try {
    await execAsync('claude --version', { timeout: 5000 })
    isInstalled = true
  }
  catch {
    isInstalled = false
  }

  if (isInstalled) {
    console.log(ansis.yellow(`  ⚠ ${i18n.t('menu:claude.alreadyInstalled')}`))
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: i18n.t('menu:claude.reinstallPrompt'),
      default: false,
    }])

    if (!confirm) {
      console.log(ansis.gray(`  ${i18n.t('common:cancelled')}`))
      return
    }

    // Uninstall
    console.log()
    console.log(ansis.yellow(`  ⏳ ${i18n.t('menu:claude.uninstalling')}`))
    try {
      const uninstallCmd = isWindows() ? 'npm uninstall -g @anthropic-ai/claude-code' : 'sudo npm uninstall -g @anthropic-ai/claude-code'
      await execAsync(uninstallCmd, { timeout: 60000 })
      console.log(ansis.green(`  ✓ ${i18n.t('menu:claude.uninstallSuccess')}`))
    }
    catch (e) {
      console.log(ansis.red(`  ✗ ${i18n.t('menu:claude.uninstallFailed', { error: String(e) })}`))
      return
    }
  }

  // Select installation method
  const isMac = process.platform === 'darwin'
  const isLinux = process.platform === 'linux'

  const { method } = await inquirer.prompt([{
    type: 'list',
    name: 'method',
    message: i18n.t('menu:claude.selectMethod'),
    choices: [
      { name: `npm ${ansis.green('(⭐)')} ${ansis.gray('- npm install -g')}`, value: 'npm' },
      ...((isMac || isLinux) ? [{ name: `homebrew ${ansis.gray('- brew install')}`, value: 'homebrew' }] : []),
      ...((isMac || isLinux) ? [{ name: `curl ${ansis.gray('- official script')}`, value: 'curl' }] : []),
      ...(isWindows() ? [
        { name: `powershell ${ansis.gray('- Windows official')}`, value: 'powershell' },
        { name: `cmd ${ansis.gray('- Command Prompt')}`, value: 'cmd' },
      ] : []),
      new inquirer.Separator(),
      { name: `${ansis.gray(i18n.t('common:cancel'))}`, value: 'cancel' },
    ],
  }])

  if (method === 'cancel')
    return

  console.log()
  console.log(ansis.yellow(`  ⏳ ${i18n.t('menu:claude.installing')}`))

  try {
    if (method === 'npm') {
      const installCmd = isWindows() ? 'npm install -g @anthropic-ai/claude-code' : 'sudo npm install -g @anthropic-ai/claude-code'
      await execAsync(installCmd, { timeout: 300000 })
    }
    else if (method === 'homebrew') {
      await execAsync('brew install --cask claude-code', { timeout: 300000 })
    }
    else if (method === 'curl') {
      await execAsync('curl -fsSL https://claude.ai/install.sh | bash', { timeout: 300000 })
    }
    else if (method === 'powershell') {
      await execAsync('powershell -Command "irm https://claude.ai/install.ps1 | iex"', { timeout: 300000 })
    }
    else if (method === 'cmd') {
      await execAsync('cmd /c "curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd"', { timeout: 300000 })
    }

    console.log(ansis.green(`  ✓ ${i18n.t('menu:claude.installSuccess')}`))
    console.log()
    console.log(ansis.cyan(`  💡 ${i18n.t('menu:claude.runHint')}`))
  }
  catch (e) {
    console.log(ansis.red(`  ✗ ${i18n.t('menu:claude.installFailed', { error: String(e) })}`))
  }
}

// ═══════════════════════════════════════════════════════
// Uninstall
// ═══════════════════════════════════════════════════════

/**
 * Check if CCG is installed globally via npm
 */
async function checkIfGlobalInstall(): Promise<boolean> {
  try {
    const { stdout } = await execAsync('npm list -g ccg-workflow --depth=0', { timeout: 5000 })
    return stdout.includes('ccg-workflow@')
  }
  catch {
    return false
  }
}

async function uninstall(): Promise<void> {
  console.log()

  // Check if installed globally via npm
  const isGlobalInstall = await checkIfGlobalInstall()

  if (isGlobalInstall) {
    console.log(ansis.yellow(`  ⚠️  ${i18n.t('menu:uninstall.globalDetected')}`))
    console.log()
    console.log(`  ${i18n.t('menu:uninstall.twoSteps')}`)
    console.log(`    ${ansis.cyan(`1. ${i18n.t('menu:uninstall.step1')}`)} ${ansis.gray(`(${i18n.t('menu:uninstall.step1Hint')})`)}`)
    console.log(`    ${ansis.cyan(`2. ${i18n.t('menu:uninstall.step2')}`)} ${ansis.gray(`(${i18n.t('menu:uninstall.step2Hint')})`)}`)
    console.log()
  }

  // Confirm uninstall
  const { confirm } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirm',
    message: isGlobalInstall ? i18n.t('menu:uninstall.continuePrompt') : i18n.t('menu:uninstall.confirm'),
    default: false,
  }])

  if (!confirm) {
    console.log(ansis.gray(`  ${i18n.t('menu:uninstall.cancelled')}`))
    return
  }

  console.log()
  console.log(ansis.yellow(`  ${i18n.t('menu:uninstall.uninstalling')}`))

  // Uninstall workflows
  const installDir = join(homedir(), '.claude')
  const result = await uninstallWorkflows(installDir)

  if (result.success) {
    console.log(ansis.green(`  ✅ ${i18n.t('menu:uninstall.success')}`))

    if (result.removedCommands.length > 0) {
      console.log()
      console.log(ansis.cyan(`  ${i18n.t('menu:uninstall.removedCommands')}`))
      for (const cmd of result.removedCommands) {
        console.log(`    ${ansis.gray('•')} /ccg:${cmd}`)
      }
    }

    if (result.removedAgents.length > 0) {
      console.log()
      console.log(ansis.cyan(`  ${i18n.t('menu:uninstall.removedAgents')}`))
      for (const agent of result.removedAgents) {
        console.log(`    ${ansis.gray('•')} ${agent}`)
      }
    }

    if (result.removedSkills.length > 0) {
      console.log()
      console.log(ansis.cyan(`  ${i18n.t('menu:uninstall.removedSkills')}`))
      console.log(`    ${ansis.gray('•')} multi-model-collaboration`)
    }

    if (result.removedBin) {
      console.log()
      console.log(ansis.cyan(`  ${i18n.t('menu:uninstall.removedBin')}`))
      console.log(`    ${ansis.gray('•')} codeagent-wrapper`)
    }

    // If globally installed, show instructions to uninstall npm package
    if (isGlobalInstall) {
      console.log()
      console.log(ansis.yellow.bold(`  🔸 ${i18n.t('menu:uninstall.lastStep')}`))
      console.log()
      console.log(`  ${i18n.t('menu:uninstall.runInNewTerminal')}`)
      console.log()
      console.log(ansis.cyan.bold('    npm uninstall -g ccg-workflow'))
      console.log()
      console.log(ansis.gray(`  (${i18n.t('menu:uninstall.afterDone')})`))
    }
  }
  else {
    console.log(ansis.red(`  ${i18n.t('menu:uninstall.failed')}`))
    for (const error of result.errors) {
      console.log(ansis.red(`    ${error}`))
    }
  }

  console.log()
}

// ═══════════════════════════════════════════════════════
// Tools
// ═══════════════════════════════════════════════════════

async function handleTools(): Promise<void> {
  console.log()

  const { tool } = await inquirer.prompt([{
    type: 'list',
    name: 'tool',
    message: i18n.t('menu:tools.title'),
    choices: [
      { name: `${ansis.green('📊')} ccusage        ${ansis.gray(`${i18n.t('menu:tools.ccusage')}`)}`, value: 'ccusage' },
      { name: `${ansis.blue('📟')} CCometixLine   ${ansis.gray(`${i18n.t('menu:tools.ccline')}`)}`, value: 'ccline' },
      new inquirer.Separator(),
      { name: `${ansis.gray(`← ${i18n.t('common:back')}`)}`, value: 'cancel' },
    ],
  }])

  if (tool === 'cancel')
    return

  if (tool === 'ccusage') {
    await runCcusage()
  }
  else if (tool === 'ccline') {
    await handleCCometixLine()
  }
}

async function runCcusage(): Promise<void> {
  console.log()
  console.log(ansis.cyan(`  📊 ${i18n.t('menu:tools.runningCcusage')}`))
  console.log(ansis.gray('  $ npx ccusage@latest'))
  console.log()

  return new Promise((resolve) => {
    const child = spawn('npx', ['ccusage@latest'], {
      stdio: 'inherit',
      shell: true,
    })
    child.on('close', () => resolve())
    child.on('error', () => resolve())
  })
}

async function handleCCometixLine(): Promise<void> {
  console.log()

  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: i18n.t('menu:tools.cclineAction'),
    choices: [
      { name: `${ansis.green('➜')} ${i18n.t('menu:tools.cclineInstall')}`, value: 'install' },
      { name: `${ansis.red('✕')} ${i18n.t('menu:tools.cclineUninstall')}`, value: 'uninstall' },
      new inquirer.Separator(),
      { name: `${ansis.gray(`← ${i18n.t('common:back')}`)}`, value: 'cancel' },
    ],
  }])

  if (action === 'cancel')
    return

  if (action === 'install') {
    await installCCometixLine()
  }
  else if (action === 'uninstall') {
    await uninstallCCometixLine()
  }
}

async function installCCometixLine(): Promise<void> {
  console.log()
  console.log(ansis.yellow(`  ⏳ ${i18n.t('menu:tools.cclineInstalling')}`))

  try {
    const installCmd = isWindows() ? 'npm install -g @cometix/ccline' : 'sudo npm install -g @cometix/ccline'
    await execAsync(installCmd, { timeout: 120000 })
    console.log(ansis.green(`  ✓ ${i18n.t('menu:tools.cclineInstallSuccess')}`))

    const settingsPath = join(homedir(), '.claude', 'settings.json')
    let settings: Record<string, any> = {}

    if (await fs.pathExists(settingsPath)) {
      settings = await fs.readJson(settingsPath)
    }

    settings.statusLine = {
      type: 'command',
      command: isWindows()
        ? '~/.claude/ccline/ccline.exe'
        : '~/.claude/ccline/ccline',
      padding: 0,
    }

    await fs.ensureDir(join(homedir(), '.claude'))
    await fs.writeJson(settingsPath, settings, { spaces: 2 })
    console.log(ansis.green(`  ✓ ${i18n.t('menu:tools.cclineConfigured')}`))

    console.log()
    console.log(ansis.cyan(`  💡 ${i18n.t('common:restartToApply')}`))
  }
  catch (error) {
    console.log(ansis.red(`  ✗ ${i18n.t('menu:tools.cclineInstallFailed', { error: String(error) })}`))
  }
}

async function uninstallCCometixLine(): Promise<void> {
  console.log()
  console.log(ansis.yellow(`  ⏳ ${i18n.t('menu:tools.cclineUninstalling')}`))

  try {
    const settingsPath = join(homedir(), '.claude', 'settings.json')
    if (await fs.pathExists(settingsPath)) {
      const settings = await fs.readJson(settingsPath)
      delete settings.statusLine
      await fs.writeJson(settingsPath, settings, { spaces: 2 })
      console.log(ansis.green(`  ✓ ${i18n.t('menu:tools.cclineConfigRemoved')}`))
    }

    const uninstallCmd = isWindows() ? 'npm uninstall -g @cometix/ccline' : 'sudo npm uninstall -g @cometix/ccline'
    await execAsync(uninstallCmd, { timeout: 60000 })
    console.log(ansis.green(`  ✓ ${i18n.t('menu:tools.cclineUninstalled')}`))
  }
  catch (error) {
    console.log(ansis.red(`  ✗ ${i18n.t('menu:tools.cclineUninstallFailed', { error: String(error) })}`))
  }
}
