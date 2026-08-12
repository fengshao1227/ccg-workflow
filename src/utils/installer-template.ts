import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import fs from 'fs-extra'
import { dirname, join } from 'pathe'
import { isWindows } from './platform'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Find package root by looking for package.json up the directory tree.
 * Validates that the found root contains a templates/ directory.
 *
 * Increased depth from 5 → 10 to handle deeply nested npm cache paths
 * on Windows (e.g., AppData\Local\npm-cache\_npx\<hash>\node_modules\...).
 */
function findPackageRoot(startDir: string): string {
  let dir = startDir
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(join(dir, 'package.json'))) {
      // Validate: package root must contain templates/ directory
      if (fs.existsSync(join(dir, 'templates'))) {
        return dir
      }
      // Found package.json but no templates/ — might be a parent workspace
      // Continue searching upward
    }
    const parent = dirname(dir)
    if (parent === dir) break // Reached filesystem root
    dir = parent
  }

  // Fallback: warn loudly — this is the root cause of "silent install failure"
  console.error(
    `[CCG] ⚠ PACKAGE_ROOT resolution failed: could not find package.json with templates/ directory.\n`
    + `  Start dir: ${startDir}\n`
    + `  Last checked: ${dir}\n`
    + `  This will cause commands/skills/prompts to not be installed.\n`
    + `  Please report this issue at: https://github.com/fengshao1227/ccg-workflow/issues`,
  )
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
    geminiModel?: string
    grokModel?: string
    kimiModel?: string
    opencodeModel?: string
  }
  liteMode?: boolean
  mcpProvider?: string
}): string {
  let processed = content

  // Model routing injection
  const routing = config.routing || {}

  // Frontend models
  const frontendModels = routing.frontend?.models || ['antigravity']
  const frontendPrimary = routing.frontend?.primary || 'antigravity'
  processed = processed.replace(/\{\{FRONTEND_MODELS\}\}/g, JSON.stringify(frontendModels))
  processed = processed.replace(/\{\{FRONTEND_PRIMARY\}\}/g, frontendPrimary)

  // Backend models
  const backendModels = routing.backend?.models || ['codex']
  const backendPrimary = routing.backend?.primary || 'codex'
  processed = processed.replace(/\{\{BACKEND_MODELS\}\}/g, JSON.stringify(backendModels))
  processed = processed.replace(/\{\{BACKEND_PRIMARY\}\}/g, backendPrimary)

  // Review models
  const reviewModels = routing.review?.models || ['codex', 'antigravity']
  processed = processed.replace(/\{\{REVIEW_MODELS\}\}/g, JSON.stringify(reviewModels))

  // Routing mode
  const routingMode = routing.mode || 'smart'
  processed = processed.replace(/\{\{ROUTING_MODE\}\}/g, routingMode)

  // Gemini model flag — inject at install time with line-aware substitution.
  //
  // When gemini is used for any role, we need `--gemini-model <name>` on
  // gemini invocations. But some command templates hard-code a non-gemini
  // backend on the same line (e.g. `--backend {{BACKEND_PRIMARY}}` where
  // BACKEND_PRIMARY=codex, see backend.md / codex-exec.md). On those lines
  // the flag is useless — codeagent-wrapper warns and ignores it, but we
  // should not emit the dead flag at all (issue #130).
  //
  // Strategy: after BACKEND_PRIMARY / FRONTEND_PRIMARY have already been
  // substituted above, scan each line containing `{{GEMINI_MODEL_FLAG}}`:
  //   - If the line hard-codes a non-gemini backend (`--backend codex`,
  //     `--backend claude`, etc.) — strip the flag on that line.
  //   - If the line uses a conditional expression (`--backend <codex|gemini>`)
  //     or hard-codes gemini — keep the flag (AI picks at runtime).
  const geminiModel = routing.geminiModel || 'gemini-3.1-pro-preview'
  const usesGemini = frontendPrimary === 'gemini' || backendPrimary === 'gemini'

  if (!usesGemini) {
    // Neither frontend nor backend is gemini — no flag needed anywhere.
    processed = processed.replace(/\{\{GEMINI_MODEL_FLAG\}\}/g, '')
  }
  else {
    const geminiModelFlagValue = `--gemini-model ${geminiModel} `
    // Match `--backend <bare-identifier>` (rejects conditional `<...|...>`
    // because `<` is not in [a-z0-9-]).
    const hardCodedBackendRe = /--backend\s+([a-z0-9-]+)(?:\s|$)/

    processed = processed.split('\n').map((line) => {
      if (!line.includes('{{GEMINI_MODEL_FLAG}}')) {
        return line
      }
      const m = line.match(hardCodedBackendRe)
      if (m && m[1] !== 'gemini') {
        // Hard-coded non-gemini backend on this line — strip the flag.
        return line.replace(/\{\{GEMINI_MODEL_FLAG\}\}/g, '')
      }
      // Conditional / gemini-hard-coded — keep the flag.
      return line.replace(/\{\{GEMINI_MODEL_FLAG\}\}/g, geminiModelFlagValue)
    }).join('\n')
  }

  // Grok model flag — same line-aware substitution as GEMINI_MODEL_FLAG:
  // strip the flag on lines that hard-code a non-grok backend, keep it on
  // conditional / grok / runtime-variable ($MODEL) lines.
  const grokModel = routing.grokModel || 'grok-4.5'
  const usesGrok = frontendPrimary === 'grok' || backendPrimary === 'grok'
    || frontendModels.includes('grok') || backendModels.includes('grok')

  if (!usesGrok) {
    processed = processed.replace(/\{\{GROK_MODEL_FLAG\}\}/g, '')
  }
  else {
    const grokModelFlagValue = `--grok-model ${grokModel} `
    const hardCodedBackendRe = /--backend\s+([a-z0-9-]+)(?:\s|$)/

    processed = processed.split('\n').map((line) => {
      if (!line.includes('{{GROK_MODEL_FLAG}}')) {
        return line
      }
      const m = line.match(hardCodedBackendRe)
      if (m && m[1] !== 'grok') {
        return line.replace(/\{\{GROK_MODEL_FLAG\}\}/g, '')
      }
      return line.replace(/\{\{GROK_MODEL_FLAG\}\}/g, grokModelFlagValue)
    }).join('\n')
  }

  // Kimi model flag — optional: an empty kimiModel means "use whatever
  // default_model kimi's own config.toml declares", so emit nothing.
  const kimiModel = (routing.kimiModel || '').trim()
  const usesKimi = frontendPrimary === 'kimi' || backendPrimary === 'kimi'
    || frontendModels.includes('kimi') || backendModels.includes('kimi')

  if (!usesKimi || !kimiModel) {
    processed = processed.replace(/\{\{KIMI_MODEL_FLAG\}\}/g, '')
  }
  else {
    const kimiModelFlagValue = `--kimi-model ${kimiModel} `
    const hardCodedBackendRe = /--backend\s+([a-z0-9-]+)(?:\s|$)/

    processed = processed.split('\n').map((line) => {
      if (!line.includes('{{KIMI_MODEL_FLAG}}')) {
        return line
      }
      const m = line.match(hardCodedBackendRe)
      if (m && m[1] !== 'kimi') {
        return line.replace(/\{\{KIMI_MODEL_FLAG\}\}/g, '')
      }
      return line.replace(/\{\{KIMI_MODEL_FLAG\}\}/g, kimiModelFlagValue)
    }).join('\n')
  }

  // Opencode model flag — optional, same line-aware rules as the others.
  const opencodeModel = (routing.opencodeModel || '').trim()
  const usesOpencode = frontendPrimary === 'opencode' || backendPrimary === 'opencode'
    || frontendModels.includes('opencode') || backendModels.includes('opencode')

  if (!usesOpencode || !opencodeModel) {
    processed = processed.replace(/\{\{OPENCODE_MODEL_FLAG\}\}/g, '')
  }
  else {
    const opencodeModelFlagValue = `--opencode-model ${opencodeModel} `
    const hardCodedBackendRe = /--backend\s+([a-z0-9-]+)(?:\s|$)/

    processed = processed.split('\n').map((line) => {
      if (!line.includes('{{OPENCODE_MODEL_FLAG}}')) {
        return line
      }
      const m = line.match(hardCodedBackendRe)
      if (m && m[1] !== 'opencode') {
        return line.replace(/\{\{OPENCODE_MODEL_FLAG\}\}/g, '')
      }
      return line.replace(/\{\{OPENCODE_MODEL_FLAG\}\}/g, opencodeModelFlagValue)
    }).join('\n')
  }

  // Lite mode flag for codeagent-wrapper
  // If liteMode is true, inject "--lite" flag
  const liteModeFlag = config.liteMode ? '--lite ' : ''
  processed = processed.replace(/\{\{LITE_MODE_FLAG\}\}/g, liteModeFlag)

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
