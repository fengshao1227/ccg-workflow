/**
 * Unit tests for triage. The menu the model reads is generated from the roles
 * actually mounted, so these check the one property that matters: it can never
 * advertise a step or a cost this deployment would not really spend.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { MODE_NAMES, buildModeMenu, costMode, renderTriagePrompt } from '../src/modes.js'
import { resolveRoles } from '../src/roles.js'

const CONFIG = {
  strong: { provider: 'claude', model: 'opus' },
  worker: { provider: 'claude', model: 'sonnet' },
  roles: {
    analyzer: {
      models: [
        { provider: 'claude', model: 'opus' },
        { provider: 'gpt', model: 'sol' },
        { provider: 'grok', model: 'g4' },
      ],
    },
    reviewer: {
      models: [{ provider: 'claude', model: 'opus' }, { provider: 'gpt', model: 'sol' }],
    },
  },
}

test('direct spends nothing; the deeper modes cost what their panels really cost', () => {
  const resolved = resolveRoles(CONFIG)

  const direct = costMode(resolved, 'direct')
  assert.deepEqual(direct.steps, [])
  assert.equal(direct.modelCalls, 0)

  // design(1) + build(1) + review(2 models) = 3 delegations, 4 model calls.
  const standard = costMode(resolved, 'standard')
  assert.equal(standard.delegations, 3)
  assert.equal(standard.modelCalls, 4)

  // analyze(3) + design(1) + build(1) + test(1) + review(2) = 5 / 8.
  const deep = costMode(resolved, 'deep')
  assert.equal(deep.delegations, 5)
  assert.equal(deep.modelCalls, 8)
  assert.deepEqual(
    deep.steps.find((step) => step.role === 'analyzer').models,
    ['claude / opus', 'gpt / sol', 'grok / g4'],
  )
})

test('a disabled role is dropped from every mode rather than promised', () => {
  const resolved = resolveRoles({
    ...CONFIG,
    roles: { ...CONFIG.roles, tester: { enabled: false }, builder: { enabled: false } },
  })
  const deep = costMode(resolved, 'deep')
  const roles = deep.steps.map((step) => step.role)

  assert.ok(!roles.includes('tester'))
  assert.ok(!roles.includes('builder'))
  assert.equal(deep.delegations, roles.length)
})

test('an unconfigured deployment still offers the modes, on the default model', () => {
  const resolved = resolveRoles({})
  const standard = costMode(resolved, 'standard')

  assert.equal(standard.delegations, 3)
  // One call per role: nothing is pinned, so each child takes the deployment default.
  assert.equal(standard.modelCalls, 3)
  assert.deepEqual(standard.steps[0].models, ['deployment default'])
})

test('the menu is cheapest-first and covers every declared mode', () => {
  const menu = buildModeMenu(resolveRoles(CONFIG))
  assert.deepEqual(menu.map((entry) => entry.mode), MODE_NAMES)
  assert.ok(menu[0].modelCalls <= menu[1].modelCalls)
  assert.ok(menu[1].modelCalls <= menu[2].modelCalls)
})

test('the prompt names each tool with its real models and its real cost', () => {
  const text = renderTriagePrompt(resolveRoles(CONFIG))

  assert.match(text, /ccg_analyze → claude \/ opus \+ gpt \/ sol \+ grok \/ g4/)
  assert.match(text, /Cost: 5 delegations, 8 model calls\./)
  assert.match(text, /Direct needs no permission/)
  assert.match(text, /wait for a yes/)
  assert.match(text, /The user overrules you/)

  // Nothing is mounted: there is no menu to offer and no prompt to publish.
  assert.equal(renderTriagePrompt([]), '')
})

test('every role a mode names is one the plugin actually registers', () => {
  const resolved = resolveRoles(CONFIG)
  const mounted = new Set(resolved.map((entry) => entry.role))
  for (const entry of buildModeMenu(resolved)) {
    for (const step of entry.steps) {
      assert.ok(mounted.has(step.role), `${entry.mode} names unmounted role ${step.role}`)
      assert.equal(step.tool, resolved.find((role) => role.role === step.role).toolName)
    }
  }
})
