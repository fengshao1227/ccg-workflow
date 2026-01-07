import ansis from 'ansis'
import inquirer from 'inquirer'
import { i18n } from '../i18n'
import { installAceTool, uninstallAceTool } from '../utils/installer'

/**
 * Configure ace-tool MCP after installation
 *
 * This command allows users to configure ace-tool Token if they skipped it during initial installation.
 */
export async function configMcp(): Promise<void> {
  console.log()
  console.log(ansis.cyan.bold(`  配置 ace-tool MCP`))
  console.log()

  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: '选择操作',
    choices: [
      { name: `${ansis.green('➜')} 安装/更新 ace-tool MCP`, value: 'install' },
      { name: `${ansis.red('✕')} 卸载 ace-tool MCP`, value: 'uninstall' },
      new inquirer.Separator(),
      { name: `${ansis.gray('返回')}`, value: 'cancel' },
    ],
  }])

  if (action === 'cancel') {
    return
  }

  if (action === 'uninstall') {
    await handleUninstall()
    return
  }

  // Install/Update ace-tool
  console.log()
  console.log(ansis.cyan(`📖 获取 ace-tool 访问方式：`))
  console.log(`   ${ansis.gray('•')} ${ansis.cyan('官方服务')}: ${ansis.underline('https://augmentcode.com/')}`)
  console.log(`   ${ansis.gray('•')} ${ansis.cyan('中转服务')} ${ansis.yellow('(无需注册)')}: ${ansis.underline('https://linux.do/t/topic/1291730')}`)
  console.log()

  const aceAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'baseUrl',
      message: `Base URL ${ansis.gray('(使用中转服务时必填，官方服务留空)')}`,
    },
    {
      type: 'password',
      name: 'token',
      message: `Token ${ansis.gray('(必填)')}`,
      validate: (input: string) => input.trim() !== '' || '请输入 Token',
    },
  ])

  console.log()
  console.log(ansis.yellow('⏳ 正在配置 ace-tool MCP...'))
  console.log()

  const result = await installAceTool({
    baseUrl: aceAnswers.baseUrl?.trim() || undefined,
    token: aceAnswers.token.trim(),
  })

  if (result.success) {
    console.log(ansis.green('✓ ace-tool MCP 配置成功！'))
    if (result.configPath) {
      console.log(ansis.gray(`  配置文件: ${result.configPath}`))
    }
    console.log()
    console.log(ansis.cyan('💡 提示：'))
    console.log(ansis.gray('  1. 重启 Claude Code CLI 使配置生效'))
    console.log(ansis.gray('  2. 运行 /ccg:dev 命令测试 MCP 功能'))
  }
  else {
    console.log(ansis.red('✗ ace-tool MCP 配置失败'))
    console.log(ansis.gray(`  错误信息: ${result.message}`))
  }

  console.log()
}

async function handleUninstall(): Promise<void> {
  console.log()

  const { confirm } = await inquirer.prompt([{
    type: 'confirm',
    name: 'confirm',
    message: '确定要卸载 ace-tool MCP 吗？',
    default: false,
  }])

  if (!confirm) {
    console.log(ansis.gray('已取消'))
    return
  }

  console.log()
  console.log(ansis.yellow('⏳ 正在卸载 ace-tool MCP...'))

  const result = await uninstallAceTool()

  if (result.success) {
    console.log(ansis.green('✓ ace-tool MCP 已卸载'))
    console.log()
  }
  else {
    console.log(ansis.red('✗ 卸载失败'))
    console.log(ansis.gray(`  错误信息: ${result.message}`))
    console.log()
  }
}
