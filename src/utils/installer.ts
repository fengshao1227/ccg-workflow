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

// All available commands (14 total after cleanup)
const ALL_COMMANDS = [
  'workflow', // 完整6阶段开发工作流
  'frontend', // 前端专项（Gemini主导）
  'backend', // 后端专项（Codex主导）
  'feat', // 智能功能开发
  'analyze', // 技术分析
  'debug', // 问题诊断+修复
  'optimize', // 性能优化
  'test', // 测试生成
  'review', // 代码审查
  'init', // 初始化 CLAUDE.md
  'commit', // Git 智能提交
  'rollback', // Git 回滚
  'clean-branches', // Git 清理分支
  'worktree', // Git Worktree
] as const

// Workflow configurations (for compatibility with existing code)
const WORKFLOW_CONFIGS: WorkflowConfig[] = [
  {
    id: 'workflow',
    name: '完整开发工作流',
    nameEn: 'Full Development Workflow',
    category: 'development',
    commands: ['workflow'],
    defaultSelected: true,
    order: 1,
    description: '完整6阶段开发工作流（研究→构思→计划→执行→优化→评审）',
    descriptionEn: 'Full 6-phase development workflow',
  },
  {
    id: 'frontend',
    name: '前端专项',
    nameEn: 'Frontend Tasks',
    category: 'development',
    commands: ['frontend'],
    defaultSelected: true,
    order: 2,
    description: '前端专项任务（Gemini主导，更快更精准）',
    descriptionEn: 'Frontend tasks (Gemini-led, faster)',
  },
  {
    id: 'backend',
    name: '后端专项',
    nameEn: 'Backend Tasks',
    category: 'development',
    commands: ['backend'],
    defaultSelected: true,
    order: 3,
    description: '后端专项任务（Codex主导，更快更精准）',
    descriptionEn: 'Backend tasks (Codex-led, faster)',
  },
  {
    id: 'feat',
    name: '智能功能开发',
    nameEn: 'Smart Feature Development',
    category: 'development',
    commands: ['feat'],
    defaultSelected: true,
    order: 4,
    description: '智能功能开发 - 自动规划、设计、实施',
    descriptionEn: 'Smart feature development - auto plan, design, implement',
  },
  {
    id: 'analyze',
    name: '技术分析',
    nameEn: 'Technical Analysis',
    category: 'development',
    commands: ['analyze'],
    defaultSelected: true,
    order: 5,
    description: '双模型技术分析，仅分析不修改代码',
    descriptionEn: 'Dual-model technical analysis, analysis only',
  },
  {
    id: 'debug',
    name: '问题诊断',
    nameEn: 'Debug',
    category: 'development',
    commands: ['debug'],
    defaultSelected: true,
    order: 6,
    description: '多模型诊断 + 修复',
    descriptionEn: 'Multi-model diagnosis + fix',
  },
  {
    id: 'optimize',
    name: '性能优化',
    nameEn: 'Performance Optimization',
    category: 'development',
    commands: ['optimize'],
    defaultSelected: true,
    order: 7,
    description: '多模型性能优化',
    descriptionEn: 'Multi-model performance optimization',
  },
  {
    id: 'test',
    name: '测试生成',
    nameEn: 'Test Generation',
    category: 'development',
    commands: ['test'],
    defaultSelected: true,
    order: 8,
    description: '智能路由测试生成',
    descriptionEn: 'Smart routing test generation',
  },
  {
    id: 'review',
    name: '代码审查',
    nameEn: 'Code Review',
    category: 'development',
    commands: ['review'],
    defaultSelected: true,
    order: 9,
    description: '双模型代码审查，无参数时自动审查 git diff',
    descriptionEn: 'Dual-model code review, auto-review git diff when no args',
  },
  {
    id: 'enhance',
    name: 'Prompt 增强',
    nameEn: 'Prompt Enhancement',
    category: 'development',
    commands: ['enhance'],
    defaultSelected: true,
    order: 9.5,
    description: 'ace-tool Prompt 增强工具',
    descriptionEn: 'ace-tool prompt enhancement',
  },
  {
    id: 'init-project',
    name: '项目初始化',
    nameEn: 'Project Init',
    category: 'init',
    commands: ['init'],
    defaultSelected: true,
    order: 10,
    description: '初始化项目 AI 上下文，生成 CLAUDE.md',
    descriptionEn: 'Initialize project AI context, generate CLAUDE.md',
  },
  {
    id: 'commit',
    name: 'Git 提交',
    nameEn: 'Git Commit',
    category: 'git',
    commands: ['commit'],
    defaultSelected: true,
    order: 20,
    description: '智能生成 conventional commit 信息',
    descriptionEn: 'Smart conventional commit message generation',
  },
  {
    id: 'rollback',
    name: 'Git 回滚',
    nameEn: 'Git Rollback',
    category: 'git',
    commands: ['rollback'],
    defaultSelected: true,
    order: 21,
    description: '交互式回滚分支到历史版本',
    descriptionEn: 'Interactive rollback to historical version',
  },
  {
    id: 'clean-branches',
    name: 'Git 清理分支',
    nameEn: 'Git Clean Branches',
    category: 'git',
    commands: ['clean-branches'],
    defaultSelected: true,
    order: 22,
    description: '安全清理已合并或过期分支',
    descriptionEn: 'Safely clean merged or stale branches',
  },
  {
    id: 'worktree',
    name: 'Git Worktree',
    nameEn: 'Git Worktree',
    category: 'git',
    commands: ['worktree'],
    defaultSelected: true,
    order: 23,
    description: '管理 Git worktree',
    descriptionEn: 'Manage Git worktree',
  },
]

