import type { AceToolConfig, FastContextConfig } from '../types'
import { homedir } from 'node:os'
import fs from 'fs-extra'
import { join } from 'pathe'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import { type McpServerConfig, backupClaudeCodeConfig, buildMcpServerConfig, fixWindowsMcpConfig, mergeMcpServers, readClaudeCodeConfig, writeClaudeCodeConfig } from './mcp'
import { isWindows } from './platform'

// ═══════════════════════════════════════════════════════
// Shared types & helpers
// ═══════════════════════════════════════════════════════

type McpInstallResult = { success: boolean, message: string, configPath?: string }

/**
 * Common pipeline for installing an MCP server into ~/.claude.json:
 * read → backup → merge → Windows fix → write.
 *
 * All MCP installers funnel through this to avoid duplication.
 */
async function configureMcpInClaude(
  serverId: string,
  serverConfig: McpServerConfig,
  label: string,
): Promise<McpInstallResult> {
  try {
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

    // Merge new server into existing config
    let mergedConfig = mergeMcpServers(existingConfig, {
      [serverId]: serverConfig,
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
        ? `${label} configured successfully with Windows compatibility`
        : `${label} configured successfully`,
      configPath: join(homedir(), '.claude.json'),
    }
  }
  catch (error) {
    return {
      success: false,
      message: `Failed to configure ${label}: ${error}`,
    }
  }
}

// ═══════════════════════════════════════════════════════
// ace-tool MCP
// ═══════════════════════════════════════════════════════

/**
 * Uninstall ace-tool MCP configuration from ~/.claude.json
 */
export async function uninstallAceTool(): Promise<{ success: boolean, message: string }> {
  try {
    const existingConfig = await readClaudeCodeConfig()

    if (!existingConfig) {
      return { success: true, message: 'No ~/.claude.json found, nothing to remove' }
    }

    if (!existingConfig.mcpServers || !existingConfig.mcpServers['ace-tool']) {
      return { success: true, message: 'ace-tool MCP not found in config' }
    }

    await backupClaudeCodeConfig()
    delete existingConfig.mcpServers['ace-tool']
    await writeClaudeCodeConfig(existingConfig)

    return { success: true, message: 'ace-tool MCP removed from ~/.claude.json' }
  }
  catch (error) {
    return { success: false, message: `Failed to uninstall ace-tool: ${error}` }
  }
}

/**
 * Install and configure ace-tool MCP for Claude Code.
 */
export async function installAceTool(config: AceToolConfig): Promise<McpInstallResult> {
  const { baseUrl, token } = config

  const args = ['-y', 'ace-tool@latest']
  if (baseUrl) args.push('--base-url', baseUrl)
  if (token) args.push('--token', token)

  const serverConfig = buildMcpServerConfig({ type: 'stdio', command: 'npx', args })
  return configureMcpInClaude('ace-tool', serverConfig, 'ace-tool MCP')
}

/**
 * Install and configure ace-tool-rs MCP for Claude Code.
 * ace-tool-rs is a Rust implementation — more lightweight and faster.
 */
export async function installAceToolRs(config: AceToolConfig): Promise<McpInstallResult> {
  const { baseUrl, token } = config

  const args = ['ace-tool-rs']
  if (baseUrl) args.push('--base-url', baseUrl)
  if (token) args.push('--token', token)

  const serverConfig = buildMcpServerConfig({
    type: 'stdio',
    command: 'npx',
    args,
    env: { RUST_LOG: 'info' },
  })
  return configureMcpInClaude('ace-tool', serverConfig, 'ace-tool-rs MCP')
}

// ═══════════════════════════════════════════════════════
// ContextWeaver MCP
// ═══════════════════════════════════════════════════════

/**
 * ContextWeaver MCP configuration
 */
export interface ContextWeaverConfig {
  siliconflowApiKey: string
}

/**
 * Install and configure ContextWeaver MCP for Claude Code.
 * ContextWeaver is a local-first semantic code search engine with hybrid search + rerank.
 */
export async function installContextWeaver(config: ContextWeaverConfig): Promise<McpInstallResult> {
  const { siliconflowApiKey } = config

  try {
    // 0. Install contextweaver CLI globally
    console.log('  ⏳ 正在安装 ContextWeaver CLI...')
    const { execSync } = await import('node:child_process')
    try {
      execSync('npm install -g @hsingjui/contextweaver', { stdio: 'pipe' })
      console.log('  ✓ ContextWeaver CLI 安装成功')
    }
    catch {
      if (process.platform !== 'win32') {
        try {
          execSync('sudo npm install -g @hsingjui/contextweaver', { stdio: 'pipe' })
          console.log('  ✓ ContextWeaver CLI 安装成功 (sudo)')
        }
        catch {
          console.log('  ⚠ ContextWeaver CLI 安装失败，请手动运行: npm install -g @hsingjui/contextweaver')
        }
      }
      else {
        console.log('  ⚠ ContextWeaver CLI 安装失败，请手动运行: npm install -g @hsingjui/contextweaver')
      }
    }

    // 1. Create ContextWeaver config directory and .env file
    const contextWeaverDir = join(homedir(), '.contextweaver')
    await fs.ensureDir(contextWeaverDir)

    const envContent = `# ContextWeaver 配置 (由 CCG 自动生成)

# Embedding API - 硅基流动
EMBEDDINGS_API_KEY=${siliconflowApiKey}
EMBEDDINGS_BASE_URL=https://api.siliconflow.cn/v1/embeddings
EMBEDDINGS_MODEL=Qwen/Qwen3-Embedding-8B
EMBEDDINGS_MAX_CONCURRENCY=10
EMBEDDINGS_DIMENSIONS=1024

# Reranker - 硅基流动
RERANK_API_KEY=${siliconflowApiKey}
RERANK_BASE_URL=https://api.siliconflow.cn/v1/rerank
RERANK_MODEL=Qwen/Qwen3-Reranker-8B
RERANK_TOP_N=20
`
    await fs.writeFile(join(contextWeaverDir, '.env'), envContent, 'utf-8')

    // 2. Configure MCP via shared pipeline
    const serverConfig = buildMcpServerConfig({
      type: 'stdio',
      command: 'contextweaver',
      args: ['mcp'],
    })
    return await configureMcpInClaude('contextweaver', serverConfig, 'ContextWeaver MCP')
  }
  catch (error) {
    return { success: false, message: `Failed to configure ContextWeaver: ${error}` }
  }
}

/**
 * Uninstall ContextWeaver MCP from Claude Code.
 * Delegates to generic uninstallMcpServer.
 */
export function uninstallContextWeaver(): Promise<{ success: boolean, message: string }> {
  return uninstallMcpServer('contextweaver')
}

// ═══════════════════════════════════════════════════════
// Fast Context (Windsurf) MCP
// ═══════════════════════════════════════════════════════

/**
 * Install and configure Fast Context (Windsurf) MCP for Claude Code.
 */
export async function installFastContext(config: FastContextConfig): Promise<McpInstallResult> {
  const { apiKey, includeSnippets } = config

  const env: Record<string, string> = {}
  if (apiKey) env.WINDSURF_API_KEY = apiKey
  if (includeSnippets) env.FC_INCLUDE_SNIPPETS = 'true'

  const serverConfig = buildMcpServerConfig({
    type: 'stdio',
    command: 'npx',
    args: ['-y', '--prefer-online', 'fast-context-mcp@latest'],
    ...(Object.keys(env).length > 0 ? { env } : {}),
  })
  return configureMcpInClaude('fast-context', serverConfig, 'fast-context MCP')
}

/**
 * Uninstall Fast Context MCP from Claude Code.
 * Delegates to generic uninstallMcpServer.
 */
export function uninstallFastContext(): Promise<{ success: boolean, message: string }> {
  return uninstallMcpServer('fast-context')
}

// ═══════════════════════════════════════════════════════
// Generic MCP server install/uninstall
// ═══════════════════════════════════════════════════════

/**
 * Install a generic MCP server to Claude Code
 */
export async function installMcpServer(
  id: string,
  command: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<{ success: boolean, message: string }> {
  const serverConfig = buildMcpServerConfig({ type: 'stdio', command, args, env })
  return configureMcpInClaude(id, serverConfig, id)
}

/**
 * Uninstall a generic MCP server from Claude Code
 */
export async function uninstallMcpServer(id: string): Promise<{ success: boolean, message: string }> {
  try {
    const existingConfig = await readClaudeCodeConfig()
    if (existingConfig?.mcpServers?.[id]) {
      delete existingConfig.mcpServers[id]
      await writeClaudeCodeConfig(existingConfig)
    }
    return { success: true, message: `${id} MCP uninstalled successfully` }
  }
  catch (error) {
    return { success: false, message: `Failed to uninstall ${id}: ${error}` }
  }
}

// ═══════════════════════════════════════════════════════
// MCP Sync — Mirror CCG-relevant MCP servers
// to Codex (~/.codex/config.toml) and Gemini (~/.gemini/settings.json)
// ═══════════════════════════════════════════════════════

/** MCP server IDs that CCG manages and should sync to Codex/Gemini */
const CCG_MCP_IDS = new Set([
  'grok-search',
  'context7',
  'ace-tool',
  'ace-tool-rs',
  'contextweaver',
  'fast-context',
])

type SyncResult = { success: boolean, message: string, synced: string[], removed: string[] }

/**
 * Read Claude's MCP config and filter to CCG-managed servers.
 */
async function getCcgMcpServersFromClaude(): Promise<Record<string, any>> {
  const claudeConfig = await readClaudeCodeConfig()
  const claudeMcpServers = claudeConfig?.mcpServers || {}

  const serversToSync: Record<string, any> = {}
  for (const [id, config] of Object.entries(claudeMcpServers)) {
    if (CCG_MCP_IDS.has(id) && config) {
      serversToSync[id] = config
    }
  }
  return serversToSync
}

/**
 * Apply mirror logic: add/update servers from Claude, remove stale CCG servers.
 * Returns { synced, removed } arrays. Mutates targetServers in place.
 */
function mirrorCcgServers(
  serversToSync: Record<string, any>,
  targetServers: Record<string, any>,
): { synced: string[], removed: string[] } {
  const synced: string[] = []
  const removed: string[] = []

  // Add/update CCG servers
  for (const [id, claudeServer] of Object.entries(serversToSync)) {
    targetServers[id] = claudeServer
    synced.push(id)
  }

  // Remove CCG servers that no longer exist in Claude
  for (const id of CCG_MCP_IDS) {
    if (!serversToSync[id] && targetServers[id]) {
      delete targetServers[id]
      removed.push(id)
    }
  }

  return { synced, removed }
}

/**
 * Format sync result message
 */
function formatSyncMessage(target: string, synced: string[], removed: string[]): string {
  const parts: string[] = []
  if (synced.length > 0) parts.push(`synced: ${synced.join(', ')}`)
  if (removed.length > 0) parts.push(`removed: ${removed.join(', ')}`)
  return `${target} MCP mirror complete (${parts.join('; ')})`
}

/**
 * Sync (mirror) CCG-managed MCP servers from Claude's ~/.claude.json
 * to Codex's ~/.codex/config.toml
 *
 * - Only touches servers in CCG_MCP_IDS — user's custom servers untouched.
 * - Uses atomic write (temp file + rename) to prevent corruption.
 */
export async function syncMcpToCodex(): Promise<SyncResult> {
  try {
    const serversToSync = await getCcgMcpServersFromClaude()

    // Read or create Codex config
    const codexConfigDir = join(homedir(), '.codex')
    const codexConfigPath = join(codexConfigDir, 'config.toml')
    await fs.ensureDir(codexConfigDir)

    let codexConfig: Record<string, any> = {}
    if (await fs.pathExists(codexConfigPath)) {
      const content = await fs.readFile(codexConfigPath, 'utf-8')
      codexConfig = parseToml(content) as Record<string, any>
    }

    if (!codexConfig.mcp_servers) {
      codexConfig.mcp_servers = {}
    }

    // Codex needs field-level copy (TOML compatibility: filter null/undefined)
    const codexServersToSync: Record<string, any> = {}
    for (const [id, server] of Object.entries(serversToSync)) {
      const entry: Record<string, any> = {}
      for (const [key, value] of Object.entries(server as Record<string, any>)) {
        if (value !== null && value !== undefined) {
          entry[key] = value
        }
      }
      codexServersToSync[id] = entry
    }

    const { synced, removed } = mirrorCcgServers(codexServersToSync, codexConfig.mcp_servers)

    if (synced.length === 0 && removed.length === 0) {
      return { success: true, message: 'No CCG MCP servers to sync or remove', synced: [], removed: [] }
    }

    // Atomic write: temp file + rename
    const tmpPath = `${codexConfigPath}.tmp`
    await fs.writeFile(tmpPath, stringifyToml(codexConfig), 'utf-8')
    await fs.rename(tmpPath, codexConfigPath)

    return { success: true, message: formatSyncMessage('Codex', synced, removed), synced, removed }
  }
  catch (error) {
    return { success: false, message: `Failed to sync MCP to Codex: ${error}`, synced: [], removed: [] }
  }
}

/**
 * Sync (mirror) CCG-managed MCP servers from Claude's ~/.claude.json
 * to Gemini CLI's ~/.gemini/settings.json
 */
export async function syncMcpToGemini(): Promise<SyncResult> {
  try {
    const serversToSync = await getCcgMcpServersFromClaude()

    // Read or create Gemini settings
    const geminiDir = join(homedir(), '.gemini')
    const geminiSettingsPath = join(geminiDir, 'settings.json')
    await fs.ensureDir(geminiDir)

    let geminiSettings: Record<string, any> = {}
    if (await fs.pathExists(geminiSettingsPath)) {
      geminiSettings = await fs.readJSON(geminiSettingsPath)
    }

    if (!geminiSettings.mcpServers) {
      geminiSettings.mcpServers = {}
    }

    const { synced, removed } = mirrorCcgServers(serversToSync, geminiSettings.mcpServers)

    if (synced.length === 0 && removed.length === 0) {
      return { success: true, message: 'No CCG MCP servers to sync to Gemini', synced: [], removed: [] }
    }

    await fs.writeJSON(geminiSettingsPath, geminiSettings, { spaces: 2 })

    return { success: true, message: formatSyncMessage('Gemini', synced, removed), synced, removed }
  }
  catch (error) {
    return { success: false, message: `Failed to sync MCP to Gemini: ${error}`, synced: [], removed: [] }
  }
}
