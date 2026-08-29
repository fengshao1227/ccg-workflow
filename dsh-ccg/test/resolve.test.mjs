/**
 * Unit tests for the role matrix. `resolveRoles` is the function that decides
 * which model serves which role, so it is tested directly — no harness boot,
 * no network, no provider credentials.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { existsSync } from 'node:fs'

import {
  BUNDLED_SKILL_DIR,
  Config,
  resolveRoles,
  resolveSkillDirs,
  renderRoutingPrompt,
} from '../src/index.js'
import { ROLES, ROLE_NAMES } from '../src/roles.js'

const TIERS = {
  strong: { provider: 'gw', model: 'big-model' },
  worker: { provider: 'gw', model: 'fast-model' },
}

test('every role declares a tool name, a known tier, a summary and a persona', () => {
  const tools = new Set()
  for (const name of ROLE_NAMES) {
    const role = ROLES[name]
    assert.match(role.tool, /^[a-z][a-z0-9_]*$/, `${name}: tool name must be snake_case`)
    assert.ok(!tools.has(role.tool), `${name}: duplicate tool name ${role.tool}`)
    tools.add(role.tool)
    assert.ok(['strong', 'worker'].includes(role.tier), `${name}: unknown tier`)
    assert.ok(role.summary.length > 10, `${name}: summary too thin`)
    assert.ok(role.persona.length > 100, `${name}: persona too thin`)
  }
  assert.equal(tools.size, ROLE_NAMES.length)
})

test('with no config every role still registers, on the deployment default model', () => {
  const resolved = resolveRoles()
  assert.equal(resolved.length, ROLE_NAMES.length)
  for (const entry of resolved) {
    assert.equal(entry.agentOptions, undefined)
    assert.ok(entry.persona.length > 0)
  }
})

test('tiers split the roles across two models', () => {
  const resolved = resolveRoles(TIERS)
  const byRole = Object.fromEntries(resolved.map((e) => [e.role, e]))

  assert.deepEqual(byRole.reviewer.agentOptions, { provider: 'gw', model: 'big-model' })
  assert.deepEqual(byRole.architect.agentOptions, { provider: 'gw', model: 'big-model' })
  assert.deepEqual(byRole.builder.agentOptions, { provider: 'gw', model: 'fast-model' })
  assert.deepEqual(byRole.tester.agentOptions, { provider: 'gw', model: 'fast-model' })
})

test('a role override beats its tier; tier maxTokens is inherited', () => {
  const resolved = resolveRoles({
    ...TIERS,
    strong: { ...TIERS.strong, maxTokens: 4096 },
    roles: {
      builder: { tier: 'strong' },
      reviewer: { provider: 'other', model: 'specialist', maxTokens: 128 },
    },
  })
  const byRole = Object.fromEntries(resolved.map((e) => [e.role, e]))

  assert.deepEqual(byRole.builder.agentOptions, {
    provider: 'gw',
    model: 'big-model',
    maxTokens: 4096,
  })
  assert.deepEqual(byRole.reviewer.agentOptions, {
    provider: 'other',
    model: 'specialist',
    maxTokens: 128,
  })
})

test('a disabled role is not registered, and a tool can be renamed', () => {
  const resolved = resolveRoles({
    ...TIERS,
    roles: { optimizer: { enabled: false }, analyzer: { toolName: 'deep_think' } },
  })
  const names = resolved.map((e) => e.role)
  assert.ok(!names.includes('optimizer'))
  assert.equal(resolved.length, ROLE_NAMES.length - 1)
  assert.equal(resolved.find((e) => e.role === 'analyzer').toolName, 'deep_think')
})

test('half a route is refused: provider without model falls back to the default model', () => {
  const resolved = resolveRoles({ strong: { provider: 'gw' }, worker: { model: 'fast-model' } })
  for (const entry of resolved) assert.equal(entry.agentOptions, undefined)
})

test('a typo in a role name or tier is refused loudly, never silently ignored', () => {
  assert.throws(
    () => resolveRoles({ roles: { reviewrs: { enabled: false } } }),
    /unknown role "reviewrs"/,
  )
  assert.throws(
    () => resolveRoles({ roles: { reviewer: { tier: 'strongest' } } }),
    /unknown tier "strongest"/,
  )
})

test('the bundled skill root ships with the package and holds real bundles', () => {
  assert.ok(existsSync(BUNDLED_SKILL_DIR), 'skills/ must ship beside src/')
  for (const skill of ['ccg-workflow', 'verify-security', 'verify-quality', 'gen-docs']) {
    assert.ok(
      existsSync(new URL(`../skills/${skill}/SKILL.md`, import.meta.url)),
      `${skill}/SKILL.md is missing from the bundle`,
    )
  }
  // The bundled gates are CommonJS; without this the package's own
  // `"type": "module"` would make Node load them as ES modules and they fail.
  assert.ok(existsSync(new URL('../skills/package.json', import.meta.url)))
  assert.ok(existsSync(new URL('../skills/lib/shared.js', import.meta.url)))
})

test('skill roots resolve, can be switched off, and never publish a missing directory', () => {
  const present = { bundledDir: '/bundled', exists: () => true }
  const absent = { bundledDir: '/bundled', exists: () => false }

  assert.deepEqual(resolveSkillDirs({}, present), ['/bundled'])
  assert.deepEqual(resolveSkillDirs({ skills: false }, present), [])
  assert.deepEqual(resolveSkillDirs({}, absent), [])
  assert.deepEqual(
    resolveSkillDirs({ skillDirs: ['/extra', '  ', ''] }, present),
    ['/bundled', '/extra'],
  )
  assert.deepEqual(resolveSkillDirs({ skills: false, skillDirs: ['/extra'] }, absent), ['/extra'])
})

test('the declared Config schema accepts the documented shape and fills its defaults', () => {
  const validated = Config({
    strong: { provider: 'gw', model: 'big-model' },
    worker: { provider: 'gw', model: 'fast-model' },
    roles: {
      builder: { tier: 'strong' },
      optimizer: { enabled: false },
      analyzer: { toolName: 'deep_think' },
    },
  })

  assert.equal(validated.subagentProvider, 'spawn')
  assert.equal(validated.maxDepth, 2)
  assert.equal(validated.backgroundMode, 'one-shot')
  assert.equal(validated.routingPrompt, true)

  // The schema must survive the round trip into the resolver — a dict that
  // validates but drops its entries would silently disable every override.
  const resolved = resolveRoles(validated)
  assert.equal(resolved.length, ROLE_NAMES.length - 1)
  assert.deepEqual(
    resolved.find((e) => e.role === 'builder').agentOptions,
    { provider: 'gw', model: 'big-model' },
  )
  assert.equal(resolved.find((e) => e.role === 'analyzer').toolName, 'deep_think')
})

test('the routing prompt states each tool\'s real route and never invents one', () => {
  const text = renderRoutingPrompt(resolveRoles(TIERS))
  assert.match(text, /`ccg_review` \(reviewer, gw \/ big-model\)/)
  assert.match(text, /`ccg_build` \(builder, gw \/ fast-model\)/)

  const unconfigured = renderRoutingPrompt(resolveRoles())
  assert.match(unconfigured, /deployment default model/)
  assert.ok(!unconfigured.includes('big-model'))
})