export function getWorkflowConfigs(): WorkflowConfig[] {
  return WORKFLOW_CONFIGS.sort((a, b) => a.order - b.order)
}

export function getWorkflowById(id: string): WorkflowConfig | undefined {
  return WORKFLOW_CONFIGS.find(w => w.id === id)
}

/**
 * Get all command IDs for installation
 * No more presets - always install all commands
 */
export function getAllCommandIds(): string[] {
  return WORKFLOW_CONFIGS.map(w => w.id)
}

/**
 * @deprecated Use getAllCommandIds() instead
 * Kept for backward compatibility
 */
export const WORKFLOW_PRESETS = {
  full: {
    name: '完整',
    nameEn: 'Full',
    description: '全部命令（15个）',
    descriptionEn: 'All commands (15)',
    workflows: WORKFLOW_CONFIGS.map(w => w.id),
  },
}

export type WorkflowPreset = keyof typeof WORKFLOW_PRESETS

export function getWorkflowPreset(preset: WorkflowPreset): string[] {
  return [...WORKFLOW_PRESETS[preset].workflows]
}

/**
 * Replace template variables in content based on user configuration
 * This injects model routing configs at install time
 * Note: MCP tool names are now hardcoded to ace-tool in templates
 */
function injectConfigVariables(content: string, config: {
  routing?: {
    mode?: string
    frontend?: { models?: string[], primary?: string }
    backend?: { models?: string[], primary?: string }
    review?: { models?: string[] }
  }
  liteMode?: boolean
}): string {
  let processed = content

  // Model routing injection
  const routing = config.routing || {}

  // Frontend models
  const frontendModels = routing.frontend?.models || ['gemini']
  const frontendPrimary = routing.frontend?.primary || 'gemini'
  processed = processed.replace(/\{\{FRONTEND_MODELS\}\}/g, JSON.stringify(frontendModels))
  processed = processed.replace(/\{\{FRONTEND_PRIMARY\}\}/g, frontendPrimary)

  // Backend models
  const backendModels = routing.backend?.models || ['codex']
  const backendPrimary = routing.backend?.primary || 'codex'
  processed = processed.replace(/\{\{BACKEND_MODELS\}\}/g, JSON.stringify(backendModels))
  processed = processed.replace(/\{\{BACKEND_PRIMARY\}\}/g, backendPrimary)

  // Review models
  const reviewModels = routing.review?.models || ['codex', 'gemini']
  processed = processed.replace(/\{\{REVIEW_MODELS\}\}/g, JSON.stringify(reviewModels))

  // Routing mode
  const routingMode = routing.mode || 'smart'
  processed = processed.replace(/\{\{ROUTING_MODE\}\}/g, routingMode)

  // Lite mode flag for codeagent-wrapper
  // If liteMode is true, inject "--lite" flag
  const liteModeFlag = config.liteMode ? '--lite ' : ''
  processed = processed.replace(/\{\{LITE_MODE_FLAG\}\}/g, liteModeFlag)

  return processed
}

/**
 * Normalize path for the current platform
 * - Windows: C:\Users\zlb (Native Windows path, for PowerShell/CMD compatibility)
 * - Unix: /Users/zlb
 */
