import type { CollaborationMode, InitOptions, ModelRouting, ModelType, SupportedLang } from '../types'
import ansis from 'ansis'
import fs from 'fs-extra'
import inquirer from 'inquirer'
import ora from 'ora'
import { homedir } from 'node:os'
import { join } from 'pathe'
import { i18n, initI18n } from '../i18n'
import { createDefaultConfig, ensureCcgDir, getCcgDir, readCcgConfig, writeCcgConfig } from '../utils/config'
import { configureApiMartForCodex, configureGeminiCliApi, getAllCommandIds, getCoreCommandIds, installAceTool, installAceToolRs, installContextWeaver, installFastContext, installMcpServer, installWorkflows, showBinaryDownloadWarning, syncMcpToCodex, syncMcpToGemini, writeFastContextPrompt } from '../utils/installer'
import { isWindows } from '../utils/platform'
import { migrateToV1_4_0, needsMigration } from '../utils/migration'

/**
 * Auto-approve codeagent-wrapper Bash commands in settings.json.
 *
 * All platforms use permissions.allow with wildcard pattern (v1.7.89+).
 * Old Hook-based approach and old permission entries are automatically cleaned up.
 */
async function installHook(settingsPath: string): Promise<'permission'> {
  let settings: Record<string, any> = {}
  if (await fs.pathExists(settingsPath)) {
    settings = await fs.readJSON(settingsPath)
  }

  // ── All platforms: permissions.allow approach (v1.7.89+) ──

  // Remove old Hook if it exists (migration from ≤v1.7.88)
  if (settings.hooks?.PreToolUse) {
    const hookIdx = settings.hooks.PreToolUse.findIndex(
      (h: any) => h.matcher === 'Bash' && h.hooks?.some((hh: any) => hh.command?.includes('codeagent-wrapper')),
    )
    if (hookIdx >= 0) {
      settings.hooks.PreToolUse.splice(hookIdx, 1)
      // Clean up empty arrays/objects
      if (settings.hooks.PreToolUse.length === 0)
        delete settings.hooks.PreToolUse
      if (settings.hooks && Object.keys(settings.hooks).length === 0)
        delete settings.hooks
    }
  }

  // Remove old permission entry without leading wildcard (migration from ≤v1.7.88)
  if (settings.permissions?.allow) {
    const oldEntry = 'Bash(codeagent-wrapper*)'
    const oldIdx = settings.permissions.allow.indexOf(oldEntry)
    if (oldIdx >= 0) {
      settings.permissions.allow.splice(oldIdx, 1)
    }
  }

  // Add permissions.allow entry
  if (!settings.permissions)
    settings.permissions = {}
  if (!settings.permissions.allow)
    settings.permissions.allow = []

  const permEntry = 'Bash(*codeagent-wrapper*)'
  if (!settings.permissions.allow.includes(permEntry)) {
    settings.permissions.allow.push(permEntry)
  }

  await fs.writeJSON(settingsPath, settings, { spaces: 2 })
  return 'permission'
}

/**
 * Write grok-search global prompt to ~/.claude/rules/ccg-grok-search.md
 * Uses rules/ directory for modularity — avoids bloating CLAUDE.md
 */
async function appendGrokSearchPrompt(): Promise<void> {
  const rulesDir = join(homedir(), '.claude', 'rules')
  const rulePath = join(rulesDir, 'ccg-grok-search.md')

  // Also clean up legacy CLAUDE.md injection if present
  const claudeMdPath = join(homedir(), '.claude', 'CLAUDE.md')
  if (await fs.pathExists(claudeMdPath)) {
    const content = await fs.readFile(claudeMdPath, 'utf-8')
    if (content.includes('CCG-GROK-SEARCH-PROMPT')) {
      const cleaned = content.replace(/\n*<!-- CCG-GROK-SEARCH-PROMPT-START -->[\s\S]*?<!-- CCG-GROK-SEARCH-PROMPT-END -->\n*/g, '')
      await fs.writeFile(claudeMdPath, cleaned, 'utf-8')
    }
  }

  const prompt = `## 0. Language and Format Standards

- **Interaction Language**: Tools and models must interact exclusively in **English**; user outputs must be in **Chinese**.
- MUST ULRTA Thinking in ENGLISH!
- **Formatting Requirements**: Use standard Markdown formatting. Code blocks and specific text results should be marked with backticks. Skilled in applying four or more \`\`\`\`markdown wrappers.

## 1. Search and Evidence Standards
Typically, the results of web searches only constitute third-party suggestions and are not directly credible; they must be cross-verified with sources to provide users with absolutely authoritative and correct answers.

### Search Trigger Conditions
Strictly distinguish between internal and external knowledge. Avoid speculation based on general internal knowledge. When uncertain, explicitly inform the user.

For example, when using the \`fastapi\` library to encapsulate an API endpoint, despite possessing common-sense knowledge internally, you must still rely on the latest search results or official documentation for reliable implementation.

### Search Execution Guidelines

- Use the \`mcp__grok-search\` tool for web searches
- Execute independent search requests in parallel; sequential execution applies only when dependencies exist
- Evaluate search results for quality: analyze relevance, source credibility, cross-source consistency, and completeness. Conduct supplementary searches if gaps exist

### Source Quality Standards

- Key factual claims must be supported by >=2 independent sources. If relying on a single source, explicitly state this limitation
- Conflicting sources: Present evidence from both sides, assess credibility and timeliness, identify the stronger evidence, or declare unresolved discrepancies
- Empirical conclusions must include confidence levels (High/Medium/Low)
- Citation format: [Author/Organization, Year/Date, Section/URL]. Fabricated references are strictly prohibited

## 2. Reasoning and Expression Principles

- Be concise, direct, and information-dense: Use lists for discrete items; paragraphs for arguments
- Challenge flawed premises: When user logic contains errors, pinpoint specific issues with evidence
- All conclusions must specify: Applicable conditions, scope boundaries, and known limitations
- Avoid greetings, pleasantries, filler adjectives, and emotional expressions
- When uncertain: State unknowns and reasons before presenting confirmed facts
`

  await fs.ensureDir(rulesDir)
  await fs.writeFile(rulePath, prompt, 'utf-8')
}

// ═══════════════════════════════════════════════════════
// Interactive step state machine (v2.1.16+)
// ═══════════════════════════════════════════════════════
// Each step's first list prompt includes sentinel choices for
// "← back" (step 2+) and "× cancel". Users can also jump to any
// step from the final summary page.

type StepId = 'api' | 'model' | 'mcp' | 'perf'
type StepReturn = 'next' | 'back' | 'cancel'
type SummaryAction = 'confirm' | 'cancel' | StepId

// Sentinel values injected into list choices for navigation.
const BACK_SENTINEL = '__ccg_back__'
const CANCEL_SENTINEL = '__ccg_cancel__'

/**
 * Build navigation sentinels to append to a step's first list prompt.
 * Always includes cancel; includes back only when canGoBack is true.
 */
function navSentinels(canGoBack: boolean): any[] {
  const items: any[] = [new inquirer.Separator()]
  if (canGoBack) {
    items.push({
      name: `${ansis.cyan('←')} ${i18n.t('init:nav.back')}`,
      value: BACK_SENTINEL,
    })
  }
  items.push({
    name: `${ansis.red('×')} ${i18n.t('init:nav.cancel')}`,
    value: CANCEL_SENTINEL,
  })
  return items
}

/**
 * Install grok-search MCP server
 */
