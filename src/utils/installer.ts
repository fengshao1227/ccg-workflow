import type { AceToolConfig, InstallResult, WorkflowConfig } from '../types'
import { homedir } from 'node:os'
import fs from 'fs-extra'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'pathe'
import { backupClaudeCodeConfig, buildMcpServerConfig, fixWindowsMcpConfig, mergeMcpServers, readClaudeCodeConfig, writeClaudeCodeConfig } from './mcp'
import { isWindows } from './platform'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Find package root by looking for package.json
function findPackageRoot(startDir: string): string {
  let dir = startDir
  for (let i = 0; i < 5; i++) {
    if (fs.existsSync(join(dir, 'package.json'))) {
      return dir
    }
    dir = dirname(dir)
  }
  return startDir
}

const PACKAGE_ROOT = findPackageRoot(__dirname)

// Workflow configurations
const WORKFLOW_CONFIGS: WorkflowConfig[] = [
  {
    id: 'dev',
    name: '完整开发工作流',
    nameEn: 'Full Development Workflow',
    category: 'development',
    commands: ['dev'],
    defaultSelected: true,
    order: 1,
    description: '完整6阶段开发工作流（Prompt增强→上下文检索→多模型分析→原型生成→代码实施→审计交付）',
    descriptionEn: 'Full 6-phase development workflow (Prompt enhancement → Context retrieval → Multi-model analysis → Prototype → Implementation → Audit)',
  },
  {
    id: 'code',
    name: '智能代码生成',
    nameEn: 'Smart Code Generation',
    category: 'development',
    commands: ['code'],
    defaultSelected: true,
    order: 2,
    description: '多模型代码生成（智能路由：前端→Gemini，后端→Codex）',
    descriptionEn: 'Multi-model code generation (smart routing: frontend→Gemini, backend→Codex)',
  },
  {
    id: 'frontend',
    name: '前端任务',
    nameEn: 'Frontend Tasks',
    category: 'development',
    commands: ['frontend'],
    defaultSelected: true,
    order: 3,
    description: '前端/UI/样式任务，自动路由到 Gemini',
    descriptionEn: 'Frontend/UI/style tasks, auto-route to Gemini',
  },
  {
    id: 'backend',
    name: '后端任务',
    nameEn: 'Backend Tasks',
    category: 'development',
    commands: ['backend'],
    defaultSelected: true,
    order: 4,
    description: '后端/逻辑/算法任务，自动路由到 Codex',
    descriptionEn: 'Backend/logic/algorithm tasks, auto-route to Codex',
  },
  {
    id: 'review',
    name: '代码审查',
    nameEn: 'Code Review',
    category: 'development',
    commands: ['review'],
    defaultSelected: true,
    order: 5,
    description: '双模型代码审查（Codex + Gemini 并行），无参数时自动审查 git diff',
    descriptionEn: 'Dual-model code review (Codex + Gemini parallel), auto-review git diff when no args',
  },
  {
    id: 'analyze',
    name: '技术分析',
    nameEn: 'Technical Analysis',
    category: 'development',
    commands: ['analyze'],
    defaultSelected: true,
    order: 6,
    description: '双模型技术分析（Codex + Gemini 并行），交叉验证后综合见解',
    descriptionEn: 'Dual-model technical analysis (Codex + Gemini parallel), comprehensive insights after cross-validation',
  },
  {
    id: 'enhance',
    name: 'Prompt 增强',
    nameEn: 'Prompt Enhancement',
    category: 'development',
    commands: ['enhance'],
    defaultSelected: true,
    order: 7,
    description: '使用 ace-tool enhance_prompt 优化 Prompt',
    descriptionEn: 'Optimize prompts using ace-tool enhance_prompt',
  },
  {
    id: 'debug',
    name: 'UltraThink 调试',
    nameEn: 'UltraThink Debug',
    category: 'development',
    commands: ['debug'],
    defaultSelected: false,
    order: 8,
    description: 'UltraThink 多模型调试（Codex 后端诊断 + Gemini 前端诊断）',
    descriptionEn: 'UltraThink multi-model debugging (Codex backend diagnosis + Gemini frontend diagnosis)',
  },
  {
    id: 'test',
    name: '多模型测试生成',
    nameEn: 'Multi-Model Test Generation',
    category: 'development',
    commands: ['test'],
    defaultSelected: false,
    order: 9,
    description: '多模型测试生成（Codex 后端测试 + Gemini 前端测试）',
    descriptionEn: 'Multi-model test generation (Codex backend tests + Gemini frontend tests)',
  },
  {
    id: 'bugfix',
    name: '质量门控修复',
    nameEn: 'Quality Gate Bugfix',
    category: 'development',
    commands: ['bugfix'],
    defaultSelected: false,
    order: 10,
    description: '质量门控修复（双模型交叉验证，90%+ 通过）',
    descriptionEn: 'Quality gate bugfix (dual-model cross-validation, 90%+ pass)',
  },
  {
    id: 'think',
    name: 'UltraThink 深度分析',
    nameEn: 'UltraThink Deep Analysis',
    category: 'development',
    commands: ['think'],
    defaultSelected: false,
    order: 11,
    description: 'UltraThink 深度分析（双模型并行分析 + 综合见解）',
    descriptionEn: 'UltraThink deep analysis (dual-model parallel analysis + comprehensive insights)',
  },
  {
    id: 'optimize',
    name: '多模型性能优化',
    nameEn: 'Multi-Model Optimization',
    category: 'development',
    commands: ['optimize'],
    defaultSelected: false,
    order: 12,
    description: '多模型性能优化（Codex 后端优化 + Gemini 前端优化）',
    descriptionEn: 'Multi-model performance optimization (Codex backend + Gemini frontend)',
  },
  {
    id: 'commit',
    name: 'Git 智能提交',
    nameEn: 'Git Smart Commit',
    category: 'git',
    commands: ['commit'],
    defaultSelected: true,
    order: 20,
    description: '仅用 Git 分析改动并自动生成 conventional commit 信息（可选 emoji）',
    descriptionEn: 'Git-only analysis to auto-generate conventional commit messages (optional emoji)',
  },
  {
    id: 'rollback',
    name: 'Git 交互式回滚',
    nameEn: 'Git Interactive Rollback',
    category: 'git',
    commands: ['rollback'],
    defaultSelected: true,
    order: 21,
    description: '交互式回滚 Git 分支到历史版本；列分支、列版本、二次确认后执行',
    descriptionEn: 'Interactive Git branch rollback; list branches, versions, confirm before execution',
  },
  {
    id: 'clean-branches',
    name: '清理 Git 分支',
    nameEn: 'Clean Git Branches',
    category: 'git',
    commands: ['clean-branches'],
    defaultSelected: true,
    order: 22,
    description: '安全查找并清理已合并或过期的 Git 分支，支持 dry-run 模式',
    descriptionEn: 'Safely find and clean merged or stale Git branches, supports dry-run mode',
  },
  {
    id: 'worktree',
    name: 'Git Worktree 管理',
    nameEn: 'Git Worktree Management',
    category: 'git',
    commands: ['worktree'],
    defaultSelected: false,
    order: 23,
    description: '管理 Git worktree，在项目平级的 ../.ccg/项目名/ 目录下创建',
    descriptionEn: 'Manage Git worktree, create in ../.ccg/project-name/ directory parallel to project',
  },
  {
    id: 'init-project',
    name: '项目 AI 上下文初始化',
    nameEn: 'Project AI Context Init',
    category: 'init',
    commands: ['init'],
    defaultSelected: true,
    order: 30,
    description: '初始化项目 AI 上下文，生成/更新根级与模块级 CLAUDE.md 索引',
    descriptionEn: 'Initialize project AI context, generate/update root and module level CLAUDE.md index',
  },
  {
    id: 'scan',
    name: '智能仓库扫描',
    nameEn: 'Smart Repository Scan',
    category: 'planning',
    commands: ['scan'],
    defaultSelected: true,
    order: 31,
    description: '智能仓库扫描 - 生成项目上下文报告（技术栈、API、数据模型、组件结构）',
    descriptionEn: 'Smart repository scan - generate project context report (tech stack, APIs, data models, components)',
  },
  {
    id: 'feat',
    name: '智能功能开发',
    nameEn: 'Smart Feature Development',
    category: 'planning',
    commands: ['feat'],
    defaultSelected: true,
    order: 32,
    description: '智能功能开发 - 自动规划、设计、实施（支持需求规划/讨论迭代/执行实施）',
    descriptionEn: 'Smart feature development - auto plan, design, implement (supports planning/iteration/execution modes)',
  },
]

