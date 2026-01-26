import type { CollaborationMode, InitOptions, ModelRouting, ModelType, PromptEnhancerType, SupportedLang } from '../types'
import ansis from 'ansis'
import fs from 'fs-extra'
import inquirer from 'inquirer'
import ora from 'ora'
import { homedir } from 'node:os'
import { join } from 'pathe'
import { i18n } from '../i18n'
import { createDefaultConfig, ensureCcgDir, getCcgDir, readCcgConfig, writeCcgConfig } from '../utils/config'
import { getAllCommandIds, installAceTool, installAceToolRs, installWorkflows } from '../utils/installer'
import { migrateToV1_4_0, needsMigration } from '../utils/migration'

export async function init(options: InitOptions = {}): Promise<void> {
  console.log()
  console.log(ansis.cyan.bold(`  CCG - Claude + Codex + Gemini`))
  console.log(ansis.gray(`  多模型协作开发工作流`))
  console.log()

  // Fixed configuration
  const language: SupportedLang = 'zh-CN'
  const frontendModels: ModelType[] = ['gemini']
  const backendModels: ModelType[] = ['codex']
  const mode: CollaborationMode = 'smart'
  const selectedWorkflows = getAllCommandIds()

  // Performance mode selection
  let liteMode = false

  // MCP Tool Selection
  let mcpProvider = 'ace-tool'
  let aceToolBaseUrl = ''
  let aceToolToken = ''

  // Skip MCP configuration if --skip-mcp is passed (used during update)
  if (options.skipMcp) {
    mcpProvider = 'skip'
  }
  else if (!options.skipPrompt) {
    console.log()
    console.log(ansis.cyan.bold(`  🔧 MCP 工具配置`))
    console.log()

    const { selectedMcp } = await inquirer.prompt([{
      type: 'list',
      name: 'selectedMcp',
      message: '选择 MCP 工具',
      choices: [
        {
          name: `ace-tool ${ansis.gray('(Node.js 实现) - 一键安装，含 Prompt 增强 + 代码检索')}`,
          value: 'ace-tool',
        },
        {
          name: `ace-tool-rs ${ansis.green('(推荐)')} ${ansis.gray('(Rust 实现) - 更轻量、更快速')}`,
          value: 'ace-tool-rs',
        },
        {
          name: `跳过 ${ansis.gray('- 稍后手动配置（可选 auggie 等其他 MCP）')}`,
          value: 'skip',
        },
      ],
      default: 'ace-tool-rs',
    }])

    mcpProvider = selectedMcp

    // Configure ace-tool or ace-tool-rs if selected
    if (selectedMcp === 'ace-tool' || selectedMcp === 'ace-tool-rs') {
      const toolName = selectedMcp === 'ace-tool-rs' ? 'ace-tool-rs' : 'ace-tool'
      const toolDesc = selectedMcp === 'ace-tool-rs' ? i18n.t('init:aceToolRs.description') : i18n.t('init:aceTool.description')

      console.log()
      console.log(ansis.cyan.bold(`  🔧 ${toolName} MCP 配置`))
      console.log(ansis.gray(`     ${toolDesc}`))
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

  // Prompt enhancer selection
  // 默认保持原有行为 (ace-tool)，只有通过命令行参数明确指定时才使用其他方式
  let promptEnhancer: PromptEnhancerType = 'ace-tool'

  if (options.promptEnhancer) {
    // 命令行参数明确指定
    promptEnhancer = options.promptEnhancer
  }
  else {
    // 读取现有配置，保持用户之前的选择
    const existingConfig = await readCcgConfig()
    if (existingConfig?.mcp?.prompt_enhancer) {
      promptEnhancer = existingConfig.mcp.prompt_enhancer
    }
    // 否则保持默认值 ace-tool
  }

  // Performance mode selection (always ask unless skipPrompt is true)
  if (!options.skipPrompt) {
    // Read existing config to show current setting
    const existingConfig = await readCcgConfig()
    const currentLiteMode = existingConfig?.performance?.liteMode || false

    console.log()
    const { enableWebUI } = await inquirer.prompt([{
      type: 'confirm',
      name: 'enableWebUI',
      message: `启用 Web UI 实时输出？${ansis.gray('(禁用可加速响应)')}`,
      default: !currentLiteMode, // Default to current setting (inverted)
    }])

    liteMode = !enableWebUI
  }
  else {
    // In non-interactive mode (update), preserve existing liteMode setting
    const existingConfig = await readCcgConfig()
    if (existingConfig?.performance?.liteMode !== undefined) {
      liteMode = existingConfig.performance.liteMode
    }
  }

  // Build routing config (fixed: Gemini frontend, Codex backend)
  const routing: ModelRouting = {
    frontend: {
      models: frontendModels,
      primary: 'gemini',
      strategy: 'fallback',
    },
    backend: {
      models: backendModels,
      primary: 'codex',
      strategy: 'fallback',
    },
    review: {
      models: ['codex', 'gemini'],
      strategy: 'parallel',
    },
    mode,
  }

  // Show summary
  console.log()
  console.log(ansis.yellow('━'.repeat(50)))
  console.log(ansis.bold(`  ${i18n.t('init:summary.title')}`))
  console.log()
  console.log(`  ${ansis.cyan('模型路由')}  ${ansis.green('Gemini')} (前端) + ${ansis.blue('Codex')} (后端)`)
  console.log(`  ${ansis.cyan('命令数量')}  ${ansis.yellow(selectedWorkflows.length.toString())} 个`)
  console.log(`  ${ansis.cyan('MCP 工具')}  ${(mcpProvider === 'ace-tool' || mcpProvider === 'ace-tool-rs') ? (aceToolToken ? ansis.green(mcpProvider) : ansis.yellow(`${mcpProvider} (待配置)`)) : ansis.gray('跳过')}`)
  console.log(`  ${ansis.cyan('Prompt 增强')} ${promptEnhancer === 'claude-context' ? ansis.green('claude-context (内置向量搜索)') : ansis.blue('ace-tool (MCP)')}`)
  console.log(`  ${ansis.cyan('Web UI')}    ${liteMode ? ansis.gray('禁用') : ansis.green('启用')}`)
  console.log(ansis.yellow('━'.repeat(50)))
  console.log()

  // Confirm in interactive mode (skip if force is true)
  if (!options.skipPrompt && !options.force) {
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
      liteMode,
      promptEnhancer,
    })

    // Save config FIRST - ensure it's created even if installation fails
    await writeCcgConfig(config)

    // Install workflows and commands
    const installDir = options.installDir || join(homedir(), '.claude')
    const result = await installWorkflows(selectedWorkflows, installDir, options.force, {
      routing,
      liteMode,
      promptEnhancer,
    })

    // Install ace-tool or ace-tool-rs MCP if token was provided
    if ((mcpProvider === 'ace-tool' || mcpProvider === 'ace-tool-rs') && aceToolToken) {
      const toolName = mcpProvider === 'ace-tool-rs' ? 'ace-tool-rs' : 'ace-tool'
      const installFn = mcpProvider === 'ace-tool-rs' ? installAceToolRs : installAceTool

      spinner.text = mcpProvider === 'ace-tool-rs' ? i18n.t('init:aceToolRs.installing') : i18n.t('init:aceTool.installing')
      const aceResult = await installFn({
        baseUrl: aceToolBaseUrl,
        token: aceToolToken,
      })
      if (aceResult.success) {
        spinner.succeed(ansis.green(i18n.t('init:installSuccess')))
        console.log()
        console.log(`    ${ansis.green('✓')} ${toolName} MCP ${ansis.gray(`→ ${aceResult.configPath}`)}`)
      }
      else {
        spinner.warn(ansis.yellow(mcpProvider === 'ace-tool-rs' ? i18n.t('init:aceToolRs.failed') : i18n.t('init:aceTool.failed')))
        console.log(ansis.gray(`      ${aceResult.message}`))
      }
    }
    else if ((mcpProvider === 'ace-tool' || mcpProvider === 'ace-tool-rs') && !aceToolToken) {
      const toolName = mcpProvider === 'ace-tool-rs' ? 'ace-tool-rs' : 'ace-tool'
      spinner.succeed(ansis.green(i18n.t('init:installSuccess')))
      console.log()
      console.log(`    ${ansis.yellow('⚠')} ${toolName} MCP 未安装 ${ansis.gray('(Token 未提供)')}`)
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
            // Use single quotes in PowerShell to avoid escaping issues; empty PATH means set directly
            const escapedPath = windowsPath.replace(/'/g, "''")
            const psScript = currentPath
              ? `$p=[System.Environment]::GetEnvironmentVariable('PATH','User');[System.Environment]::SetEnvironmentVariable('PATH',($p+';'+'${escapedPath}'),'User')`
              : `[System.Environment]::SetEnvironmentVariable('PATH','${escapedPath}','User')`
            execSync(`powershell ${psFlags} -Command "${psScript}"`, { stdio: 'pipe' })
            console.log(`    ${ansis.green('✓')} PATH ${ansis.gray('→ 用户环境变量')}`)
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
              console.log(`    ${ansis.green('✓')} PATH ${ansis.gray(`→ ${shellRcDisplay} (已配置)`)}`)
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
          console.log(`    ${ansis.yellow('⚠')} PATH ${ansis.gray('→ 请手动添加到 shell 配置:')}`)
          console.log(`      ${ansis.cyan(exportCommand)}`)
        }
      }
    }

    // Show MCP resources if user skipped installation
    if (mcpProvider === 'skip' || ((mcpProvider === 'ace-tool' || mcpProvider === 'ace-tool-rs') && !aceToolToken)) {
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
  }
  catch (error) {
    spinner.fail(ansis.red(i18n.t('init:installFailed')))
    console.error(error)
  }
}
