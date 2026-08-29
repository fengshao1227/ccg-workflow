/**
 * Unit tests for who reads CCG's conventions.
 *
 * A `systemPrompt` registration is global: every agent in the deployment reads
 * it, including the children this plugin starts. That was observed live — a
 * hired teammate opened its first turn with "**Mode: Direct**" because it had
 * been handed the triage convention meant for the agent talking to the user.
 *
 * The leak is silent and it is per request, so it is worth a test that does not
 * depend on noticing it in a transcript again.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { coordinatorOnly } from '../src/index.js'

/**
 * An agent as `delegationDepthOf` actually reads it: the persisted session
 * header is authoritative and the runtime option may only deepen it, so both
 * halves have to be present for a stub to prove anything.
 */
function agentAtDepth({ header, runtime } = {}) {
  return {
    id: 'agent',
    options: runtime === undefined ? {} : { subagentDepth: runtime },
    session: { header: header === undefined ? {} : { delegationDepth: header } },
  }
}

test('the coordinator reads the convention', () => {
  const text = coordinatorOnly('CCG triage — pick a gear.')
  assert.equal(text({ agent: agentAtDepth({ header: 0, runtime: 0 }) }), 'CCG triage — pick a gear.')
  // A top-level agent carries neither value; absence is depth zero.
  assert.equal(text({ agent: agentAtDepth() }), 'CCG triage — pick a gear.')
})

test('a delegated child does not — at any depth, by either signal', () => {
  const text = coordinatorOnly('CCG triage — pick a gear.')

  // A teammate told to triage announces a mode nobody asked for, and a teammate
  // told about `ccg_team` can hire a team of its own inside the depth cap.
  assert.equal(text({ agent: agentAtDepth({ runtime: 1 }) }), '')
  assert.equal(text({ agent: agentAtDepth({ header: 3, runtime: 3 }) }), '')

  // A cold-resumed child arrives with fresh options and only its header knows
  // it is a child — reading the option alone would let it back in.
  assert.equal(text({ agent: agentAtDepth({ header: 1 }) }), '')
})

test('an assembly with no agent keeps the convention', () => {
  // Diagnostics assemble without an agent. Blanking there would hide the
  // convention from tooling that inspects the composed prompt.
  const text = coordinatorOnly('body')
  assert.equal(text({}), 'body')
  assert.equal(text(undefined), 'body')
})

test('an unreadable depth keeps the convention rather than losing it', () => {
  // `delegationDepthOf` throws on a malformed depth. Failing closed would
  // silently delete the plugin's entire reason for existing; failing open costs
  // one child some tokens. Prefer the cheaper failure.
  const text = coordinatorOnly('body')
  assert.equal(text({ agent: agentAtDepth({ header: 0, runtime: -1 }) }), 'body')
  assert.equal(text({ agent: agentAtDepth({ header: 0, runtime: 'two' }) }), 'body')
  // And a shape this plugin cannot read at all.
  assert.equal(text({ agent: { id: 'x' } }), 'body')
})
