import type { ModelRouting, ModelType } from '../types'
import ansis from 'ansis'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import inquirer from 'inquirer'
import ora from 'ora'
import { homedir } from 'node:os'
import { join } from 'pathe'
import { checkForUpdates } from '../utils/version'
import { installWorkflows } from '../utils/installer'
import { readCcgConfig, writeCcgConfig } from '../utils/config'
import { i18n } from '../i18n'

const execAsync = promisify(exec)

/**
 * Main update command - checks for updates and installs if available
 */
export async function update(): Promise<void> {
  console.log()
  console.log(ansis.cyan.bold('🔄 检查更新...'))
  console.log()

  const spinner = ora('正在检查最新版本...').start()

  try {
    const { hasUpdate, currentVersion, latestVersion } = await checkForUpdates()

    spinner.stop()

    if (!latestVersion) {
      console.log(ansis.red('❌ 无法连接到 npm registry，请检查网络连接'))
      return
    }

    console.log(`当前版本: ${ansis.yellow(`v${currentVersion}`)}`)
    console.log(`最新版本: ${ansis.green(`v${latestVersion}`)}`)
    console.log()

    if (!hasUpdate) {
      console.log(ansis.green('✅ 已是最新版本！'))

      // Ask if user wants to force reinstall
      const { forceReinstall } = await inquirer.prompt([{
        type: 'confirm',
        name: 'forceReinstall',
        message: '要强制重新安装当前版本吗？（可修复损坏的文件）',
        default: false,
      }])

      if (!forceReinstall) {
        return
      }
    }
    else {
      // Confirm update
      const { confirmUpdate } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirmUpdate',
        message: `确认要更新到 v${latestVersion} 吗？`,
        default: true,
      }])

      if (!confirmUpdate) {
        console.log(ansis.gray('已取消更新'))
        return
      }
    }

    await performUpdate(currentVersion, latestVersion || currentVersion)
  }
  catch (error) {
    spinner.stop()
    console.log(ansis.red(`❌ 更新失败: ${error}`))
  }
}

/**
 * Ask user if they want to reconfigure model routing
 */
async function askReconfigureRouting(currentRouting?: ModelRouting): Promise<ModelRouting | null> {
  console.log()
  console.log(ansis.cyan.bold('🔧 模型路由配置'))
  console.log()

  if (currentRouting) {
    console.log(ansis.gray('当前配置:'))
    console.log(`  ${ansis.cyan('前端模型:')} ${currentRouting.frontend.models.map(m => ansis.green(m)).join(', ')}`)
    console.log(`  ${ansis.cyan('后端模型:')} ${currentRouting.backend.models.map(m => ansis.blue(m)).join(', ')}`)
    console.log()
  }

  const { reconfigure } = await inquirer.prompt([{
    type: 'confirm',
    name: 'reconfigure',
    message: '是否重新配置前端和后端模型？',
    default: false,
  }])

  if (!reconfigure) {
    return null
  }

  console.log()

  // Frontend models selection
  const { selectedFrontend } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'selectedFrontend',
    message: i18n.t('init:selectFrontendModels'),
    choices: [
      { name: 'Gemini', value: 'gemini' as ModelType, checked: currentRouting?.frontend.models.includes('gemini') ?? true },
      { name: 'Claude', value: 'claude' as ModelType, checked: currentRouting?.frontend.models.includes('claude') ?? false },
      { name: 'Codex', value: 'codex' as ModelType, checked: currentRouting?.frontend.models.includes('codex') ?? false },
    ],
    validate: (answer: string[]) => answer.length > 0 || i18n.t('init:validation.selectAtLeastOne'),
  }])

  // Backend models selection
  const { selectedBackend } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'selectedBackend',
    message: i18n.t('init:selectBackendModels'),
    choices: [
      { name: 'Codex', value: 'codex' as ModelType, checked: currentRouting?.backend.models.includes('codex') ?? true },
      { name: 'Gemini', value: 'gemini' as ModelType, checked: currentRouting?.backend.models.includes('gemini') ?? false },
      { name: 'Claude', value: 'claude' as ModelType, checked: currentRouting?.backend.models.includes('claude') ?? false },
    ],
    validate: (answer: string[]) => answer.length > 0 || i18n.t('init:validation.selectAtLeastOne'),
  }])

  const frontendModels = selectedFrontend as ModelType[]
  const backendModels = selectedBackend as ModelType[]

  // Build new routing config
  const newRouting: ModelRouting = {
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
    mode: currentRouting?.mode || 'smart',
  }

  console.log()
  console.log(ansis.green('✓ 新配置:'))
  console.log(`  ${ansis.cyan('前端模型:')} ${frontendModels.map(m => ansis.green(m)).join(', ')}`)
  console.log(`  ${ansis.cyan('后端模型:')} ${backendModels.map(m => ansis.blue(m)).join(', ')}`)
  console.log()

  return newRouting
}

/**
 * Perform the actual update process
 */
async function performUpdate(fromVersion: string, toVersion: string): Promise<void> {
  console.log()
  console.log(ansis.yellow.bold('⚙️  开始更新...'))
  console.log()

  // Ask if user wants to reconfigure routing
  const config = await readCcgConfig()
  const newRouting = await askReconfigureRouting(config?.routing)

  // We don't need to install globally - just use the templates from current package
  // The templates are always bundled with the package when user runs npx ccg-workflow
  const spinner = ora('更新命令模板和提示词...').start()

  try {
    const workflows = config?.workflows?.installed || []

    const installDir = join(homedir(), '.claude')
    const result = await installWorkflows(workflows, installDir, true, {
      routing: newRouting || config?.routing,
    }) // force = true

    if (result.success) {
      spinner.succeed('命令模板和提示词更新成功')

      console.log()
      console.log(ansis.cyan(`已更新 ${result.installedCommands.length} 个命令:`))
      for (const cmd of result.installedCommands) {
        console.log(`  ${ansis.gray('•')} /ccg:${cmd}`)
      }

      // Update config version and routing
      if (config) {
        config.general.version = toVersion
        if (newRouting) {
          config.routing = newRouting
        }
        await writeCcgConfig(config)
      }

      if (newRouting) {
        console.log()
        console.log(ansis.green('✓ 模型路由配置已更新'))
      }
    }
    else {
      spinner.fail('更新失败')
      console.log(ansis.red('部分文件更新失败:'))
      for (const error of result.errors) {
        console.log(ansis.red(`  • ${error}`))
      }
      return
    }
  }
  catch (error) {
    spinner.fail('更新失败')
    console.log(ansis.red(`错误: ${error}`))
    return
  }

  console.log()
  console.log(ansis.green.bold('✅ 更新完成！'))
  console.log()
  console.log(ansis.gray(`从 v${fromVersion} 升级到 v${toVersion}`))
  console.log()
}
