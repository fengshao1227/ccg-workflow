/**
 * Diagnose MCP configuration issues
 */

import ansis from 'ansis'
import { diagnoseMcpConfig, fixWindowsMcpConfig, readClaudeCodeConfig, writeClaudeCodeConfig } from '../utils/mcp'
import { isWindows } from '../utils/platform'

export async function diagnoseMcp(): Promise<void> {
  console.log()
  console.log(ansis.cyan.bold('  🔍 MCP Configuration Diagnostics'))
  console.log()

  // Run diagnostics
  const issues = await diagnoseMcpConfig()

  console.log(ansis.bold('  Diagnostic Results:'))
  console.log()

  for (const issue of issues) {
    if (issue.startsWith('✅')) {
      console.log(ansis.green(`  ${issue}`))
    }
    else if (issue.startsWith('⚠️')) {
      console.log(ansis.yellow(`  ${issue}`))
    }
    else if (issue.startsWith('❌')) {
      console.log(ansis.red(`  ${issue}`))
    }
    else {
      console.log(`  ${issue}`)
    }
  }

  // Offer to fix Windows issues
  if (isWindows() && issues.some(i => i.includes('not properly wrapped'))) {
    console.log()
    console.log(ansis.yellow('  💡 Tip: Run the following command to fix Windows MCP configuration:'))
    console.log(ansis.gray('     npx ccg fix-mcp'))
  }

  console.log()
}

/**
 * Fix Windows MCP configuration issues
 */
export async function fixMcp(): Promise<void> {
  console.log()
  console.log(ansis.cyan.bold('  🔧 Fixing MCP Configuration'))
  console.log()

  if (!isWindows()) {
    console.log(ansis.yellow('  ⚠️  This command is only needed on Windows'))
    console.log()
    return
  }

  try {
    const config = await readClaudeCodeConfig()

    if (!config) {
      console.log(ansis.red('  ❌ No ~/.claude.json found'))
      console.log()
      return
    }

    if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
      console.log(ansis.yellow('  ⚠️  No MCP servers configured'))
      console.log()
      return
    }

    // Apply Windows fixes
    const fixedConfig = fixWindowsMcpConfig(config)

    // Write back
    await writeClaudeCodeConfig(fixedConfig)

    console.log(ansis.green('  ✅ Windows MCP configuration fixed'))
    console.log()
    console.log(ansis.gray('  Run diagnostics again to verify:'))
    console.log(ansis.gray('     npx ccg diagnose-mcp'))
    console.log()
  }
  catch (error) {
    console.log(ansis.red(`  ❌ Failed to fix MCP configuration: ${error}`))
    console.log()
  }
}
