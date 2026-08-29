/**
 * Unit tests for the team strip's data seam.
 *
 * The strip above the composer is polled by a browser while a turn runs, which
 * makes two things worth pinning down: it must be scoped to the conversation
 * asking (one session must never see another's teammates), and it must be a
 * pure read — `ccg_roster` prunes stale rows because a model reading the roster
 * is a considered act, but a background GET that deletes durable rows would
 * unclaim files nobody asked it to.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildTeamPayload, liveActivity, TEAM_API_PATH } from '../src/api.js'
import { rosterOf } from '../src/memory.js'

/** A stand-in for the storage-domain table: only `entries()` is read here. */
function tableOf(rows) {
  const map = new Map(rows.map((row) => [row.childId, row]))
  return {
    entries: () => map.entries(),
    get: (id) => map.get(id),
    delete: async (id) => map.delete(id),
    size: () => map.size,
  }
}

const ROWS = [
  {
    childId: 'child-a',
    hiredBy: 'session-1',
    workspace: '/w',
    role: 'builder',
    label: 'the parser',
    provider: 'gw',
    model: 'fast-model',
    owns: ['src/parse.js'],
    hiredAt: 10,
  },
  {
    childId: 'child-b',
    hiredBy: 'session-1',
    workspace: '/w',
    role: 'tester',
    label: 'the tests',
    owns: [],
    hiredAt: 20,
  },
  {
    childId: 'child-c',
    hiredBy: 'session-2',
    workspace: '/w',
    role: 'builder',
    label: 'another conversation',
    owns: ['src/other.js'],
    hiredAt: 30,
  },
]

test('the strip shows one conversation its own team and nobody else’s', () => {
  const table = tableOf(ROWS)

  const mine = buildTeamPayload(rosterOf(table, 'session-1'))
  assert.deepEqual(mine.teammates.map((entry) => entry.childId), ['child-a', 'child-b'])

  // Ownership is per lineage: this session cannot message session-2's teammate,
  // so showing it in *this* strip would invite exactly the wrong action.
  const theirs = buildTeamPayload(rosterOf(table, 'session-2'))
  assert.deepEqual(theirs.teammates.map((entry) => entry.childId), ['child-c'])

  assert.deepEqual(buildTeamPayload(rosterOf(table, 'nobody')).teammates, [])
})

test('a row carries what the harness does not: role, route, and the files', () => {
  const [first, second] = buildTeamPayload(rosterOf(tableOf(ROWS), 'session-1'), {
    'child-a': 'running',
  }).teammates

  assert.deepEqual(first, {
    childId: 'child-a',
    role: 'builder',
    label: 'the parser',
    provider: 'gw',
    model: 'fast-model',
    owns: ['src/parse.js'],
    hiredAt: 10,
    activity: 'running',
  })

  // No route means the deployment default answered; saying "gw / undefined"
  // would name a model that does not exist.
  assert.equal(second.provider, undefined)
  assert.equal(second.model, undefined)
  // Absent from the live listing is NOT "gone" — a teammate hired seconds ago
  // is legitimately unlisted (the creation window), so nothing is claimed.
  assert.equal(second.activity, undefined)
})

test('reading the strip never mutates the roster', async () => {
  const table = tableOf(ROWS)
  const before = table.size()

  // Every row is absent from the live listing, and old enough that the roster
  // tool would have pruned all of them.
  const status = await liveActivity({ listChildren: async () => [] }, 'session-1', ROWS)
  buildTeamPayload(rosterOf(table, 'session-1'), status)

  assert.equal(table.size(), before)
  assert.deepEqual(status, {})
})

test('live activity reads `activity`, and a service that cannot answer says nothing', async () => {
  const status = await liveActivity({
    listChildren: async () => [
      { id: 'child-a', activity: 'running' },
      { id: 'child-b', activity: 'inactive' },
      // A `status` field does not exist on the entry; reading one silently
      // produced no status at all until that was caught.
      { id: 'child-z', status: 'running' },
      { activity: 'running' },
    ],
  }, 'session-1', ROWS)

  assert.deepEqual(status, { 'child-a': 'running', 'child-b': 'inactive' })

  // A refusal or a missing service is not a claim that nobody is running.
  assert.deepEqual(
    await liveActivity({ listChildren: async () => { throw new Error('nope') } }, 's', ROWS),
    {},
  )
  assert.deepEqual(await liveActivity(undefined, 's', ROWS), {})
  // An empty roster asks nothing at all.
  let asked = false
  await liveActivity({ listChildren: async () => { asked = true; return [] } }, 's', [])
  assert.equal(asked, false)
})

test('the route answers on its own path, separate from the card’s', () => {
  assert.equal(TEAM_API_PATH, '/api/ccg/team')
})
