import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import fs from 'fs-extra'
import { dirname, join } from 'pathe'
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

export const PACKAGE_ROOT = findPackageRoot(__dirname)

// ═══════════════════════════════════════════════════════
// MCP provider registry — adding a new provider = 1 line
// ═══════════════════════════════════════════════════════

const MCP_PROVIDERS: Record<string, { tool: string, param: string }> = {
  'ace-tool': { tool: 'mcp__ace-tool__search_context', param: 'query' },
  'ace-tool-rs': { tool: 'mcp__ace-tool__search_context', param: 'query' },
  'contextweaver': { tool: 'mcp__contextweaver__codebase-retrieval', param: 'information_request' },
  'fast-context': { tool: 'mcp__fast-context__fast_context_search', param: 'query' },
}

/**
 * Replace template variables in content based on user configuration.
 * Injects model routing configs and MCP provider tool names at install time.
 *
 * Supported MCP providers: 'ace-tool' (default), 'ace-tool-rs', 'contextweaver',
 * 'fast-context', 'skip' (fallback to Glob+Grep).
 */
export function injectConfigVariables(content: string, config: {
  routing?: {
    mode?: string
    frontend?: { models?: string[], primary?: string }
    backend?: { models?: string[], primary?: string }
    review?: { models?: string[] }
  }
  liteMode?: boolean
  mcpProvider?: string
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

  // MiniMax model flag for codeagent-wrapper
  // Injected when minimax is used as a backend model
  const minimaxModelFlag = '{{MINIMAX_MODEL_FLAG}}'
  if (processed.includes(minimaxModelFlag)) {
    const flag = (routing.backend?.primary === 'minimax' || routing.frontend?.primary === 'minimax')
      ? '--minimax-model MiniMax-M2.5 '
      : ''
    processed = processed.replace(/\{\{MINIMAX_MODEL_FLAG\}\}/g, flag)
  }

  // MCP tool injection based on provider (registry-driven)
  const mcpProvider = config.mcpProvider || 'ace-tool'
  if (mcpProvider === 'skip') {
    // MCP skipped: multi-step fallback replacement (unique logic, not in registry)
    processed = processed.replace(/,\s*\{\{MCP_SEARCH_TOOL\}\}/g, '')
    processed = processed.replace(
      /```\n\{\{MCP_SEARCH_TOOL\}\}[\s\S]*?\n```/g,
      '> MCP 未配置。使用 `Glob` 定位文件 + `Grep` 搜索关键符号 + `Read` 读取文件内容。',
    )
    processed = processed.replace(/`\{\{MCP_SEARCH_TOOL\}\}`/g, '`Glob + Grep`（MCP 未配置）')
    processed = processed.replace(/\{\{MCP_SEARCH_TOOL\}\}/g, 'Glob + Grep')
    processed = processed.replace(/\{\{MCP_SEARCH_PARAM\}\}/g, '')
  }
  else {
    // Registry lookup — adding a new MCP provider = 1 line
    const provider = MCP_PROVIDERS[mcpProvider] ?? MCP_PROVIDERS['ace-tool']
    processed = processed.replace(/\{\{MCP_SEARCH_TOOL\}\}/g, provider.tool)
    processed = processed.replace(/\{\{MCP_SEARCH_PARAM\}\}/g, provider.param)
  }

  return processed
}

/**
 * Replace ~ paths in template content with absolute paths.
 * Fixes Windows multi-user path resolution issues.
 *
 * IMPORTANT: Always use forward slashes (/) for cross-platform compatibility.
 * Windows Git Bash requires forward slashes in heredoc (backslashes get escaped).
 * PowerShell and CMD also support forward slashes for most commands.
 */
export function replaceHomePathsInTemplate(content: string, installDir: string): string {
  // Get absolute paths for replacement
  const userHome = homedir()
  const ccgDir = join(installDir, '.ccg')
  const binDir = join(installDir, 'bin')
  const claudeDir = installDir // ~/.claude

  // IMPORTANT: Always use forward slashes for cross-platform compatibility
  // Git Bash on Windows requires forward slashes in heredoc (backslashes get escaped)
  // PowerShell and CMD also support forward slashes for most commands
  const toForwardSlash = (path: string) => path.replace(/\\/g, '/')

  let processed = content

  // Order matters: replace longer patterns first to avoid partial matches
  // 1. Replace ~/.claude/.ccg with absolute path (longest match first)
  processed = processed.replace(/~\/\.claude\/\.ccg/g, toForwardSlash(ccgDir))

  // 2. Replace ~/.claude/bin/codeagent-wrapper with absolute path + .exe on Windows
  //    CRITICAL: Windows Git Bash requires explicit .exe extension
  const wrapperName = isWindows() ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'
  const wrapperPath = `${toForwardSlash(binDir)}/${wrapperName}`
  processed = processed.replace(/~\/\.claude\/bin\/codeagent-wrapper/g, wrapperPath)

  // 3. Replace ~/.claude/bin with absolute path (for other binaries)
  processed = processed.replace(/~\/\.claude\/bin/g, toForwardSlash(binDir))

  // 4. Replace ~/.claude with absolute path
  processed = processed.replace(/~\/\.claude/g, toForwardSlash(claudeDir))

  // 5. Replace remaining ~/ patterns with user home
  processed = processed.replace(/~\//g, `${toForwardSlash(userHome)}/`)

  return processed
}
