import ansis from 'ansis'
import inquirer from 'inquirer'
import { homedir } from 'node:os'
import { join } from 'pathe'
import { configMcp } from './config-mcp'
import { i18n } from '../i18n'
import { uninstallAceTool, uninstallWorkflows } from '../utils/installer'
import { init } from './init'
import { update } from './update'

export async function showMainMenu(): Promise<void> {
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
      console.log(ansis.gray('Goodbye!'))
      break
  }
}

function showHelp(): void {
  console.log()
  console.log(ansis.cyan.bold(i18n.t('menu:help.title')))
  console.log()
  console.log(`  ${ansis.green('/ccg:dev')}         ${i18n.t('menu:help.descriptions.dev')}`)
  console.log(`  ${ansis.green('/ccg:frontend')}    ${i18n.t('menu:help.descriptions.frontend')}`)
  console.log(`  ${ansis.green('/ccg:backend')}     ${i18n.t('menu:help.descriptions.backend')}`)
  console.log(`  ${ansis.green('/ccg:review')}      ${i18n.t('menu:help.descriptions.review')}`)
  console.log(`  ${ansis.green('/ccg:analyze')}     ${i18n.t('menu:help.descriptions.analyze')}`)
  console.log(`  ${ansis.green('/ccg:commit')}      ${i18n.t('menu:help.descriptions.commit')}`)
  console.log(`  ${ansis.green('/ccg:rollback')}    ${i18n.t('menu:help.descriptions.rollback')}`)
  console.log()
  console.log(ansis.gray(i18n.t('menu:help.hint')))
  console.log()
}

async function uninstall(): Promise<void> {
  console.log()

  // Confirm uninstall
  const { confirm } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirm',
    message: i18n.t('menu:uninstall.confirm'),
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
    console.log(ansis.green(i18n.t('menu:uninstall.success')))

    if (result.removedCommands.length > 0) {
      console.log()
      console.log(ansis.cyan(i18n.t('menu:uninstall.removedCommands')))
      for (const cmd of result.removedCommands) {
        console.log(`  ${ansis.gray('•')} /ccg:${cmd}`)
      }
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