async function installGrokSearchMcp(keys: {
  tavilyKey?: string
  firecrawlKey?: string
  grokApiUrl?: string
  grokApiKey?: string
}): Promise<{ success: boolean, message: string }> {
  const env: Record<string, string> = {}
  if (keys.tavilyKey)
    env.TAVILY_API_KEY = keys.tavilyKey
  if (keys.firecrawlKey)
    env.FIRECRAWL_API_KEY = keys.firecrawlKey
  if (keys.grokApiUrl)
    env.GROK_API_URL = keys.grokApiUrl
  if (keys.grokApiKey)
    env.GROK_API_KEY = keys.grokApiKey

  return installMcpServer(
    'grok-search',
    'uvx',
    ['--from', 'git+https://github.com/GuDaStudio/GrokSearch@grok-with-tavily', 'grok-search'],
    env,
  )
}

export async function init(options: InitOptions = {}): Promise<void> {
  console.log()
  console.log(ansis.cyan.bold(`  CCG - Claude + Codex + Gemini`))
  console.log(ansis.gray(`  Multi-Model Collaboration Workflow`))
  console.log()

  // ═══════════════════════════════════════════════════════
  // Step 0: Language selection (FIRST interactive step)
  // ═══════════════════════════════════════════════════════
  let language: SupportedLang = 'zh-CN'

  if (!options.skipPrompt) {
    // Check if user already has a language preference
    const existingConfig = await readCcgConfig()
    const savedLang = existingConfig?.general?.language

    if (savedLang) {
      // Use saved language
      language = savedLang
      await initI18n(language)
    }
    else {
      // First time user: ask for language
      const { selectedLang } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedLang',
        message: '选择语言 / Select language',
        choices: [
          { name: `简体中文`, value: 'zh-CN' },
          { name: `English`, value: 'en' },
        ],
        default: 'zh-CN',
      }])
      language = selectedLang
      await initI18n(language)
    }
  }
  else if (options.lang) {
    language = options.lang
    await initI18n(language)
  }

  // Model routing configuration (user-selectable since v2.1.0)
  let frontendModels: ModelType[] = ['antigravity']
  let backendModels: ModelType[] = ['codex']
  let geminiModel = 'gemini-3.1-pro-preview'
  let grokModel = 'grok-4.5'
  let kimiModel = ''
  const mode: CollaborationMode = 'smart'
  let selectedWorkflows = getCoreCommandIds()
  let installMode: 'v3' | 'legacy' = 'v3'

  // Non-interactive mode: preserve existing config
  if (options.skipPrompt) {
    const existingConfig = await readCcgConfig()
    if (existingConfig?.routing) {
      frontendModels = existingConfig.routing.frontend?.models || ['antigravity']
      backendModels = existingConfig.routing.backend?.models || ['codex']
      geminiModel = existingConfig.routing.geminiModel || 'gemini-3.1-pro-preview'
      grokModel = existingConfig.routing.grokModel || 'grok-4.5'
      kimiModel = existingConfig.routing.kimiModel || ''
    }
    // Preserve install mode: if existing install has legacy commands, keep them
    if (existingConfig?.workflows?.installed) {
      const hadLegacy = existingConfig.workflows.installed.some(
        (w: string) => ['workflow', 'plan', 'execute', 'frontend', 'backend', 'feat', 'debug', 'team'].includes(w),
      )
      if (hadLegacy) {
        selectedWorkflows = getAllCommandIds()
        installMode = 'legacy'
      }
    }
  }

  // Performance mode selection
  let liteMode = false
  let skipImpeccable = false

  // MCP Tool Selection
  let mcpProvider = 'fast-context'
  let aceToolBaseUrl = ''
  let aceToolToken = ''
  let contextWeaverApiKey = ''
  let fastContextApiKey = ''
  let fastContextIncludeSnippets = false
  let wantFastContext = false

  // Grok Search MCP
  let wantGrokSearch = false
  let wantCodeGraph = false
  let tavilyKey = ''
  let firecrawlKey = ''
  let grokApiUrl = ''
  let grokApiKey = ''

  // Claude Code API configuration
  let apiUrl = ''
  let apiKey = ''
  // APIMart also speaks the OpenAI wire protocol, so it can back Codex CLI too.
  // Applied during the install phase, not mid-step — the step machine allows
  // going back or cancelling, and side effects must not survive that.
  let apimartWireCodex = false
  let apimartActivateCodex = false
  let geminiCliBaseUrl = ''
  let geminiCliKey = ''
  let geminiCliModel = ''

  // ═══════════════════════════════════════════════════════
  // Non-interactive mode (--skip-prompt): preserve existing settings
  // ═══════════════════════════════════════════════════════
  if (options.skipPrompt) {
    const existingConfig = await readCcgConfig()
    if (existingConfig?.performance?.liteMode !== undefined) {
      liteMode = existingConfig.performance.liteMode
    }
    if (existingConfig?.performance?.skipImpeccable !== undefined) {
      skipImpeccable = existingConfig.performance.skipImpeccable
    }
    if (options.skipMcp) {
      // Fix #124: preserve existing MCP provider from config during update
      mcpProvider = existingConfig?.mcp?.provider || 'skip'
    }
  }

  // ═══════════════════════════════════════════════════════
  // Interactive state machine (v2.1.16+)
  //
  // Users can retry/back/cancel at each step, and jump back to any
  // step from the final summary page. Previously they had to Ctrl+C
  // and restart if they mistyped a URL/KEY.
  // ═══════════════════════════════════════════════════════
  if (!options.skipPrompt) {
    const existingConfig = await readCcgConfig()

    // Initialize from existing config so re-running init shows saved values as defaults
    if (existingConfig?.routing) {
      const ef = existingConfig.routing.frontend?.primary
      const eb = existingConfig.routing.backend?.primary
      if (ef)
        frontendModels = [ef]
      if (eb)
        backendModels = [eb]
      if (existingConfig.routing.geminiModel)
        geminiModel = existingConfig.routing.geminiModel
      if (existingConfig.routing.grokModel)
        grokModel = existingConfig.routing.grokModel
      if (existingConfig.routing.kimiModel)
        kimiModel = existingConfig.routing.kimiModel
    }
    if (existingConfig?.performance?.liteMode !== undefined) {
      liteMode = existingConfig.performance.liteMode
    }

    // ── Step runners (closures sharing outer-scope state) ──

    async function runApiStep(canGoBack: boolean): Promise<StepReturn> {
      console.log()
      console.log(ansis.cyan.bold(`  🔑 Step 1/4 — ${i18n.t('init:api.title')}`))
      console.log()

      const { apiProvider } = await inquirer.prompt([{
        type: 'list',
        name: 'apiProvider',
        message: i18n.t('init:api.providerPrompt'),
        choices: [
          { name: `${ansis.green('●')} ${i18n.t('init:api.officialOption')}`, value: 'official' },
          { name: `${ansis.cyan('●')} ${i18n.t('init:api.thirdPartyOption')}`, value: 'thirdparty' },
          { name: `${ansis.yellow('★')} ${i18n.t('init:api.sponsorAPIMart')} ${ansis.gray('— https://go.apimart.ai/gh-ccg-workflow')}`, value: 'apimart' },
          { name: `${ansis.gray('○')} ${i18n.t('init:api.skipOption')}`, value: 'skip' },
          ...navSentinels(canGoBack),
        ],
      }])

      if (apiProvider === BACK_SENTINEL)
        return 'back'
      if (apiProvider === CANCEL_SENTINEL)
        return 'cancel'

      // Clear stale values before collecting fresh input
      apiUrl = ''
      apiKey = ''
      apimartWireCodex = false
      apimartActivateCodex = false
      geminiCliBaseUrl = ''
      geminiCliKey = ''
      geminiCliModel = ''

      if (apiProvider === 'apimart') {
        // APIMart serves the native Anthropic Messages protocol at POST /v1/messages,
        // and Claude Code appends /v1/messages to ANTHROPIC_BASE_URL itself — so the
        // base must NOT carry a /v1 suffix (that is the OpenAI-SDK base URL instead).
        apiUrl = 'https://api.apimart.ai'
        console.log()
        console.log(`    ${ansis.yellow('★')} ${i18n.t('init:api.sponsorAPIMartGetKey')}: ${ansis.cyan.underline('https://go.apimart.ai/gh-ccg-workflow')}`)
        console.log()
        const { key } = await inquirer.prompt([{
          type: 'password',
          name: 'key',
          message: `APIMart API Key ${ansis.gray(`(${i18n.t('init:api.keyRequired')})`)}`,
          mask: '*',
          validate: (v: string) => v.trim() !== '' || i18n.t('init:api.enterKey'),
        }])
        apiKey = key?.trim() || ''

        // The same account can also back Codex CLI, which speaks the OpenAI
        // protocol — note its base_url KEEPS the /v1 suffix, unlike above.
        const { wire } = await inquirer.prompt([{
          type: 'confirm',
          name: 'wire',
          message: i18n.t('init:api.apimartCodexPrompt'),
          default: true,
        }])
        apimartWireCodex = wire

        if (apimartWireCodex) {
          // Activation is asked separately and defaults to NO: flipping
          // model_provider reroutes every Codex request off the user's existing
          // subscription onto pay-as-you-go billing. That is not a decision an
          // installer should make quietly on someone's behalf.
          const { activate } = await inquirer.prompt([{
            type: 'confirm',
            name: 'activate',
            message: i18n.t('init:api.apimartCodexActivatePrompt'),
            default: false,
          }])
          apimartActivateCodex = activate
        }
      }
      else if (apiProvider === 'thirdparty') {
        const apiAnswers = await inquirer.prompt([
          {
            type: 'input',
            name: 'url',
            message: `API URL ${ansis.gray(`(${i18n.t('init:api.urlRequired')})`)}`,
            validate: (v: string) => v.trim() !== '' || i18n.t('init:api.enterUrl'),
          },
          {
            type: 'password',
            name: 'key',
            message: `API Key ${ansis.gray(`(${i18n.t('init:api.keyRequired')})`)}`,
            mask: '*',
            validate: (v: string) => v.trim() !== '' || i18n.t('init:api.enterKey'),
          },
        ])
        apiUrl = apiAnswers.url?.trim() || ''
        apiKey = apiAnswers.key?.trim() || ''
      }
      else if (apiProvider === 'skip') {
        console.log()
        console.log(`    ${ansis.gray('○')} ${i18n.t('init:api.skipNoticeTitle')}`)
      }
      // 'official' leaves apiUrl/apiKey empty — will use OAuth login

      // Independent of the Claude Code choice above: users without a Google
      // account can point Gemini CLI at a third-party gateway. Two env vars in
      // ~/.gemini/.env are all it takes — GOOGLE_GEMINI_BASE_URL flips the CLI
      // into gateway auth by itself, no OAuth involved.
      const { wireGeminiCli } = await inquirer.prompt([{
        type: 'confirm',
        name: 'wireGeminiCli',
        message: i18n.t('init:api.geminiCliPrompt'),
        default: false,
      }])
      if (wireGeminiCli) {
        console.log(`    ${ansis.yellow('!')} ${i18n.t('init:api.geminiCliProtocolHint')}`)
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'url',
            message: `${i18n.t('init:api.geminiCliUrlPrompt')} ${ansis.gray(`(${i18n.t('init:api.urlRequired')})`)}`,
            validate: (v: string) => v.trim() !== '' || i18n.t('init:api.enterUrl'),
          },
          {
            type: 'password',
            name: 'key',
            message: `Gemini API Key ${ansis.gray(`(${i18n.t('init:api.keyRequired')})`)}`,
            mask: '*',
            validate: (v: string) => v.trim() !== '' || i18n.t('init:api.enterKey'),
          },
          {
            type: 'input',
            name: 'model',
            message: i18n.t('init:api.geminiCliModelPrompt'),
          },
        ])
        geminiCliBaseUrl = answers.url?.trim() || ''
        geminiCliKey = answers.key?.trim() || ''
        geminiCliModel = answers.model?.trim() || ''
      }
      return 'next'
    }

    async function runModelStep(canGoBack: boolean): Promise<StepReturn> {
      console.log()
      console.log(ansis.cyan.bold(`  🧠 Step 2/4 — ${i18n.t('init:model.title')}`))
      console.log()

      const { selectedFrontend } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedFrontend',
        message: i18n.t('init:model.selectFrontend'),
        choices: [
          { name: `Antigravity ${ansis.green(`(${i18n.t('init:model.recommended')})`)}`, value: 'antigravity' as ModelType },
          { name: 'Grok', value: 'grok' as ModelType },
          { name: 'Kimi', value: 'kimi' as ModelType },
          { name: 'Codex', value: 'codex' as ModelType },
          { name: 'OpenCode', value: 'opencode' as ModelType },
          { name: `Claude Code ${ansis.cyan(`(${i18n.t('init:model.agentTeams')})`)}`, value: 'claude' as ModelType },
          { name: `Gemini ${ansis.gray(`(${i18n.t('init:model.deprecated')})`)}`, value: 'gemini' as ModelType },
          ...navSentinels(canGoBack),
        ],
        default: frontendModels[0] || 'antigravity',
      }])

      if (selectedFrontend === BACK_SENTINEL)
        return 'back'
      if (selectedFrontend === CANCEL_SENTINEL)
        return 'cancel'

      const { selectedBackend } = await inquirer.prompt([{
        type: 'list',
        name: 'selectedBackend',
        message: i18n.t('init:model.selectBackend'),
        choices: [
          { name: `Codex ${ansis.green(`(${i18n.t('init:model.recommended')})`)}`, value: 'codex' as ModelType },
          { name: 'Grok', value: 'grok' as ModelType },
          { name: 'Kimi', value: 'kimi' as ModelType },
          { name: 'Antigravity', value: 'antigravity' as ModelType },
          { name: 'OpenCode', value: 'opencode' as ModelType },
          { name: `Claude Code ${ansis.cyan(`(${i18n.t('init:model.agentTeams')})`)}`, value: 'claude' as ModelType },
          { name: `Gemini ${ansis.gray(`(${i18n.t('init:model.deprecated')})`)}`, value: 'gemini' as ModelType },
        ],
        default: backendModels[0] || 'codex',
      }])

      frontendModels = [selectedFrontend]
      backendModels = [selectedBackend]

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
          default: geminiModel || 'gemini-3.1-pro-preview',
        }])

        if (selectedGeminiModel === 'custom') {
          const { customModel } = await inquirer.prompt([{
            type: 'input',
            name: 'customModel',
            message: i18n.t('init:model.enterCustomModel'),
            default: geminiModel || '',
            validate: (v: string) => v.trim() !== '' || i18n.t('init:model.enterCustomModel'),
          }])
          geminiModel = customModel.trim()
        }
        else {
          geminiModel = selectedGeminiModel
        }
      }

      if (selectedFrontend === 'claude' && selectedBackend === 'claude') {
        console.log()
        console.log(ansis.cyan(`  ${i18n.t('init:model.pureCcNotice')}`))
        console.log()
      }

      if (selectedFrontend === 'kimi' || selectedBackend === 'kimi') {
        const { selectedKimiModel } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedKimiModel',
          message: i18n.t('init:model.selectKimiModel'),
          choices: [
            { name: `${i18n.t('init:model.kimiDefault')} ${ansis.green(`(${i18n.t('init:model.recommended')})`)}`, value: '' },
            { name: `${i18n.t('init:model.custom')}`, value: 'custom' },
          ],
          default: kimiModel || '',
        }])

        if (selectedKimiModel === 'custom') {
          const { customModel } = await inquirer.prompt([{
            type: 'input',
            name: 'customModel',
            message: i18n.t('init:model.enterCustomModel'),
            default: kimiModel || '',
            validate: (v: string) => v.trim() !== '' || i18n.t('init:model.enterCustomModel'),
          }])
          kimiModel = customModel.trim()
        }
        else {
          kimiModel = selectedKimiModel
        }
      }

      if (selectedFrontend === 'grok' || selectedBackend === 'grok') {
        const { selectedGrokModel } = await inquirer.prompt([{
          type: 'list',
          name: 'selectedGrokModel',
          message: i18n.t('init:model.selectGrokModel'),
          choices: [
            { name: `grok-4.5 ${ansis.green(`(${i18n.t('init:model.recommended')})`)} ${ansis.gray('— 500k context')}`, value: 'grok-4.5' },
            { name: `grok-composer-2.5-fast ${ansis.gray('— Cursor Composer, fast coding')}`, value: 'grok-composer-2.5-fast' },
            { name: `${i18n.t('init:model.custom')}`, value: 'custom' },
          ],
          default: grokModel || 'grok-4.5',
        }])

        if (selectedGrokModel === 'custom') {
          const { customModel } = await inquirer.prompt([{
            type: 'input',
            name: 'customModel',
            message: i18n.t('init:model.enterCustomModel'),
            default: grokModel || '',
            validate: (v: string) => v.trim() !== '' || i18n.t('init:model.enterCustomModel'),
          }])
          grokModel = customModel.trim()
        }
        else {
          grokModel = selectedGrokModel
        }
      }
      return 'next'
    }

    async function runMcpStep(canGoBack: boolean): Promise<StepReturn> {
      if (options.skipMcp) {
        mcpProvider = existingConfig?.mcp?.provider || 'skip'
        return 'next'
      }

      console.log()
      console.log(ansis.cyan.bold(`  🔧 Step 3/4 — ${i18n.t('init:mcp.title')}`))
      console.log()

      // Pre-step gate: since the main prompt is a checkbox (can't embed
      // navigation sentinels cleanly), ask a single-choice list first.
      const { gate } = await inquirer.prompt([{
        type: 'list',
        name: 'gate',
        message: i18n.t('init:mcp.gatePrompt'),
        choices: [
          { name: `${ansis.green('●')} ${i18n.t('init:mcp.gateContinue')}`, value: 'continue' },
          ...navSentinels(canGoBack),
        ],
      }])

      if (gate === BACK_SENTINEL)
        return 'back'
      if (gate === CANCEL_SENTINEL)
        return 'cancel'

      // Reset MCP state before re-collecting
      aceToolBaseUrl = ''
      aceToolToken = ''
      fastContextApiKey = ''
      fastContextIncludeSnippets = false
      contextWeaverApiKey = ''
      wantFastContext = false
      wantGrokSearch = false
      wantCodeGraph = false
      tavilyKey = ''
      firecrawlKey = ''
      grokApiUrl = ''
      grokApiKey = ''

      const { selectedTools } = await inquirer.prompt([{
        type: 'checkbox',
        name: 'selectedTools',
        message: i18n.t('init:mcp.selectTools'),
        choices: [
          {
            name: `fast-context ${ansis.green(`(${i18n.t('common:recommended')})`)} ${ansis.gray('— AI 驱动语义搜索')}`,
            value: 'fast-context',
            checked: true,
          },
          {
            name: `ace-tool ${ansis.gray('— search_context 代码检索')}`,
            value: 'ace-tool',
          },
          {
            name: `context7 ${ansis.green('(free)')} ${ansis.gray('— 库文档查询')}`,
            value: 'context7',
            checked: true,
          },
          {
            name: `grok-search ${ansis.gray('— 联网搜索 (需 API Key)')}`,
            value: 'grok-search',
          },
          {
            name: `codegraph ${ansis.gray('— 本地代码知识图谱 (调用链/影响范围/架构)')}`,
            value: 'codegraph',
          },
          {
            name: `contextweaver ${ansis.gray('— 硅基流动嵌入检索 (需 API Key)')}`,
            value: 'contextweaver',
          },
        ],
      }]) as { selectedTools: string[] }

      const hasAceTool = selectedTools.includes('ace-tool')
      const hasFastContext = selectedTools.includes('fast-context')
      const hasContextWeaver = selectedTools.includes('contextweaver')
      const hasCodeGraph = selectedTools.includes('codegraph')
      wantFastContext = hasFastContext
      wantGrokSearch = selectedTools.includes('grok-search')
      wantCodeGraph = hasCodeGraph

      if (hasAceTool) {
        mcpProvider = 'ace-tool'
      }
      else if (hasFastContext) {
        mcpProvider = 'fast-context'
      }
      else if (hasContextWeaver) {
        mcpProvider = 'contextweaver'
      }
      else {
        mcpProvider = 'skip'
      }

      if (hasAceTool) {
        console.log()
        console.log(ansis.cyan.bold(`  🔧 ace-tool MCP`))
        console.log()
        console.log(`     ${ansis.gray('•')} ${ansis.cyan(i18n.t('init:mcp.officialService'))}: ${ansis.underline('https://augmentcode.com/')}`)
        console.log(`     ${ansis.gray('•')} ${ansis.cyan(i18n.t('init:mcp.proxyService'))} ${ansis.yellow(`(${i18n.t('init:mcp.noSignup')})`)}: ${ansis.underline('https://acemcp.heroman.wtf/')}`)
        console.log()

        const aceAnswers = await inquirer.prompt([
          {
            type: 'input',
            name: 'baseUrl',
            message: `Base URL ${ansis.gray(`(${i18n.t('init:mcp.baseUrlHint')})`)}`,
            default: '',
          },
          {
            type: 'password',
            name: 'token',
            message: `Token ${ansis.gray(`(${i18n.t('init:mcp.tokenRequired')})`)}`,
            mask: '*',
            validate: (input: string) => input.trim() !== '' || i18n.t('init:mcp.enterToken'),
          },
        ])
        aceToolBaseUrl = aceAnswers.baseUrl || ''
        aceToolToken = aceAnswers.token || ''
      }

      if (hasFastContext) {
        console.log()
        console.log(ansis.cyan.bold(`  🔧 fast-context MCP`))
        console.log(ansis.gray(`     Windsurf Fast Context — ${i18n.t('init:mcp.fcAutoExtract')}`))
        console.log()

        const fcAnswers = await inquirer.prompt([
          {
            type: 'input',
            name: 'apiKey',
            message: `WINDSURF_API_KEY ${ansis.gray(`(${i18n.t('init:mcp.fcLeaveEmpty')})`)}`,
            default: '',
          },
          {
            type: 'list',
            name: 'includeSnippets',
            message: i18n.t('init:mcp.fcSnippetMode'),
            choices: [
              { name: `${i18n.t('init:mcp.fcPathOnly')} ${ansis.gray(`(${i18n.t('init:mcp.fcSaveToken')})`)}`, value: false },
              { name: i18n.t('init:mcp.fcFullSnippet'), value: true },
            ],
          },
        ])
        fastContextApiKey = fcAnswers.apiKey?.trim() || ''
        fastContextIncludeSnippets = fcAnswers.includeSnippets
      }

      if (hasContextWeaver) {
        console.log()
        console.log(ansis.cyan.bold(`  🔧 ContextWeaver MCP`))
        console.log()
        console.log(`     ${ansis.gray('1.')} ${i18n.t('init:mcp.siliconflowStep1', { url: ansis.underline('https://siliconflow.cn/') })}`)
        console.log(`     ${ansis.gray('2.')} ${i18n.t('init:mcp.siliconflowStep2')}`)
        console.log(`     ${ansis.gray('3.')} ${i18n.t('init:mcp.siliconflowStep3')}`)
        console.log()

        const cwAnswers = await inquirer.prompt([{
          type: 'password',
          name: 'apiKey',
          message: `SiliconFlow API Key ${ansis.gray('(sk-xxx)')}`,
          mask: '*',
          validate: (input: string) => input.trim() !== '' || i18n.t('init:mcp.enterApiKey'),
        }])
        contextWeaverApiKey = cwAnswers.apiKey || ''
      }

      if (wantGrokSearch) {
        console.log()
        console.log(ansis.cyan.bold(`  🔍 grok-search MCP`))
        console.log()
        console.log(`     Tavily: ${ansis.underline('https://www.tavily.com/')} ${ansis.gray(`(${i18n.t('init:grok.tavilyHint')})`)}`)
        console.log(`     Firecrawl: ${ansis.underline('https://www.firecrawl.dev/')} ${ansis.gray(`(${i18n.t('init:grok.firecrawlHint')})`)}`)
        console.log(`     Grok API: ${ansis.gray(i18n.t('init:grok.grokHint'))}`)
        console.log()

        const grokAnswers = await inquirer.prompt([
          { type: 'input', name: 'grokApiUrl', message: `GROK_API_URL ${ansis.gray(`(${i18n.t('init:grok.optional')})`)}`, default: '' },
          { type: 'password', name: 'grokApiKey', message: `GROK_API_KEY ${ansis.gray(`(${i18n.t('init:grok.optional')})`)}`, mask: '*' },
          { type: 'password', name: 'tavilyKey', message: `TAVILY_API_KEY ${ansis.gray(`(${i18n.t('init:grok.optional')})`)}`, mask: '*' },
          { type: 'password', name: 'firecrawlKey', message: `FIRECRAWL_API_KEY ${ansis.gray(`(${i18n.t('init:grok.optional')})`)}`, mask: '*' },
        ])

        tavilyKey = grokAnswers.tavilyKey?.trim() || ''
        firecrawlKey = grokAnswers.firecrawlKey?.trim() || ''
        grokApiUrl = grokAnswers.grokApiUrl?.trim() || ''
        grokApiKey = grokAnswers.grokApiKey?.trim() || ''
      }
      return 'next'
    }

    async function runPerfStep(canGoBack: boolean): Promise<StepReturn> {
      console.log()
      console.log(ansis.cyan.bold(`  ⚡ Step 4/4 — ${i18n.t('init:perf.title')}`))
      console.log()

      const { perfMode } = await inquirer.prompt([{
        type: 'list',
        name: 'perfMode',
        message: i18n.t('init:perf.selectMode'),
        choices: [
          { name: `${ansis.green('●')} ${i18n.t('init:perf.standardOption')}`, value: 'standard' },
          { name: `${ansis.cyan('●')} ${i18n.t('init:perf.liteOption')}`, value: 'lite' },
          ...navSentinels(canGoBack),
        ],
        default: liteMode ? 'lite' : 'standard',
      }])

      if (perfMode === BACK_SENTINEL)
        return 'back'
      if (perfMode === CANCEL_SENTINEL)
        return 'cancel'

      liteMode = perfMode === 'lite'

      // Version mode: v3 (smart entry + engine) or legacy (all 30 commands)
      const { versionMode } = await inquirer.prompt([{
        type: 'list',
        name: 'versionMode',
        message: '安装模式',
        choices: [
          { name: `${ansis.green('v3 新版')} — /ccg:go 智能入口 + Hook 引擎 + 12 核心命令（推荐）`, value: 'v3' },
          { name: `${ansis.gray('旧版兼容')} — 新版全部 + 18 个旧版命令（workflow/debug/team 等）`, value: 'legacy' },
        ],
        default: 'v3',
      }])
      installMode = versionMode
      if (versionMode === 'legacy') {
        selectedWorkflows = getAllCommandIds()
        const { includeImpeccable } = await inquirer.prompt([{
          type: 'confirm',
          name: 'includeImpeccable',
          message: i18n.t('init:commands.includeImpeccable'),
          default: !skipImpeccable,
        }])
        skipImpeccable = !includeImpeccable
      }
      else {
        selectedWorkflows = getCoreCommandIds()
        skipImpeccable = true
      }
      return 'next'
    }

    // Summary page renderer — returns 'confirm' | 'cancel' | StepId
    const runSummaryStep = async (workflowsCount: number): Promise<SummaryAction> => {
      console.log()
      console.log(ansis.yellow('━'.repeat(50)))
      console.log(ansis.bold(`  ${i18n.t('init:summary.title')}`))
      console.log()
      const fmName = frontendModels[0].charAt(0).toUpperCase() + frontendModels[0].slice(1)
      const bmName = backendModels[0].charAt(0).toUpperCase() + backendModels[0].slice(1)
      const apiLabel = (() => {
        if (apiUrl && apiKey)
          return `${ansis.green('●')} ${apiUrl} ${ansis.gray('+ ***')}`
        if (apiUrl)
          return `${ansis.green('●')} ${apiUrl}`
        return `${ansis.gray('○')} ${i18n.t('init:summary.apiSelfManaged')}`
      })()
      console.log(`  ${ansis.cyan(i18n.t('init:summary.apiProvider'))}  ${apiLabel}`)
      console.log(`  ${ansis.cyan(i18n.t('init:summary.modelRouting'))}  ${ansis.green(fmName)} (Frontend) + ${ansis.blue(bmName)} (Backend)`)
      if (frontendModels[0] === 'gemini' || backendModels[0] === 'gemini') {
        console.log(`  ${ansis.cyan(i18n.t('init:summary.geminiModel'))}   ${ansis.gray(geminiModel)}`)
      }
      if (frontendModels[0] === 'grok' || backendModels[0] === 'grok') {
        console.log(`  ${ansis.cyan(i18n.t('init:summary.grokModel'))}   ${ansis.gray(grokModel)}`)
      }
      if ((frontendModels[0] === 'kimi' || backendModels[0] === 'kimi') && kimiModel) {
        console.log(`  ${ansis.cyan(i18n.t('init:summary.kimiModel'))}   ${ansis.gray(kimiModel)}`)
      }
      console.log(`  ${ansis.cyan(i18n.t('init:summary.commandCount'))}  ${ansis.yellow(workflowsCount.toString())}`)
      const mcpSummary = (() => {
        if (mcpProvider === 'fast-context')
          return ansis.green('fast-context')
        if (mcpProvider === 'ace-tool' || mcpProvider === 'ace-tool-rs')
          return aceToolToken ? ansis.green(mcpProvider) : ansis.yellow(`${mcpProvider} (${i18n.t('init:summary.pendingConfig')})`)
        if (mcpProvider === 'contextweaver')
          return contextWeaverApiKey ? ansis.green('contextweaver') : ansis.yellow(`contextweaver (${i18n.t('init:summary.pendingConfig')})`)
        return ansis.gray(i18n.t('init:summary.skipped'))
      })()
      console.log(`  ${ansis.cyan(i18n.t('init:summary.mcpTool'))}      ${mcpSummary}`)
      console.log(`  ${ansis.cyan(i18n.t('init:summary.webUI'))}        ${liteMode ? ansis.gray(i18n.t('init:summary.disabled')) : ansis.green(i18n.t('init:summary.enabled'))}`)
      if (wantGrokSearch) {
        console.log(`  ${ansis.cyan('grok-search')}    ${tavilyKey ? ansis.green('✓') : ansis.yellow(`(${i18n.t('init:summary.pendingConfig')})`)}`)
      }
      console.log(ansis.yellow('━'.repeat(50)))
      console.log()

      const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: i18n.t('init:summaryMenu.prompt'),
        choices: [
          { name: `${ansis.green('✓')} ${i18n.t('init:summaryMenu.confirm')}`, value: 'confirm' },
          new inquirer.Separator(),
          { name: `${ansis.cyan('✎')} ${i18n.t('init:summaryMenu.editApi')}`, value: 'api' },
          { name: `${ansis.cyan('✎')} ${i18n.t('init:summaryMenu.editModel')}`, value: 'model' },
          { name: `${ansis.cyan('✎')} ${i18n.t('init:summaryMenu.editMcp')}`, value: 'mcp' },
          { name: `${ansis.cyan('✎')} ${i18n.t('init:summaryMenu.editPerf')}`, value: 'perf' },
          new inquirer.Separator(),
          { name: `${ansis.red('×')} ${i18n.t('init:summaryMenu.cancel')}`, value: 'cancel' },
        ],
        default: 'confirm',
      }])
      return action as SummaryAction
    }

    // ── Main state machine loop ──
    //
    // Each runStep returns 'next' | 'back' | 'cancel'. Navigation is
    // driven by sentinels inside each step's first list prompt. The
    // summary page is a separate jump-back menu that can land on any
    // step; after completing that jumped-to step we return to summary.
    const stepOrder: StepId[] = ['api', 'model', 'mcp', 'perf']
    let stepIdx = 0
    let jumpingToSummary = false

    while (true) {
      if (stepIdx < stepOrder.length) {
        const stepId = stepOrder[stepIdx]
        const canGoBack = stepIdx > 0

        let result: StepReturn
        switch (stepId) {
          case 'api':
            result = await runApiStep(canGoBack)
            break
          case 'model':
            result = await runModelStep(canGoBack)
            break
          case 'mcp':
            result = await runMcpStep(canGoBack)
            break
          case 'perf':
            result = await runPerfStep(canGoBack)
            break
        }

        if (result === 'cancel') {
          console.log(ansis.yellow(i18n.t('init:installCancelled')))
          return
        }
        if (result === 'back') {
          stepIdx = Math.max(0, stepIdx - 1)
          continue
        }

        // result === 'next'
        if (jumpingToSummary) {
          // Returned from a summary-triggered jump — go back to summary
          jumpingToSummary = false
          stepIdx = stepOrder.length
        }
        else {
          stepIdx++
        }
      }
      else {
        // Summary stage
        const summaryAction = await runSummaryStep(selectedWorkflows.length)
        if (summaryAction === 'confirm') {
          break
        }
        if (summaryAction === 'cancel') {
          console.log(ansis.yellow(i18n.t('init:installCancelled')))
          return
        }
        // Jump to the requested step, then return to summary
        jumpingToSummary = true
        stepIdx = stepOrder.indexOf(summaryAction)
      }
    }
  }

  // Build routing config (user-selectable since v2.1.0)
  const routing: ModelRouting = {
    frontend: {
      models: frontendModels,
      primary: frontendModels[0],
      strategy: 'fallback',
    },
    backend: {
      models: backendModels,
      primary: backendModels[0],
      strategy: 'fallback',
    },
    review: {
      models: [...new Set([...frontendModels, ...backendModels])],
      strategy: 'parallel',
    },
    mode,
    geminiModel,
    grokModel,
    kimiModel,
  }

  // Summary + confirmation handled by runSummaryStep() inside the state
  // machine above. For --skip-prompt / --force paths, print a minimal
  // summary line so non-interactive runs still show what's being installed.
  if (options.skipPrompt || options.force) {
    console.log()
    console.log(ansis.yellow('━'.repeat(50)))
    console.log(ansis.bold(`  ${i18n.t('init:summary.title')}`))
    console.log()
    const fmName = frontendModels[0].charAt(0).toUpperCase() + frontendModels[0].slice(1)
    const bmName = backendModels[0].charAt(0).toUpperCase() + backendModels[0].slice(1)
    console.log(`  ${ansis.cyan(i18n.t('init:summary.modelRouting'))}  ${ansis.green(fmName)} (Frontend) + ${ansis.blue(bmName)} (Backend)`)
    console.log(`  ${ansis.cyan(i18n.t('init:summary.commandCount'))}  ${ansis.yellow(selectedWorkflows.length.toString())}`)
    console.log(ansis.yellow('━'.repeat(50)))
    console.log()
  }

  // Install
  const spinner = ora(i18n.t('init:installing')).start()

  try {
    // v1.4.0: Auto-migrate from old directory structure
    if (await needsMigration()) {
      spinner.text = 'Migrating from v1.3.x to v1.4.0...'
      const migrationResult = await migrateToV1_4_0()

      if (migrationResult.migratedFiles.length > 0) {
        spinner.info(ansis.cyan('Migration completed:'))
        console.log()
        for (const file of migrationResult.migratedFiles) {
          console.log(`  ${ansis.green('✓')} ${file}`)
        }
        if (migrationResult.skipped.length > 0) {
          console.log()
          console.log(ansis.gray('  Skipped:'))
          for (const file of migrationResult.skipped) {
            console.log(`  ${ansis.gray('○')} ${file}`)
          }
        }
        console.log()
        spinner.start(i18n.t('init:installing'))
      }

      if (migrationResult.errors.length > 0) {
        spinner.warn(ansis.yellow('Migration completed with errors:'))
        for (const error of migrationResult.errors) {
          console.log(`  ${ansis.red('✗')} ${error}`)
        }
        console.log()
        spinner.start(i18n.t('init:installing'))
      }
    }

    await ensureCcgDir()

    // Create config
    const config = createDefaultConfig({
      language,
      routing,
      installedWorkflows: selectedWorkflows,
      mcpProvider,
      liteMode,
      skipImpeccable,
    })

    // Save config FIRST - ensure it's created even if installation fails
    await writeCcgConfig(config)

    // Install workflows and commands
    const installDir = options.installDir || join(homedir(), '.claude')
    const result = await installWorkflows(selectedWorkflows, installDir, options.force, {
      routing,
      liteMode,
      mcpProvider,
      skipImpeccable,
    })

    // Install selected MCP tools (multiple can be installed)
    spinner.succeed(ansis.green(i18n.t('init:installSuccess')))

    // ace-tool
    if (aceToolToken) {
      spinner.text = i18n.t('init:aceTool.installing')
      const aceResult = await installAceTool({ baseUrl: aceToolBaseUrl, token: aceToolToken })
      if (aceResult.success) {
        console.log(`    ${ansis.green('✓')} ace-tool MCP ${ansis.gray(`→ ${aceResult.configPath}`)}`)
      }
      else {
        console.log(`    ${ansis.yellow('⚠')} ace-tool: ${ansis.gray(aceResult.message)}`)
      }
    }

    // fast-context
    if (wantFastContext) {
      const fcResult = await installFastContext({
        apiKey: fastContextApiKey || undefined,
        includeSnippets: fastContextIncludeSnippets,
      })
      if (fcResult.success) {
        console.log(`    ${ansis.green('✓')} fast-context MCP ${ansis.gray(`→ ${fcResult.configPath}`)}`)
        // Write search guidance — auxiliary mode if ace-tool is primary
        await writeFastContextPrompt(mcpProvider === 'ace-tool' || mcpProvider === 'ace-tool-rs')
        console.log(`    ${ansis.green('✓')} ${i18n.t('init:mcp.fcPromptInjected')} ${ansis.gray('→ ~/.claude/rules/ + ~/.codex/ + ~/.gemini/')}`)
      }
      else {
        console.log(`    ${ansis.yellow('⚠')} fast-context: ${ansis.gray(fcResult.message)}`)
      }
    }

    // contextweaver
    if (contextWeaverApiKey) {
      spinner.text = i18n.t('init:mcp.cwConfiguring')
      const cwResult = await installContextWeaver({ siliconflowApiKey: contextWeaverApiKey })
      if (cwResult.success) {
        console.log(`    ${ansis.green('✓')} ContextWeaver MCP ${ansis.gray(`→ ${cwResult.configPath}`)}`)
      }
      else {
        console.log(`    ${ansis.yellow('⚠')} ContextWeaver: ${ansis.gray(cwResult.message)}`)
      }
    }

    // ═══════════════════════════════════════════════════════
    // Save settings.json: API config + Hook auto-approve
    // ═══════════════════════════════════════════════════════
    const settingsPath = join(installDir, 'settings.json')

    // Save API configuration if provided
    if (apiUrl && apiKey) {
      let settings: Record<string, any> = {}
      if (await fs.pathExists(settingsPath)) {
        settings = await fs.readJSON(settingsPath)
      }
      if (!settings.env)
        settings.env = {}
      settings.env.ANTHROPIC_BASE_URL = apiUrl
      settings.env.ANTHROPIC_AUTH_TOKEN = apiKey
      delete settings.env.ANTHROPIC_API_KEY
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
      // A single prefix rule covers every backend (and any future one) —
      // enumerating them meant the default frontend was never auto-approved.
      const wrapperPerms = [
        'Bash(~/.claude/bin/codeagent-wrapper*)',
        'Bash(*codeagent-wrapper*)',
      ]
      for (const perm of wrapperPerms) {
        if (!settings.permissions.allow.includes(perm))
          settings.permissions.allow.push(perm)
      }
      await fs.writeJSON(settingsPath, settings, { spaces: 2 })
      console.log()
      console.log(`    ${ansis.green('✓')} API ${ansis.gray(`→ ${settingsPath}`)}`)
    }

    // Register APIMart as a Codex model provider (~/.codex/config.toml).
    // Separate from the block above because Codex speaks OpenAI, not Anthropic:
    // its base_url keeps the /v1 suffix that ANTHROPIC_BASE_URL must omit.
    if (apimartWireCodex) {
      const codexApi = await configureApiMartForCodex(apimartActivateCodex)
      console.log()
      if (codexApi.success) {
        console.log(`    ${ansis.green('✓')} Codex ${ansis.gray(`→ ${codexApi.configPath}`)}`)
        // env_key auth: the key lives in the environment, never in config.toml,
        // so we never clobber the user's existing ~/.codex/auth.json login.
        console.log(`      ${ansis.gray(i18n.t('init:api.apimartCodexEnvHint'))}`)
        console.log(`      ${ansis.cyan(`export APIMART_API_KEY="${apiKey.slice(0, 6)}..."`)}`)
        if (!codexApi.activated)
          console.log(`      ${ansis.gray(i18n.t('init:api.apimartCodexNotActive'))}`)
      }
      else {
        console.log(`    ${ansis.yellow('!')} ${codexApi.message}`)
      }
    }

    // Gemini CLI third-party gateway — for users without a Google account.
    // gemini auto-selects gateway auth on seeing GOOGLE_GEMINI_BASE_URL, but
    // 0.53.1 only reads the process environment (its .env loading is gone),
    // so the variables land in the user's shell profile.
    if (geminiCliBaseUrl && geminiCliKey) {
      const geminiApi = await configureGeminiCliApi({ baseUrl: geminiCliBaseUrl, apiKey: geminiCliKey, model: geminiCliModel || undefined })
      console.log()
      if (geminiApi.success) {
        console.log(`    ${ansis.green('✓')} ${i18n.t('init:api.geminiCliSaved')}${geminiApi.rcPath ? ansis.gray(` → ${geminiApi.rcPath}`) : ''}`)
        if (geminiApi.needsReload)
          console.log(`      ${ansis.gray(i18n.t('init:api.geminiCliReloadHint'))}`)
      }
      else {
        console.log(`    ${ansis.yellow('!')} ${geminiApi.message}`)
      }
    }

    // Always install codeagent-wrapper auto-approve via permissions.allow
    await installHook(settingsPath)
    console.log()
    console.log(`    ${ansis.green('✓')} ${i18n.t('init:hooks.installed')} ${ansis.gray('(permissions.allow)')}`)

    // Install grok-search MCP if requested
    if (wantGrokSearch && (tavilyKey || firecrawlKey || grokApiUrl || grokApiKey)) {
      spinner.text = i18n.t('init:grok.installing')
      const grokResult = await installGrokSearchMcp({
        tavilyKey,
        firecrawlKey,
        grokApiUrl: grokApiUrl || undefined,
        grokApiKey: grokApiKey || undefined,
      })

      if (grokResult.success) {
        // Write global prompt to ~/.claude/rules/ccg-grok-search.md
        await appendGrokSearchPrompt()
        console.log()
        console.log(`    ${ansis.green('✓')} grok-search MCP ${ansis.gray('→ ~/.claude.json')}`)
        console.log(`    ${ansis.green('✓')} ${i18n.t('init:grok.promptAppended')} ${ansis.gray('→ ~/.claude/rules/ccg-grok-search.md')}`)
      }
      else {
        console.log()
        console.log(`    ${ansis.yellow('⚠')} grok-search MCP ${i18n.t('init:grok.installFailed')}`)
        console.log(ansis.gray(`      ${grokResult.message}`))
      }
    }

    // Install CodeGraph MCP if requested (no API key needed — pure local)
    if (wantCodeGraph) {
      const cgResult = await installMcpServer(
        'codegraph',
        'npx',
        ['-y', '@colbymchenry/codegraph@latest', 'serve', '--mcp'],
      )
      if (cgResult.success) {
        console.log()
        console.log(`    ${ansis.green('✓')} CodeGraph MCP ${ansis.gray('→ ~/.claude.json')}`)
      }
      else {
        console.log()
        console.log(`    ${ansis.yellow('⚠')} CodeGraph: ${ansis.gray(cgResult.message)}`)
      }
    }

    // Install context7 MCP + Codex sync (skip when --skip-mcp is passed)
    if (!options.skipMcp) {
      const context7Result = await installMcpServer(
        'context7',
        'npx',
        ['-y', '@upstash/context7-mcp@latest'],
      )
      if (context7Result.success) {
        console.log()
        console.log(`    ${ansis.green('✓')} context7 MCP ${ansis.gray('→ ~/.claude.json')}`)
      }
      else {
        console.log()
        console.log(`    ${ansis.yellow('⚠')} context7 MCP install failed`)
        console.log(ansis.gray(`      ${context7Result.message}`))
      }

      // ═══════════════════════════════════════════════════════
      // Sync MCP servers to Codex (~/.codex/config.toml)
      // Enables /ccg:codex-exec to use MCP tools (grok-search, context7, etc.)
      // ═══════════════════════════════════════════════════════
      const codexSyncResult = await syncMcpToCodex()
      if (codexSyncResult.success && codexSyncResult.synced.length > 0) {
        console.log()
        console.log(`    ${ansis.green('✓')} Codex MCP sync: ${codexSyncResult.synced.join(', ')} ${ansis.gray('→ ~/.codex/config.toml')}`)
      }
      else if (!codexSyncResult.success) {
        console.log()
        console.log(`    ${ansis.yellow('⚠')} Codex MCP sync failed`)
        console.log(ansis.gray(`      ${codexSyncResult.message}`))
      }

      // ═══════════════════════════════════════════════════════
      // Sync MCP servers to Gemini (~/.gemini/settings.json)
      // ═══════════════════════════════════════════════════════
      const geminiSyncResult = await syncMcpToGemini()
      if (geminiSyncResult.success && geminiSyncResult.synced.length > 0) {
        console.log()
        console.log(`    ${ansis.green('✓')} Gemini MCP sync: ${geminiSyncResult.synced.join(', ')} ${ansis.gray('→ ~/.gemini/settings.json')}`)
      }
      else if (!geminiSyncResult.success) {
        console.log()
        console.log(`    ${ansis.yellow('⚠')} Gemini MCP sync failed`)
        console.log(ansis.gray(`      ${geminiSyncResult.message}`))
      }
    }

    // jq check removed — permissions.allow approach does not require jq

    // Show result summary
    console.log()
    console.log(ansis.cyan(`  ${i18n.t('init:installedCommands')}`))
    result.installedCommands.forEach((cmd) => {
      console.log(`    ${ansis.green('✓')} /ccg:${cmd}`)
    })

    // Show installed prompts
    if (result.installedPrompts.length > 0) {
      console.log()
      console.log(ansis.cyan(`  ${i18n.t('init:installedPrompts')}`))
      // Group by model
      const grouped: Record<string, string[]> = {}
      result.installedPrompts.forEach((p) => {
        const [model, role] = p.split('/')
        if (!grouped[model])
          grouped[model] = []
        grouped[model].push(role)
      })
      Object.entries(grouped).forEach(([model, roles]) => {
        console.log(`    ${ansis.green('✓')} ${model}: ${roles.join(', ')}`)
      })
    }

    // Show installed skills
    if (result.installedSkills && result.installedSkills > 0) {
      console.log()
      console.log(ansis.cyan('  Skills:'))
      console.log(`    ${ansis.green('✓')} ${result.installedSkills} skills installed (quality gates + multi-agent)`)
      console.log(ansis.gray('       → ~/.claude/skills/'))
    }

    // Show installed rules
    if (result.installedRules) {
      console.log()
      console.log(ansis.cyan('  Rules:'))
      console.log(`    ${ansis.green('✓')} quality gate auto-trigger rules`)
      console.log(ansis.gray('       → ~/.claude/rules/ccg-skills.md'))
    }

    // Show errors if any
    if (result.errors.length > 0) {
      console.log()
      if (!result.success) {
        // Critical failure — prominent red box
        console.log(ansis.red.bold(`  ╔════════════════════════════════════════════════════════════╗`))
        console.log(ansis.red.bold(`  ║  ⚠  安装出现错误 / Installation errors detected           ║`))
        console.log(ansis.red.bold(`  ╚════════════════════════════════════════════════════════════╝`))
      }
      else {
        console.log(ansis.yellow(`  ⚠ ${i18n.t('init:installationErrors')}`))
      }
      result.errors.forEach((error) => {
        console.log(`    ${ansis.red('✗')} ${error}`)
      })
      if (!result.success) {
        console.log()
        console.log(ansis.yellow(`  尝试修复 / Try to fix:`))
        console.log(ansis.cyan(`    npx ccg-workflow@latest init --force`))
        console.log(ansis.gray(`    如仍失败，请提交 issue 并附上以上错误信息`))
        console.log(ansis.gray(`    If still failing, report an issue with the errors above`))
      }
    }

    // Show binary installation result
    if (result.binInstalled && result.binPath) {
      console.log()
      console.log(ansis.cyan(`  ${i18n.t('init:installedBinary')}`))
      console.log(`    ${ansis.green('✓')} codeagent-wrapper ${ansis.gray(`→ ${result.binPath}`)}`)

      const platform = process.platform

      if (platform === 'win32') {
        const windowsPath = result.binPath.replace(/\//g, '\\').replace(/\\$/, '')
        try {
          const { execSync } = await import('node:child_process')
          const psFlags = '-NoProfile -NonInteractive -ExecutionPolicy Bypass'
          const currentPath = execSync(`powershell ${psFlags} -Command "[System.Environment]::GetEnvironmentVariable('PATH', 'User')"`, { encoding: 'utf-8' }).trim()
          const currentPathNorm = currentPath.toLowerCase().replace(/\\$/g, '')
          const windowsPathNorm = windowsPath.toLowerCase()

          if (!currentPathNorm.includes(windowsPathNorm) && !currentPathNorm.includes('.claude\\bin')) {
            const escapedPath = windowsPath.replace(/'/g, "''")
            const psScript = currentPath
              ? `$p=[System.Environment]::GetEnvironmentVariable('PATH','User');[System.Environment]::SetEnvironmentVariable('PATH',($p+';'+'${escapedPath}'),'User')`
              : `[System.Environment]::SetEnvironmentVariable('PATH','${escapedPath}','User')`
            execSync(`powershell ${psFlags} -Command "${psScript}"`, { stdio: 'pipe' })
            console.log(`    ${ansis.green('✓')} PATH ${ansis.gray('→ User env')}`)
          }
        }
        catch {
          // Silently ignore PATH config errors on Windows
        }
      }
      else if (!options.skipPrompt) {
        const exportCommand = `export PATH="${result.binPath}:$PATH"`
        const shell = process.env.SHELL || ''
        const isZsh = shell.includes('zsh')
        const isBash = shell.includes('bash')
        const isMacDefaultZsh = process.platform === 'darwin' && !shell

        if (isZsh || isBash || isMacDefaultZsh) {
          const shellRc = (isZsh || isMacDefaultZsh) ? join(homedir(), '.zshrc') : join(homedir(), '.bashrc')
          const shellRcDisplay = (isZsh || isMacDefaultZsh) ? '~/.zshrc' : '~/.bashrc'

          try {
            let rcContent = ''
            if (await fs.pathExists(shellRc)) {
              rcContent = await fs.readFile(shellRc, 'utf-8')
            }

            if (rcContent.includes(result.binPath) || rcContent.includes('/.claude/bin')) {
              console.log(`    ${ansis.green('✓')} PATH ${ansis.gray(`→ ${shellRcDisplay} (${i18n.t('init:pathAlreadyConfigured', { file: shellRcDisplay })})`)}`)
            }
            else {
              const configLine = `\n# CCG multi-model collaboration system\n${exportCommand}\n`
              await fs.appendFile(shellRc, configLine, 'utf-8')
              console.log(`    ${ansis.green('✓')} PATH ${ansis.gray(`→ ${shellRcDisplay}`)}`)
            }
          }
          catch {
            // Silently ignore PATH config errors
          }
        }
        else {
          console.log(`    ${ansis.yellow('⚠')} PATH ${ansis.gray(`→ ${i18n.t('init:addToPathManually')}`)}`)
          console.log(`      ${ansis.cyan(exportCommand)}`)
        }
      }
    }
    else {
      // Binary download failed — show prominent warning with manual fix instructions
      showBinaryDownloadWarning(join(installDir, 'bin'))
    }

    // Show MCP resources if user skipped installation
    if (mcpProvider === 'skip' || ((mcpProvider === 'ace-tool' || mcpProvider === 'ace-tool-rs') && !aceToolToken) || (mcpProvider === 'contextweaver' && !contextWeaverApiKey)) {
      console.log()
      console.log(ansis.cyan.bold(`  📖 ${i18n.t('init:mcp.mcpOptions')}`))
      console.log()
      console.log(ansis.gray(`     ${i18n.t('init:mcp.mcpOptionsHint')}`))
      console.log()
      console.log(`     ${ansis.green('1.')} ${ansis.cyan('fast-context')} ${ansis.yellow('(推荐)')}: Windsurf Fast Context`)
      console.log(`        ${ansis.gray('AI 驱动代码搜索，需 Windsurf 账号，免费/低成本')}`)
      console.log()
      console.log(`     ${ansis.green('2.')} ${ansis.cyan('ace-tool / ace-tool-rs')}: ${ansis.underline('https://augmentcode.com/')}`)
      console.log(`        ${ansis.gray(i18n.t('init:mcp.promptEnhancement'))}`)
      console.log()
      console.log(`     ${ansis.green('3.')} ${ansis.cyan('ace-tool ' + i18n.t('init:mcp.proxyService'))} ${ansis.yellow(`(${i18n.t('init:mcp.noSignup')})`)}: ${ansis.underline('https://acemcp.heroman.wtf/')}`)
      console.log(`        ${ansis.gray(i18n.t('init:mcp.communityProxy'))}`)
      console.log()
      console.log(`     ${ansis.green('4.')} ${ansis.cyan('ContextWeaver')} ${ansis.yellow(`(${i18n.t('init:mcp.freeQuota')})`)}: ${ansis.underline('https://siliconflow.cn/')}`)
      console.log(`        ${ansis.gray(i18n.t('init:mcp.localEngine'))}`)
      console.log()
    }

    console.log()
  }
  catch (error) {
    spinner.fail(ansis.red(i18n.t('init:installFailed')))
    console.error(error)
  }
}
