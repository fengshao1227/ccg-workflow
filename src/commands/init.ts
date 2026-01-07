import type { CollaborationMode, InitOptions, ModelRouting, ModelType, SupportedLang, WorkflowConfig } from '../types'
import ansis from 'ansis'
import fs from 'fs-extra'
import inquirer from 'inquirer'
import ora from 'ora'
import { homedir } from 'node:os'
import { join } from 'pathe'
import { i18n } from '../i18n'
import { createDefaultConfig, ensureCcgDir, getCcgDir, writeCcgConfig } from '../utils/config'
import { getWorkflowConfigs, getWorkflowPreset, installAceTool, installWorkflows, WORKFLOW_PRESETS, type WorkflowPreset } from '../utils/installer'
import { migrateToV1_4_0, needsMigration } from '../utils/migration'

export async function init(options: InitOptions = {}): Promise<void> {
  console.log()
  console.log(ansis.cyan.bold(`  CCG - Claude + Codex + Gemini`))
  console.log(ansis.gray(`  ${i18n.t('init:welcome')}`))
  console.log()

  // Language selection (if not provided)
  let language: SupportedLang = options.lang || 'en'
  if (!options.skipPrompt && !options.lang) {
    const { selectedLang } = await inquirer.prompt([{
      type: 'list',
      name: 'selectedLang',
      message: i18n.t('init:selectLanguage'),
      choices: [
        { name: '中文 (Chinese)', value: 'zh-CN' },
        { name: 'English', value: 'en' },
      ],
      default: 'zh-CN',
    }])
    language = selectedLang
    // Switch i18n language immediately after selection
    await i18n.changeLanguage(language)
  }

  // Frontend models selection (multi-select)
  let frontendModels: ModelType[] = ['gemini']
  if (options.frontend) {
    frontendModels = options.frontend.split(',').map(m => m.trim() as ModelType)
  }
  else if (!options.skipPrompt) {
    const { selectedFrontend } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selectedFrontend',
      message: i18n.t('init:selectFrontendModels'),
      choices: [
        { name: i18n.t('init:models.gemini'), value: 'gemini', checked: true },
        { name: i18n.t('init:models.codex'), value: 'codex' },
        { name: i18n.t('init:models.claude'), value: 'claude' },
      ],
      validate: (answer: string[]) => answer.length > 0 || i18n.t('init:validation.selectAtLeastOne'),
    }])
    frontendModels = selectedFrontend
  }

  // Backend models selection (multi-select)
  let backendModels: ModelType[] = ['codex']
  if (options.backend) {
    backendModels = options.backend.split(',').map(m => m.trim() as ModelType)
  }
  else if (!options.skipPrompt) {
    const { selectedBackend } = await inquirer.prompt([{
      type: 'checkbox',
      name: 'selectedBackend',
      message: i18n.t('init:selectBackendModels'),
      choices: [
        { name: i18n.t('init:models.codex'), value: 'codex', checked: true },
        { name: i18n.t('init:models.gemini'), value: 'gemini' },
        { name: i18n.t('init:models.claude'), value: 'claude' },
      ],
      validate: (answer: string[]) => answer.length > 0 || i18n.t('init:validation.selectAtLeastOne'),
    }])
    backendModels = selectedBackend
  }

  // Collaboration mode selection
  let mode: CollaborationMode = 'smart'
  if (options.mode) {
    mode = options.mode as CollaborationMode
  }
  else if (!options.skipPrompt) {
    const { selectedMode } = await inquirer.prompt([{
      type: 'list',
      name: 'selectedMode',
      message: i18n.t('init:selectMode'),
      choices: [
        { name: i18n.t('init:modes.smart'), value: 'smart' },
        { name: i18n.t('init:modes.parallel'), value: 'parallel' },
        { name: i18n.t('init:modes.sequential'), value: 'sequential' },
      ],
      default: 'smart',
    }])
    mode = selectedMode
  }

  // Workflow selection
  const allWorkflows = getWorkflowConfigs()
  let selectedWorkflows: string[] = allWorkflows.filter(w => w.defaultSelected).map(w => w.id)

  if (options.workflows) {
    if (options.workflows === 'all') {
      selectedWorkflows = allWorkflows.map(w => w.id)
    }
    else if (options.workflows !== 'skip') {
      selectedWorkflows = options.workflows.split(',').map(w => w.trim())
    }
  }
  else if (!options.skipPrompt) {
    // First, ask for preset or custom
    const { workflowMode } = await inquirer.prompt([{
      type: 'list',
      name: 'workflowMode',
      message: '选择命令安装模式',
      choices: [
        {
          name: `${WORKFLOW_PRESETS.minimal.name} ${ansis.gray(`— ${WORKFLOW_PRESETS.minimal.description}`)} ${ansis.green('(推荐新手)')}`,
          value: 'minimal' as WorkflowPreset,
        },
        {
          name: `${WORKFLOW_PRESETS.standard.name} ${ansis.gray(`— ${WORKFLOW_PRESETS.standard.description}`)} ${ansis.green('(推荐)')}`,
          value: 'standard' as WorkflowPreset,
        },
        {
          name: `${WORKFLOW_PRESETS.full.name} ${ansis.gray(`— ${WORKFLOW_PRESETS.full.description}`)}`,
          value: 'full' as WorkflowPreset,
        },
        new inquirer.Separator(),
        {
          name: `自定义 ${ansis.gray('— 手动选择命令')}`,
          value: 'custom',
        },
      ],
      default: 'standard',
    }])

    if (workflowMode === 'custom') {
      // Show full checkbox list
      const { selected } = await inquirer.prompt([{
        type: 'checkbox',
        name: 'selected',
        message: i18n.t('init:selectWorkflows'),
        choices: allWorkflows.map(w => ({
          name: `${language === 'zh-CN' ? w.name : w.nameEn} ${ansis.gray(`— ${language === 'zh-CN' ? w.description : w.descriptionEn}`)}`,
          value: w.id,
          checked: w.defaultSelected,
        })),
      }])
      selectedWorkflows = selected
    }
    else {
      // Use preset
      selectedWorkflows = getWorkflowPreset(workflowMode as WorkflowPreset)
      const preset = WORKFLOW_PRESETS[workflowMode as WorkflowPreset]
      console.log()
      console.log(ansis.gray(`  已选择 ${ansis.cyan(preset.name)} 模式 (${selectedWorkflows.length} 个命令)`))
    }
  }

  // MCP Tool Selection
  let mcpProvider = 'ace-tool'
  let aceToolBaseUrl = ''
  let aceToolToken = ''

  if (!options.skipPrompt) {
    console.log()
    console.log(ansis.cyan.bold(`  🔧 MCP 工具配置`))
    console.log()

    const { selectedMcp } = await inquirer.prompt([{
      type: 'list',
      name: 'selectedMcp',
      message: '是否安装 ace-tool MCP？',
      choices: [
        {
          name: `安装 ace-tool ${ansis.gray('(推荐) - 一键安装，含 Prompt 增强 + 代码检索')}`,
          value: 'ace-tool',
        },
        {
          name: `跳过 ${ansis.gray('- 稍后手动配置（可选 auggie 等其他 MCP）')}`,
          value: 'skip',
        },
      ],
      default: 'ace-tool',
    }])

    mcpProvider = selectedMcp

    // Configure ace-tool if selected
    if (selectedMcp === 'ace-tool') {
      console.log()
      console.log(ansis.cyan.bold(`  🔧 ace-tool MCP 配置`))
      console.log(ansis.gray(`     ${i18n.t('init:aceTool.description')}`))
      console.log()

      const { skipToken } = await inquirer.prompt([{
        type: 'confirm',
        name: 'skipToken',
        message: '是否跳过 Token 配置？（可稍后运行 npx ccg config mcp 配置）',
        default: false,
      }])

      if (!skipToken) {
        console.log()
        console.log(ansis.cyan(`     📖 获取 ace-tool 访问方式：`))
        console.log()
        console.log(`     ${ansis.gray('•')} ${ansis.cyan('官方服务')}: ${ansis.underline('https://augmentcode.com/')}`)
        console.log(`       ${ansis.gray('注册账号后获取 Token')}`)
        console.log()
        console.log(`     ${ansis.gray('•')} ${ansis.cyan('中转服务')} ${ansis.yellow('(无需注册)')}: ${ansis.underline('https://linux.do/t/topic/1291730')}`)
        console.log(`       ${ansis.gray('linux.do 社区提供的免费中转服务')}`)
        console.log()

        const aceAnswers = await inquirer.prompt([
          {
            type: 'input',
            name: 'baseUrl',
            message: `Base URL ${ansis.gray('(使用中转服务时必填，官方服务留空)')}`,
            default: '',
          },
          {
            type: 'password',
            name: 'token',
            message: `Token ${ansis.gray('(必填)')}`,
            mask: '*',
            validate: (input: string) => input.trim() !== '' || '请输入 Token',
          },
        ])
        aceToolBaseUrl = aceAnswers.baseUrl || ''
        aceToolToken = aceAnswers.token || ''
      }
      else {
        console.log()
        console.log(ansis.yellow(`  ℹ️  已跳过 Token 配置`))
        console.log(ansis.gray(`     • ace-tool MCP 将不会自动安装`))
        console.log(ansis.gray(`     • 可稍后运行 ${ansis.cyan('npx ccg config mcp')} 配置 Token`))
        console.log(ansis.gray(`     • 获取 Token: ${ansis.cyan('https://augmentcode.com/')}`))
        console.log()
      }
    }
    else {
      console.log()
      console.log(ansis.yellow(`  ℹ️  已跳过 MCP 配置`))
      console.log(ansis.gray(`     • 可稍后手动配置任何 MCP 服务`))
      console.log()
    }
  }

  // Build routing config
  const routing: ModelRouting = {
    frontend: {
      models: frontendModels,
      primary: frontendModels[0],
      strategy: frontendModels.length > 1 ? 'parallel' : 'fallback',
    },
    backend: {
      models: backendModels,
      primary: backendModels[0],
      strategy: backendModels.length > 1 ? 'parallel' : 'fallback',
    },
    review: {
      models: [...new Set([...frontendModels, ...backendModels])],
      strategy: 'parallel',
    },
    mode,
  }

  // Show summary
  console.log()
  console.log(ansis.yellow('━'.repeat(50)))
  console.log(ansis.bold(`  ${i18n.t('init:summary.title')}`))
  console.log()
  console.log(`  ${ansis.cyan(i18n.t('init:summary.frontendModels'))} ${frontendModels.map(m => ansis.green(m)).join(', ')}`)
  console.log(`  ${ansis.cyan(i18n.t('init:summary.backendModels'))}  ${backendModels.map(m => ansis.blue(m)).join(', ')}`)
  console.log(`  ${ansis.cyan(i18n.t('init:summary.collaboration'))}   ${ansis.yellow(mode)}`)
  console.log(`  ${ansis.cyan(i18n.t('init:summary.workflows'))}       ${selectedWorkflows.length} ${i18n.t('init:summary.selected')}`)
  console.log(ansis.yellow('━'.repeat(50)))
  console.log()

  // Confirm in interactive mode
  if (!options.skipPrompt) {
    const { confirmed } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirmed',
      message: i18n.t('init:confirmInstall'),
      default: true,
    }])

    if (!confirmed) {
      console.log(ansis.yellow(i18n.t('init:installCancelled')))
      return
    }
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
    })

    // Save config FIRST - ensure it's created even if installation fails
    await writeCcgConfig(config)

    // Install workflows and commands
    const installDir = options.installDir || join(homedir(), '.claude')
    const result = await installWorkflows(selectedWorkflows, installDir, options.force, {
      routing,
    })

    // Install ace-tool MCP if token was provided
    if (mcpProvider === 'ace-tool' && aceToolToken) {
      spinner.text = i18n.t('init:aceTool.installing')
      const aceResult = await installAceTool({
        baseUrl: aceToolBaseUrl,
        token: aceToolToken,
      })
      if (aceResult.success) {
        spinner.succeed(ansis.green(i18n.t('init:installSuccess')))
        console.log()
        console.log(`    ${ansis.green('✓')} ace-tool MCP ${ansis.gray(`→ ${aceResult.configPath}`)}`)
      }
      else {
        spinner.warn(ansis.yellow(i18n.t('init:aceTool.failed')))
        console.log(ansis.gray(`      ${aceResult.message}`))
      }
    }
    else if (mcpProvider === 'ace-tool' && !aceToolToken) {
      spinner.succeed(ansis.green(i18n.t('init:installSuccess')))
      console.log()
      console.log(`    ${ansis.yellow('⚠')} ace-tool MCP 未安装 ${ansis.gray('(Token 未提供)')}`)
      console.log(`    ${ansis.gray('→')} 稍后运行 ${ansis.cyan('npx ccg config mcp')} 完成配置`)
    }
    else {
      spinner.succeed(ansis.green(i18n.t('init:installSuccess')))
    }

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

    // Show errors if any
    if (result.errors.length > 0) {
      console.log()
      console.log(ansis.red(`  ⚠ ${i18n.t('init:installationErrors')}`))
      result.errors.forEach((error) => {
        console.log(`    ${ansis.red('✗')} ${error}`)
      })
    }

    // Show binary installation result and configure PATH
    if (result.binInstalled && result.binPath) {
      console.log()
      console.log(ansis.cyan(`  ${i18n.t('init:installedBinary')}`))
      console.log(`    ${ansis.green('✓')} codeagent-wrapper ${ansis.gray(`→ ${result.binPath}`)}`)
      console.log()

      const platform = process.platform
      const exportCommand = `export PATH="${result.binPath}:$PATH"`

      if (platform === 'win32') {
        // Windows: Show manual instructions
        console.log(ansis.yellow(`  ⚠ ${i18n.t('init:pathWarning')}`))
        console.log()
        console.log(ansis.cyan(`  ${i18n.t('init:windowsPathInstructions')}`))
        console.log(ansis.gray(`     1. ${i18n.t('init:windowsStep1')}`))
        console.log(ansis.gray(`     2. ${i18n.t('init:windowsStep2')}`))
        console.log(ansis.gray(`     3. ${i18n.t('init:windowsStep3')}`))
        console.log(ansis.gray(`        ${result.binPath.replace(/\//g, '\\')}`))
        console.log(ansis.gray(`     4. ${i18n.t('init:windowsStep4')}`))
        console.log()
        console.log(ansis.cyan(`  ${i18n.t('init:orUsePowerShell')}`))
        const windowsPath = result.binPath.replace(/\//g, '\\')
        console.log(ansis.gray(`     $currentPath = [System.Environment]::GetEnvironmentVariable('PATH', 'User')`))
        console.log(ansis.gray(`     $newPath = '${windowsPath}'`))
        console.log(ansis.gray(`     if ($currentPath -notlike "*$newPath*") {`))
        console.log(ansis.gray(`         [System.Environment]::SetEnvironmentVariable('PATH', "$currentPath;$newPath", 'User')`))
        console.log(ansis.gray(`     }`))
      }
      else {
        // macOS/Linux: Offer auto-configuration
        console.log(ansis.yellow(`  ⚠ ${i18n.t('init:pathWarning')}`))

        if (!options.skipPrompt) {
          console.log()
          const { autoConfigurePath } = await inquirer.prompt([{
            type: 'confirm',
            name: 'autoConfigurePath',
            message: i18n.t('init:autoConfigurePathPrompt'),
            default: true,
          }])

          if (autoConfigurePath) {
            const shellRc = process.env.SHELL?.includes('zsh') ? join(homedir(), '.zshrc') : join(homedir(), '.bashrc')
            const shellRcDisplay = process.env.SHELL?.includes('zsh') ? '~/.zshrc' : '~/.bashrc'

            try {
              // Check if already configured
              let rcContent = ''
              if (await fs.pathExists(shellRc)) {
                rcContent = await fs.readFile(shellRc, 'utf-8')
              }

              if (rcContent.includes(result.binPath) || rcContent.includes('/.claude/bin')) {
                console.log(ansis.green(`  ✓ ${i18n.t('init:pathAlreadyConfigured', { file: shellRcDisplay })}`))
              }
              else {
                // Append to shell config
                const configLine = `\n# CCG multi-model collaboration system\n${exportCommand}\n`
                await fs.appendFile(shellRc, configLine, 'utf-8')
                console.log(ansis.green(`  ✓ ${i18n.t('init:pathConfigured', { file: shellRcDisplay })}`))
                console.log()
                console.log(ansis.cyan(`  ${i18n.t('init:restartShellPrompt')}`))
                console.log(ansis.gray(`     source ${shellRcDisplay}`))
              }
            }
            catch (error) {
              console.log(ansis.red(`  ✗ ${i18n.t('init:pathConfigFailed')}`))
              console.log(ansis.gray(`     ${i18n.t('init:manualConfigInstructions', { file: shellRcDisplay })}`))
              console.log(ansis.gray(`     ${exportCommand}`))
            }
          }
          else {
            const shellRc = process.env.SHELL?.includes('zsh') ? '~/.zshrc' : '~/.bashrc'
            console.log()
            console.log(ansis.cyan(`  ${i18n.t('init:manualConfigInstructions', { file: shellRc })}`))
            console.log(ansis.gray(`     ${exportCommand}`))
            console.log(ansis.gray(`     source ${shellRc}`))
          }
        }
        else {
          // Non-interactive mode: just show instructions
          const shellRc = process.env.SHELL?.includes('zsh') ? '~/.zshrc' : '~/.bashrc'
          console.log()
          console.log(ansis.cyan(`  ${i18n.t('init:manualConfigInstructions', { file: shellRc })}`))
          console.log(ansis.gray(`     ${exportCommand}`))
          console.log(ansis.gray(`     source ${shellRc}`))
        }
      }
    }

    // Show MCP resources if user skipped installation
    if (mcpProvider === 'skip' || (mcpProvider === 'ace-tool' && !aceToolToken)) {
      console.log()
      console.log(ansis.cyan.bold(`  📖 MCP 服务选项`))
      console.log()
      console.log(ansis.gray(`     如需使用代码检索和 Prompt 增强功能，可选择以下 MCP 服务：`))
      console.log()
      console.log(`     ${ansis.green('1.')} ${ansis.cyan('ace-tool')} ${ansis.gray('(推荐)')}: ${ansis.underline('https://augmentcode.com/')}`)
      console.log(`        ${ansis.gray('一键安装，含 Prompt 增强 + 代码检索')}`)
      console.log()
      console.log(`     ${ansis.green('2.')} ${ansis.cyan('ace-tool 中转服务')} ${ansis.yellow('(无需注册)')}: ${ansis.underline('https://linux.do/t/topic/1291730')}`)
      console.log(`        ${ansis.gray('linux.do 社区提供的免费中转服务')}`)
      console.log()
    }

    console.log()
    console.log(ansis.gray(`  ${i18n.t('init:configSavedTo')} ${getCcgDir()}/config.toml`))
    console.log()
  }
  catch (error) {
    spinner.fail(ansis.red(i18n.t('init:installFailed')))
    console.error(error)
  }
}
