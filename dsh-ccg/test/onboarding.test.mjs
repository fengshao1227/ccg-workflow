/**
 * Unit tests for what a brand-new install says.
 *
 * The stated principle is that every prompt is generated from the resolved
 * matrix, so it can never advertise something this deployment does not have.
 * That was honoured for the per-role model names and NOT for the prose around
 * them: with no tiers configured the routing preamble promised "several models
 * at once" while `ccg_crosscheck` was not even registered, and Deep described
 * panels that did not exist. A fresh install is the configuration most users
 * see first and the one least likely to be checked, so it gets its own tests.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveRoles } from '../src/roles.js'
import { renderRoutingPrompt } from '../src/index.js'
import { renderTriagePrompt, costMode } from '../src/modes.js'
import { resolvePanel } from '../src/crosscheck.js'

const TIERS = { strong: { provider: 'gw', model: 'big' }, worker: { provider: 'gw', model: 'fast' } }
const WITH_PANEL = {
  ...TIERS,
  roles: { reviewer: { models: [{ provider: 'gw', model: 'big' }, { provider: 'rival', model: 'other' }] } },
}

test('a fresh install does not promise a panel it has not got', () => {
  const bare = renderRoutingPrompt(resolveRoles({}), resolvePanel({}))
  // `ccg_crosscheck` is not registered without two distinct members, so the
  // preamble must not advertise asking several models at once.
  assert.ok(!bare.includes('several models at once'))
  assert.match(bare, /the role whose instructions fit it/)

  const routed = renderRoutingPrompt(resolveRoles(WITH_PANEL), resolvePanel(WITH_PANEL))
  assert.match(routed, /several models at once/)
})

test('a fresh install says out loud that it is only half itself', () => {
  const bare = renderRoutingPrompt(resolveRoles({}), [])
  assert.match(bare, /no model routing is configured/)
  // The point, not just the fact: personas without routing are most of the cost
  // and little of the value.
  assert.match(bare, /a second\nopinion from the same model is not a second opinion/)
  // And where to fix it, for a user who never opens the card.
  assert.match(bare, /Settings › Plugins › CCG/)

  // One tier is enough to be routed; the nudge must then disappear.
  assert.ok(!renderRoutingPrompt(resolveRoles({ strong: { provider: 'gw', model: 'big' } }), []).includes('NOTE:'))
  assert.ok(!renderRoutingPrompt(resolveRoles(TIERS), []).includes('NOTE:'))
})

test('Deep claims panels only where the plan really holds them', () => {
  const bare = costMode(resolveRoles({}), 'deep')
  assert.equal(bare.panelled, false)
  assert.ok(!bare.keeps.includes('several models'))

  const panelled = costMode(resolveRoles(WITH_PANEL), 'deep')
  assert.equal(panelled.panelled, true)
  assert.match(panelled.keeps, /Roles holding several models answer with all of them at once/)

  // And it reaches the rendered menu, which is what the model actually reads.
  assert.ok(!renderTriagePrompt(resolveRoles({}), { team: true }).includes('all of them at once'))
  assert.match(renderTriagePrompt(resolveRoles(WITH_PANEL), { team: true }), /all of them at once/)
})

test('every role still registers with no configuration at all', () => {
  // The zero-config promise: personas work immediately, routing is the upgrade.
  const bare = resolveRoles({})
  assert.equal(bare.length, 7)
  assert.ok(bare.every((entry) => entry.members.length === 0))
  assert.ok(bare.every((entry) => entry.persona.length > 0))
  assert.match(renderRoutingPrompt(bare, []), /deployment default model/)
})