function normalizePath(p: string): string {
  if (isWindows()) {
    // Return native Windows path (backslashes)
    // This is critical for PowerShell execution which fails with /c/Users/... style paths
    return p.replace(/\//g, '\\')
  }
  return p
}

/**
 * Convert Windows path to Git Bash compatible format
 * C:\Users\zlb → /c/Users/zlb
 * D:\code → /d/code
 */
function convertToGitBashPath(windowsPath: string): string {
  if (!isWindows()) {
    return windowsPath
  }

  // Normalize to forward slashes first
  let path = windowsPath.replace(/\\/g, '/')

  // Convert drive letter: C:/Users/... → /c/Users/...
  // Match pattern: [A-Z]:/ at the start
  path = path.replace(/^([A-Z]):/i, (_, drive) => `/${drive.toLowerCase()}`)

  return path
}

/**
 * Replace ~ paths in template content with absolute paths
 * This fixes Windows multi-user path resolution issues
 *
 * IMPORTANT: Always use forward slashes (/) for cross-platform compatibility.
 * Windows Git Bash requires forward slashes in heredoc (backslashes get escaped).
 * PowerShell and CMD also support forward slashes for most commands.
 */
function replaceHomePathsInTemplate(content: string, installDir: string): string {
  // Get absolute paths for replacement
  const userHome = homedir()
  const ccgDir = join(installDir, '.ccg')
  const binDir = join(installDir, 'bin')
  const claudeDir = installDir // ~/.claude

  // IMPORTANT: Always use forward slashes for cross-platform compatibility
  // Git Bash on Windows requires forward slashes in heredoc (backslashes get escaped)
  // PowerShell and CMD also support forward slashes for most commands
  const normalizePath = (path: string) => path.replace(/\\/g, '/')

  let processed = content

  // Order matters: replace longer patterns first to avoid partial matches
  // 1. Replace ~/.claude/.ccg with absolute path (longest match first)
  processed = processed.replace(/~\/\.claude\/\.ccg/g, normalizePath(ccgDir))

  // 2. Replace ~/.claude/bin/codeagent-wrapper with absolute path + .exe on Windows
  //    CRITICAL: Windows Git Bash requires explicit .exe extension
  const wrapperName = isWindows() ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'
  const wrapperPath = `${normalizePath(binDir)}/${wrapperName}`
  processed = processed.replace(/~\/\.claude\/bin\/codeagent-wrapper/g, wrapperPath)

  // 3. Replace ~/.claude/bin with absolute path (for other binaries)
  processed = processed.replace(/~\/\.claude\/bin/g, normalizePath(binDir))

  // 4. Replace ~/.claude with absolute path
  processed = processed.replace(/~\/\.claude/g, normalizePath(claudeDir))

  // 5. Replace remaining ~/ patterns with user home
  processed = processed.replace(/~\//g, `${normalizePath(userHome)}/`)

  return processed
}

export async function installWorkflows(
  workflowIds: string[],
  installDir: string,
  force = false,
  config?: {
    routing?: {
      mode?: string
      frontend?: { models?: string[], primary?: string }
      backend?: { models?: string[], primary?: string }
      review?: { models?: string[] }
    }
    liteMode?: boolean
  },
): Promise<InstallResult> {
  // Default config
  const installConfig = {
    routing: config?.routing || {
      mode: 'smart',
      frontend: { models: ['gemini'], primary: 'gemini' },
      backend: { models: ['codex'], primary: 'codex' },
      review: { models: ['codex', 'gemini'] },
    },
    liteMode: config?.liteMode || false,
  }
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
            // Read template content, inject config variables, replace ~ paths, then write
            let templateContent = await fs.readFile(srcFile, 'utf-8')
            templateContent = injectConfigVariables(templateContent, installConfig)
            const processedContent = replaceHomePathsInTemplate(templateContent, installDir)
            await fs.writeFile(destFile, processedContent, 'utf-8')
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
            // Read template content, inject config variables, replace ~ paths, then write
            let templateContent = await fs.readFile(srcFile, 'utf-8')
            templateContent = injectConfigVariables(templateContent, installConfig)
            const processedContent = replaceHomePathsInTemplate(templateContent, installDir)
            await fs.writeFile(destFile, processedContent, 'utf-8')
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
                // Read template content, replace ~ paths, then write
                const templateContent = await fs.readFile(srcFile, 'utf-8')
                const processedContent = replaceHomePathsInTemplate(templateContent, installDir)
                await fs.writeFile(destFile, processedContent, 'utf-8')
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

  // Install skills (multi-model-collaboration, etc. - should go to ~/.claude/skills/)
  const skillsTemplateDir = join(templateDir, 'skills')
  const skillsDestDir = join(installDir, 'skills')
  if (await fs.pathExists(skillsTemplateDir)) {
    try {
      const skillDirs = await fs.readdir(skillsTemplateDir)
      for (const skillName of skillDirs) {
        const srcSkillDir = join(skillsTemplateDir, skillName)
        const destSkillDir = join(skillsDestDir, skillName)
        const stat = await fs.stat(srcSkillDir)
        if (stat.isDirectory()) {
          await fs.ensureDir(destSkillDir)
          const files = await fs.readdir(srcSkillDir)
          for (const file of files) {
            const srcFile = join(srcSkillDir, file)
            const destFile = join(destSkillDir, file)
            if (force || !(await fs.pathExists(destFile))) {
              const templateContent = await fs.readFile(srcFile, 'utf-8')
              const processedContent = replaceHomePathsInTemplate(templateContent, installDir)
              await fs.writeFile(destFile, processedContent, 'utf-8')
            }
          }
        }
      }
    }
    catch (error) {
      result.errors.push(`Failed to install skills: ${error}`)
      result.success = false
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
      binaryName = arch === 'arm64' ? 'codeagent-wrapper-linux-arm64' : 'codeagent-wrapper-linux-amd64'
    }
    else if (platform === 'win32') {
      binaryName = arch === 'arm64' ? 'codeagent-wrapper-windows-arm64.exe' : 'codeagent-wrapper-windows-amd64.exe'
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
  removedAgents: string[]
  removedSkills: string[]
  removedBin: boolean
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
    removedAgents: [],
    removedSkills: [],
    removedBin: false,
    errors: [],
  }

  const commandsDir = join(installDir, 'commands', 'ccg')
  const promptsDir = join(installDir, '.ccg', 'prompts')
  const agentsDir = join(installDir, 'agents', 'ccg')
  const skillsDir = join(installDir, 'skills', 'multi-model-collaboration')
  const binDir = join(installDir, 'bin')
  const ccgConfigDir = join(installDir, '.ccg')

  // Remove CCG commands directory
  if (await fs.pathExists(commandsDir)) {
    try {
      // Get list for reporting
      const files = await fs.readdir(commandsDir)
      for (const file of files) {
        if (file.endsWith('.md')) {
          result.removedCommands.push(file.replace('.md', ''))
        }
      }

      // Force remove the entire directory
      await fs.remove(commandsDir)
    }
    catch (error) {
      result.errors.push(`Failed to remove commands directory: ${error}`)
      result.success = false
    }
  }

  // Remove CCG agents directory
  if (await fs.pathExists(agentsDir)) {
    try {
      // Get list for reporting
      const files = await fs.readdir(agentsDir)
      for (const file of files) {
        result.removedAgents.push(file.replace('.md', ''))
      }

      // Force remove the entire directory
      await fs.remove(agentsDir)
    }
    catch (error) {
      result.errors.push(`Failed to remove agents directory: ${error}`)
      result.success = false
    }
  }

  // Remove CCG skills directory
  if (await fs.pathExists(skillsDir)) {
    try {
      const files = await fs.readdir(skillsDir)
      for (const file of files) {
        result.removedSkills.push(file)
      }
      // Try to remove parent skills directory if it's the only skill
      await fs.remove(skillsDir)
    }
    catch (error) {
      result.errors.push(`Failed to remove skills: ${error}`)
      result.success = false
    }
  }

  // Remove CCG prompts directory (in .ccg/) - handled by removing .ccg dir below

  // Remove codeagent-wrapper binary
  if (await fs.pathExists(binDir)) {
    try {
      const wrapperName = process.platform === 'win32' ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'
      const wrapperPath = join(binDir, wrapperName)
      if (await fs.pathExists(wrapperPath)) {
        await fs.remove(wrapperPath)
        result.removedBin = true
      }
    }
    catch (error) {
      result.errors.push(`Failed to remove binary: ${error}`)
      result.success = false
    }
  }

  // Remove .ccg config directory (Force remove)
  if (await fs.pathExists(ccgConfigDir)) {
    try {
      await fs.remove(ccgConfigDir)
      result.removedPrompts.push('ALL_PROMPTS_AND_CONFIGS')
    }
    catch (error) {
      result.errors.push(`Failed to remove .ccg directory: ${error}`)
      // Don't mark as failure just for config, but good to know
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