export function getWorkflowConfigs(): WorkflowConfig[] {
  return WORKFLOW_CONFIGS.sort((a, b) => a.order - b.order)
}

export function getWorkflowById(id: string): WorkflowConfig | undefined {
  return WORKFLOW_CONFIGS.find(w => w.id === id)
}

export async function installWorkflows(
  workflowIds: string[],
  installDir: string,
  force = false,
): Promise<InstallResult> {
  const result: InstallResult = {
    success: true,
    installedCommands: [],
    installedPrompts: [],
    errors: [],
    configPath: '',
  }

  const commandsDir = join(installDir, 'commands', 'ccg')
  const ccgConfigDir = join(installDir, '.ccg') // v1.4.0: 配置目录
  const promptsDir = join(ccgConfigDir, 'prompts') // v1.4.0: prompts 移到配置目录

  await fs.ensureDir(commandsDir)
  await fs.ensureDir(ccgConfigDir)
  await fs.ensureDir(promptsDir)

  // Get template source directory (relative to this package)
  const templateDir = join(PACKAGE_ROOT, 'templates')

  // Install commands
  for (const workflowId of workflowIds) {
    const workflow = getWorkflowById(workflowId)
    if (!workflow) {
      result.errors.push(`Unknown workflow: ${workflowId}`)
      continue
    }

    for (const cmd of workflow.commands) {
      const srcFile = join(templateDir, 'commands', `${cmd}.md`)
      const destFile = join(commandsDir, `${cmd}.md`)

      try {
        if (await fs.pathExists(srcFile)) {
          if (force || !(await fs.pathExists(destFile))) {
            await fs.copy(srcFile, destFile)
            result.installedCommands.push(cmd)
          }
        }
        else {
          // If template doesn't exist, create placeholder
          const placeholder = `---
description: "${workflow.descriptionEn}"
---

# /ccg:${cmd}

${workflow.description}

> This command is part of CCG multi-model collaboration system.
`
          await fs.writeFile(destFile, placeholder, 'utf-8')
          result.installedCommands.push(cmd)
        }
      }
      catch (error) {
        result.errors.push(`Failed to install ${cmd}: ${error}`)
        result.success = false
      }
    }
  }

  // Install shared-config.md to config directory (v1.4.0)
  const sharedConfigSrcFile = join(templateDir, 'config', 'shared-config.md')
  const sharedConfigDestFile = join(ccgConfigDir, 'shared-config.md')
  if (await fs.pathExists(sharedConfigSrcFile)) {
    if (force || !(await fs.pathExists(sharedConfigDestFile))) {
      await fs.copy(sharedConfigSrcFile, sharedConfigDestFile)
    }
  }

  // Install agents directory (subagents - should go to ~/.claude/agents/ccg/)
  const agentsSrcDir = join(templateDir, 'commands', 'agents')
  const agentsDestDir = join(installDir, 'agents', 'ccg')
  if (await fs.pathExists(agentsSrcDir)) {
    try {
      await fs.ensureDir(agentsDestDir)
      const agentFiles = await fs.readdir(agentsSrcDir)
      for (const file of agentFiles) {
        if (file.endsWith('.md')) {
          const srcFile = join(agentsSrcDir, file)
          const destFile = join(agentsDestDir, file)
          if (force || !(await fs.pathExists(destFile))) {
            await fs.copy(srcFile, destFile)
          }
        }
      }
    }
    catch (error) {
      result.errors.push(`Failed to install agents: ${error}`)
      result.success = false
    }
  }

  // Install prompts (codex, gemini, claude role definitions)
  const promptsTemplateDir = join(templateDir, 'prompts')
  if (await fs.pathExists(promptsTemplateDir)) {
    const modelDirs = ['codex', 'gemini', 'claude']
    for (const model of modelDirs) {
      const srcModelDir = join(promptsTemplateDir, model)
      const destModelDir = join(promptsDir, model)

      if (await fs.pathExists(srcModelDir)) {
        try {
          await fs.ensureDir(destModelDir)
          const files = await fs.readdir(srcModelDir)
          for (const file of files) {
            if (file.endsWith('.md')) {
              const srcFile = join(srcModelDir, file)
              const destFile = join(destModelDir, file)
              if (force || !(await fs.pathExists(destFile))) {
                await fs.copy(srcFile, destFile)
                result.installedPrompts.push(`${model}/${file.replace('.md', '')}`)
              }
            }
          }
        }
        catch (error) {
          result.errors.push(`Failed to install ${model} prompts: ${error}`)
          result.success = false
        }
      }
    }
  }

  // Install codeagent-wrapper binary
  try {
    const binDir = join(installDir, 'bin')
    await fs.ensureDir(binDir)

    // Detect platform and select appropriate binary
    const platform = process.platform
    const arch = process.arch
    let binaryName: string

    if (platform === 'darwin') {
      binaryName = arch === 'arm64' ? 'codeagent-wrapper-darwin-arm64' : 'codeagent-wrapper-darwin-amd64'
    }
    else if (platform === 'linux') {
      binaryName = 'codeagent-wrapper-linux-amd64'
    }
    else if (platform === 'win32') {
      binaryName = 'codeagent-wrapper-windows-amd64.exe'
    }
    else {
      result.errors.push(`Unsupported platform: ${platform}`)
      result.success = false
      result.configPath = commandsDir
      return result
    }

    const srcBinary = join(PACKAGE_ROOT, 'bin', binaryName)
    const destBinary = join(binDir, platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper')

    if (await fs.pathExists(srcBinary)) {
      await fs.copy(srcBinary, destBinary)
      // Set executable permission on Unix-like systems
      if (platform !== 'win32') {
        await fs.chmod(destBinary, 0o755)
      }

      // Verify installation by running --version
      try {
        const { execSync } = await import('node:child_process')
        execSync(`"${destBinary}" --version`, { stdio: 'pipe' })
        result.binPath = binDir
        result.binInstalled = true
      }
      catch (verifyError) {
        result.errors.push(`Binary verification failed: ${verifyError}`)
        result.success = false
      }
    }
    else {
      result.errors.push(`Binary not found in package: ${binaryName}`)
      result.success = false
    }
  }
  catch (error) {
    result.errors.push(`Failed to install codeagent-wrapper: ${error}`)
    result.success = false
  }

  result.configPath = commandsDir
  return result
}

// Removed: getClaudeCodeConfigPath - now imported from './mcp'

/**
 * Install and configure ace-tool MCP for Claude Code
 * Writes to ~/.claude.json (the correct config file for Claude Code CLI)
 */
export interface UninstallResult {
  success: boolean
  removedCommands: string[]
  removedPrompts: string[]
  errors: string[]
}

/**
 * Uninstall workflows by removing their command files
 */
export async function uninstallWorkflows(installDir: string): Promise<UninstallResult> {
  const result: UninstallResult = {
    success: true,
    removedCommands: [],
    removedPrompts: [],
    errors: [],
  }

  const commandsDir = join(installDir, 'commands', 'ccg')
  const promptsDir = join(installDir, 'prompts', 'ccg')

  // Remove CCG commands directory
  if (await fs.pathExists(commandsDir)) {
    try {
      const files = await fs.readdir(commandsDir)
      for (const file of files) {
        if (file.endsWith('.md')) {
          await fs.remove(join(commandsDir, file))
          result.removedCommands.push(file.replace('.md', ''))
        }
      }
      // Remove the directory if empty
      const remaining = await fs.readdir(commandsDir)
      if (remaining.length === 0) {
        await fs.remove(commandsDir)
      }
    }
    catch (error) {
      result.errors.push(`Failed to remove commands: ${error}`)
      result.success = false
    }
  }

  // Remove CCG prompts directory
  if (await fs.pathExists(promptsDir)) {
    try {
      const files = await fs.readdir(promptsDir)
      for (const file of files) {
        await fs.remove(join(promptsDir, file))
        result.removedPrompts.push(file)
      }
      // Remove the directory if empty
      const remaining = await fs.readdir(promptsDir)
      if (remaining.length === 0) {
        await fs.remove(promptsDir)
      }
    }
    catch (error) {
      result.errors.push(`Failed to remove prompts: ${error}`)
      result.success = false
    }
  }

  return result
}

/**
 * Uninstall ace-tool MCP configuration from ~/.claude.json
 */
export async function uninstallAceTool(): Promise<{ success: boolean, message: string }> {
  try {
    const existingConfig = await readClaudeCodeConfig()

    if (!existingConfig) {
      return {
        success: true,
        message: 'No ~/.claude.json found, nothing to remove',
      }
    }

    // Check if ace-tool exists
    if (!existingConfig.mcpServers || !existingConfig.mcpServers['ace-tool']) {
      return {
        success: true,
        message: 'ace-tool MCP not found in config',
      }
    }

    // Backup before modifying
    await backupClaudeCodeConfig()

    // Remove ace-tool from mcpServers
    delete existingConfig.mcpServers['ace-tool']

    // Write back
    await writeClaudeCodeConfig(existingConfig)

    return {
      success: true,
      message: 'ace-tool MCP removed from ~/.claude.json',
    }
  }
  catch (error) {
    return {
      success: false,
      message: `Failed to uninstall ace-tool: ${error}`,
    }
  }
}

export async function installAceTool(config: AceToolConfig): Promise<{ success: boolean, message: string, configPath?: string }> {
  const { baseUrl, token } = config

  try {
    // Read existing config or create new one
    let existingConfig = await readClaudeCodeConfig()

    if (!existingConfig) {
      existingConfig = { mcpServers: {} }
    }

    // Backup before modifying (if config exists)
    if (existingConfig.mcpServers && Object.keys(existingConfig.mcpServers).length > 0) {
      const backupPath = await backupClaudeCodeConfig()
      if (backupPath) {
        console.log(`  ✓ Backup created: ${backupPath}`)
      }
    }

    // Build args array (with -y flag for npx auto-confirm)
    const args = ['-y', 'ace-tool@latest']
    if (baseUrl) {
      args.push('--base-url', baseUrl)
    }
    if (token) {
      args.push('--token', token)
    }

    // Create base ace-tool MCP server config
    const aceToolConfig = buildMcpServerConfig({
      type: 'stdio' as const,
      command: 'npx',
      args,
    })

    // Merge new server into existing config
    let mergedConfig = mergeMcpServers(existingConfig, {
      'ace-tool': aceToolConfig,
    })

    // Apply Windows fixes if needed
    if (isWindows()) {
      mergedConfig = fixWindowsMcpConfig(mergedConfig)
      console.log('  ✓ Applied Windows MCP configuration fixes')
    }

    // Write config back (preserve all other fields)
    await writeClaudeCodeConfig(mergedConfig)

    return {
      success: true,
      message: isWindows()
        ? 'ace-tool MCP configured successfully with Windows compatibility'
        : 'ace-tool MCP configured successfully',
      configPath: join(homedir(), '.claude.json'),
    }
  }
  catch (error) {
    return {
      success: false,
      message: `Failed to configure ace-tool: ${error}`,
    }
  }
}
