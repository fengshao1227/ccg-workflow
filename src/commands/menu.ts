import ansis from 'ansis'
import inquirer from 'inquirer'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { join } from 'pathe'
import { configMcp } from './config-mcp'
import { i18n } from '../i18n'
import { uninstallAceTool, uninstallWorkflows } from '../utils/installer'
import { init } from './init'
import { update } from './update'

const execAsync = promisify(exec)

export async function showMainMenu(): Promise<void> {
  while (true) {
    console.log()
    console.log(ansis.cyan.bold(`  CCG - Claude + Codex + Gemini`))
    console.log(ansis.gray('  Multi-Model Collaboration System'))
    console.log()

    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: i18n.t('menu:title'),
      choices: [
        { name: `${ansis.green('➜')} ${i18n.t('menu:options.init')}`, value: 'init' },
        { name: `${ansis.blue('➜')} ${i18n.t('menu:options.update')}`, value: 'update' },
        { name: `${ansis.cyan('⚙')} 配置 MCP`, value: 'config-mcp' },
        { name: `${ansis.magenta('➜')} ${i18n.t('menu:options.uninstall')}`, value: 'uninstall' },
        { name: `${ansis.yellow('?')} ${i18n.t('menu:options.help')}`, value: 'help' },
        new inquirer.Separator(),
        { name: `${ansis.red('✕')} ${i18n.t('menu:options.exit')}`, value: 'exit' },
      ],
    }])

    switch (action) {
      case 'init':
        await init()
        break
      case 'update':
        await update()
        break
      case 'config-mcp':
        await configMcp()
        break
      case 'uninstall':
        await uninstall()
        break
      case 'help':
        showHelp()
        break
      case 'exit':
        console.log(ansis.gray('再见！'))
        return // 退出循环和函数
    }

    // 操作完成后暂停，让用户看到结果
    console.log()
    await inquirer.prompt([{
      type: 'input',
      name: 'continue',
      message: ansis.gray('按 Enter 返回主菜单...'),
    }])
  }
}

