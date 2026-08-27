import fs from 'fs-extra'
import { join } from 'pathe'
import { describe, expect, it } from 'vitest'
import { collectSkills } from '../skill-registry'

const ROOT = join(__dirname, '../../..')
const SKILLS_DIR = join(ROOT, 'templates/skills')
const pkg = fs.readJsonSync(join(ROOT, 'package.json'))
const marketplace = fs.readJsonSync(join(ROOT, '.claude-plugin/marketplace.json'))
const plugin = fs.readJsonSync(join(ROOT, '.claude-plugin/plugin.json'))

/**
 * The .claude-plugin manifests let Claude Code install CCG's skills natively via
 * `claude plugin marketplace add fengshao1227/ccg-workflow`. They live outside the
 * npm tarball and outside the installer, so nothing else catches a stale version
 * or a broken skills path — these assertions do.
 */
describe('plugin manifests — native marketplace install', () => {
  it('marketplace declares exactly the ccg plugin, sourced from the repo root', () => {
    expect(marketplace.name).toBe('ccg')
    expect(marketplace.plugins).toHaveLength(1)
    expect(marketplace.plugins[0].name).toBe('ccg')
    // source "." = the whole repo is the plugin root; plugin.json's `skills`
    // field then points at templates/skills without exposing templates/commands
    // (which carry unresolved {{FRONTEND_PRIMARY}}-style placeholders).
    expect(marketplace.plugins[0].source).toBe('.')
  })

  it('plugin.json points skills at a directory that exists', () => {
    expect(plugin.name).toBe('ccg')
    expect(plugin.skills).toBe('./templates/skills')
    expect(fs.existsSync(join(ROOT, plugin.skills))).toBe(true)
  })

  it('plugin.json declares NO commands/agents path', () => {
    // Declaring them would replace the (empty) default scan with templates/*,
    // leaking placeholder-laden command templates into the plugin. Skills-only.
    expect(plugin.commands).toBeUndefined()
    expect(plugin.agents).toBeUndefined()
  })

  it('manifest versions track package.json (bump all three together)', () => {
    expect(plugin.version).toBe(pkg.version)
    expect(marketplace.metadata.version).toBe(pkg.version)
    expect(marketplace.plugins[0].version).toBe(pkg.version)
  })
})

describe('impeccable is collapsed into a single frontend-design entry', () => {
  const skills = collectSkills(SKILLS_DIR)
  const impeccable = skills.filter(s => s.relPath.startsWith('impeccable/'))

  it('ships the impeccable playbooks but none is user-invocable', () => {
    expect(impeccable.length).toBeGreaterThanOrEqual(20)
    const stillInvocable = impeccable.filter(s => s.userInvocable).map(s => s.name)
    expect(stillInvocable).toEqual([])
  })

  it('frontend-design remains the single invocable design entry', () => {
    const fd = skills.find(s => s.name === 'frontend-design')
    expect(fd?.userInvocable).toBe(true)
  })

  it('the invocable command list stays lean (no 20-command sprawl)', () => {
    const invocable = skills.filter(s => s.userInvocable).map(s => s.name).sort()
    // Guardrail: if this jumps back toward 30, impeccable leaked its commands again.
    expect(invocable.length).toBeLessThanOrEqual(12)
    expect(invocable).toContain('frontend-design')
    expect(invocable).toContain('bt-panel')
  })

  it('frontend-design has no dangling /slash links to the downgraded commands', () => {
    const text = fs.readFileSync(join(SKILLS_DIR, 'domains/frontend-design/SKILL.md'), 'utf-8')
    const downgraded = ['polish', 'critique', 'audit', 'normalize', 'distill', 'clarify', 'harden', 'animate', 'colorize', 'bolder', 'quieter', 'delight', 'extract', 'adapt', 'onboard', 'typeset', 'arrange', 'overdrive', 'teach-impeccable']
    const dead: string[] = []
    for (const name of downgraded) {
      // a real invocation link is `/name` or `/ccg:name` at a word boundary,
      // not the description slash-list (`audit/critique/polish`) or a path
      // segment (`impeccable/teach-impeccable`).
      const re = new RegExp(`(?<![\\w/])/(?:ccg:)?${name}\\b`, 'g')
      if (re.test(text)) dead.push(name)
    }
    expect(dead).toEqual([])
  })
})
