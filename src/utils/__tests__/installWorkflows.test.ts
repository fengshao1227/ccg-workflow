import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it } from 'vitest'
import fs from 'fs-extra'
import { getAllCommandIds, installWorkflows } from '../installer'

const ALL_IDS = getAllCommandIds()

// Collect all .md files recursively
function collectMdFiles(dir: string): string[] {
  const files: string[] = []
  if (!fs.existsSync(dir))
    return files
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory())
      files.push(...collectMdFiles(full))
    else if (entry.name.endsWith('.md'))
      files.push(full)
  }
  return files
}

// ─────────────────────────────────────────────────────────────
// E2E: installWorkflows with mcpProvider='skip'
// ─────────────────────────────────────────────────────────────
describe('installWorkflows E2E — mcpProvider="skip"', () => {
  const tmpDir = join(tmpdir(), `ccg-test-skip-${Date.now()}`)

  afterAll(async () => {
    await fs.remove(tmpDir)
  })

  it('installs all workflows without errors', async () => {
    const result = await installWorkflows(ALL_IDS, tmpDir, true, {
      mcpProvider: 'skip',
    })
    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.installedCommands.length).toBeGreaterThan(0)
  }, 15000)

  it('generated command files contain no mcp__ace-tool references', async () => {
    const cmdDir = join(tmpDir, 'commands', 'ccg')
    const files = collectMdFiles(cmdDir)
    expect(files.length).toBeGreaterThan(0)

    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      const rel = file.replace(tmpDir + '/', '')
      expect(content, `${rel} should not contain mcp__ace-tool`).not.toContain('mcp__ace-tool__search_context')
      expect(content, `${rel} should not contain {{MCP_SEARCH_TOOL}}`).not.toContain('{{MCP_SEARCH_TOOL}}')
      expect(content, `${rel} should not contain {{MCP_SEARCH_PARAM}}`).not.toContain('{{MCP_SEARCH_PARAM}}')
    }
  })

  it('generated agent files contain no mcp__ace-tool references', async () => {
    const agentDir = join(tmpDir, 'agents', 'ccg')
    const files = collectMdFiles(agentDir)
    expect(files.length).toBeGreaterThan(0)

    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      const rel = file.replace(tmpDir + '/', '')
      expect(content, `${rel} should not contain mcp__ace-tool`).not.toContain('mcp__ace-tool__search_context')
      expect(content, `${rel} should not contain {{MCP_SEARCH_TOOL}}`).not.toContain('{{MCP_SEARCH_TOOL}}')
    }
  })

  it('plan.md contains Glob + Grep fallback guidance', async () => {
    const content = readFileSync(join(tmpDir, 'commands', 'ccg', 'plan.md'), 'utf-8')
    expect(content).toContain('Glob + Grep')
    expect(content).toContain('MCP 未配置')
  })

  it('execute.md contains Glob + Grep fallback guidance', async () => {
    const content = readFileSync(join(tmpDir, 'commands', 'ccg', 'execute.md'), 'utf-8')
    expect(content).toContain('Glob + Grep')
    expect(content).toContain('MCP 未配置')
  })

  it('generated planning templates use timestamped output filenames', async () => {
    const plan = readFileSync(join(tmpDir, 'commands', 'ccg', 'plan.md'), 'utf-8')
    const teamPlan = readFileSync(join(tmpDir, 'commands', 'ccg', 'team-plan.md'), 'utf-8')
    const teamResearch = readFileSync(join(tmpDir, 'commands', 'ccg', 'team-research.md'), 'utf-8')

    expect(plan).toContain('.claude/plan/<功能名>-YYYYMMDD-HHmmss.md')
    expect(teamPlan).toContain('.claude/team-plan/<任务名>-YYYYMMDD-HHmmss.md')
    expect(teamResearch).toContain('.claude/team-plan/<任务名>-research-YYYYMMDD-HHmmss.md')
  })

  it('planner.md frontmatter has no MCP tool in tools declaration', async () => {
    const content = readFileSync(join(tmpDir, 'agents', 'ccg', 'planner.md'), 'utf-8')
    const toolsLine = content.split('\n').find(l => l.startsWith('tools:'))
    expect(toolsLine).toBe('tools: Read, Write')
  })
})

// ─────────────────────────────────────────────────────────────
// E2E: installWorkflows with mcpProvider='ace-tool' (control)
// ─────────────────────────────────────────────────────────────
describe('installWorkflows E2E — mcpProvider="ace-tool" (control)', () => {
  const tmpDir = join(tmpdir(), `ccg-test-ace-${Date.now()}`)

  afterAll(async () => {
    await fs.remove(tmpDir)
  })

  it('installs all workflows and injects ace-tool references', async () => {
    const result = await installWorkflows(ALL_IDS, tmpDir, true, {
      mcpProvider: 'ace-tool',
    })
    expect(result.success).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('generated files contain mcp__ace-tool__search_context (correct injection)', async () => {
    const planContent = readFileSync(join(tmpDir, 'commands', 'ccg', 'plan.md'), 'utf-8')
    expect(planContent).toContain('mcp__ace-tool__search_context')
    expect(planContent).not.toContain('{{MCP_SEARCH_TOOL}}')
  })

  it('generated agent files contain mcp__ace-tool__search_context', async () => {
    const plannerContent = readFileSync(join(tmpDir, 'agents', 'ccg', 'planner.md'), 'utf-8')
    expect(plannerContent).toContain('mcp__ace-tool__search_context')
    expect(plannerContent).not.toContain('{{MCP_SEARCH_TOOL}}')
  })
})