function showHelp(): void {
  console.log()
  console.log(ansis.cyan.bold(i18n.t('menu:help.title')))
  console.log()

  // Development Workflows
  console.log(ansis.yellow.bold('  开发工作流:'))
  console.log(`  ${ansis.green('/ccg:workflow')}    完整6阶段开发工作流`)
  console.log(`  ${ansis.green('/ccg:plan')}        多模型协作规划（Phase 1-2）`)
  console.log(`  ${ansis.green('/ccg:execute')}     多模型协作执行（Phase 3-5）`)
  console.log(`  ${ansis.green('/ccg:frontend')}    ${i18n.t('menu:help.descriptions.frontend')}`)
  console.log(`  ${ansis.green('/ccg:backend')}     ${i18n.t('menu:help.descriptions.backend')}`)
  console.log(`  ${ansis.green('/ccg:feat')}        智能功能开发`)
  console.log(`  ${ansis.green('/ccg:analyze')}     ${i18n.t('menu:help.descriptions.analyze')}`)
  console.log(`  ${ansis.green('/ccg:debug')}       问题诊断 + 修复`)
  console.log(`  ${ansis.green('/ccg:optimize')}    性能优化`)
  console.log(`  ${ansis.green('/ccg:test')}        测试生成`)
  console.log(`  ${ansis.green('/ccg:review')}      ${i18n.t('menu:help.descriptions.review')}`)
  console.log()

  // OpenSpec Workflows
  console.log(ansis.yellow.bold('  OpenSpec 规范驱动:'))
  console.log(`  ${ansis.green('/ccg:spec-init')}      初始化 OpenSpec 环境`)
  console.log(`  ${ansis.green('/ccg:spec-research')} 需求研究 → 约束集`)
  console.log(`  ${ansis.green('/ccg:spec-plan')}     多模型分析 → 零决策计划`)
  console.log(`  ${ansis.green('/ccg:spec-impl')}     规范驱动实现`)
  console.log(`  ${ansis.green('/ccg:spec-review')}   归档前双模型审查`)
  console.log()

  // Git Tools
  console.log(ansis.yellow.bold('  Git 工具:'))
  console.log(`  ${ansis.green('/ccg:commit')}      ${i18n.t('menu:help.descriptions.commit')}`)
  console.log(`  ${ansis.green('/ccg:rollback')}    ${i18n.t('menu:help.descriptions.rollback')}`)
  console.log(`  ${ansis.green('/ccg:clean-branches')} 清理已合并分支`)
  console.log(`  ${ansis.green('/ccg:worktree')}    Git Worktree 管理`)
  console.log()

  // Project Init
  console.log(ansis.yellow.bold('  项目管理:'))
  console.log(`  ${ansis.green('/ccg:init')}        初始化项目 CLAUDE.md`)
  console.log()

  console.log(ansis.gray(i18n.t('menu:help.hint')))
  console.log()
}

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
    console.log(ansis.yellow('⚠️  检测到你是通过 npm 全局安装的'))
    console.log()
    console.log('完整卸载需要两步：')
    console.log(`  ${ansis.cyan('1. 移除工作流文件')} (即将执行)`)
    console.log(`  ${ansis.cyan('2. 卸载 npm 全局包')} (需要手动执行)`)
    console.log()
  }

  // Confirm uninstall
  const { confirm } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirm',
    message: isGlobalInstall ? '继续卸载工作流文件？' : i18n.t('menu:uninstall.confirm'),
    default: false,
  }])

  if (!confirm) {
    console.log(ansis.gray(i18n.t('menu:uninstall.cancelled')))
    return
  }

  // Ask about ace-tool
  const { removeAceTool } = await inquirer.prompt([{
    type: 'confirm',
    name: 'removeAceTool',
    message: i18n.t('menu:uninstall.alsoRemoveAceTool'),
    default: false,
  }])

  console.log()
  console.log(ansis.yellow(i18n.t('menu:uninstall.uninstalling')))

  // Uninstall workflows
  const installDir = join(homedir(), '.claude')
  const result = await uninstallWorkflows(installDir)

  if (result.success) {
    console.log(ansis.green('✅ 工作流文件已移除'))

    if (result.removedCommands.length > 0) {
      console.log()
      console.log(ansis.cyan(i18n.t('menu:uninstall.removedCommands')))
      for (const cmd of result.removedCommands) {
        console.log(`  ${ansis.gray('•')} /ccg:${cmd}`)
      }
    }

    if (result.removedAgents.length > 0) {
      console.log()
      console.log(ansis.cyan('已移除子智能体:'))
      for (const agent of result.removedAgents) {
        console.log(`  ${ansis.gray('•')} ${agent}`)
      }
    }

    if (result.removedSkills.length > 0) {
      console.log()
      console.log(ansis.cyan('已移除 Skills:'))
      console.log(`  ${ansis.gray('•')} multi-model-collaboration`)
    }

    if (result.removedBin) {
      console.log()
      console.log(ansis.cyan('已移除二进制文件:'))
      console.log(`  ${ansis.gray('•')} codeagent-wrapper`)
    }

    // If globally installed, show instructions to uninstall npm package
    if (isGlobalInstall) {
      console.log()
      console.log(ansis.yellow.bold('🔸 最后一步：卸载 npm 全局包'))
      console.log()
      console.log('请在新的终端窗口中运行：')
      console.log()
      console.log(ansis.cyan.bold('  npm uninstall -g ccg-workflow'))
      console.log()
      console.log(ansis.gray('(完成后 ccg 命令将彻底移除)'))
    }
  }
  else {
    console.log(ansis.red(i18n.t('menu:uninstall.failed')))
    for (const error of result.errors) {
      console.log(ansis.red(`  ${error}`))
    }
  }

  // Remove ace-tool if requested
  if (removeAceTool) {
    const aceResult = await uninstallAceTool()
    if (aceResult.success) {
      console.log(ansis.green(i18n.t('menu:uninstall.removedAceTool')))
    }
    else {
      console.log(ansis.red(aceResult.message))
    }
  }

  console.log()
}
