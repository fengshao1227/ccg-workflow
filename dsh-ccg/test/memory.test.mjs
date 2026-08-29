/**
 * Unit tests for team memory — the durable ownership map.
 *
 * The collision test is the important one: it is what turns "one writer per
 * file" from a paragraph in a persona into something the plugin enforces. It
 * is deliberately generous — a claim that MIGHT overlap counts — because a
 * false positive costs one reworded assignment and a false negative costs two
 * agents silently overwriting each other.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  TEAM_DOMAIN,
  collisionsWith,
  describeCollisions,
  foreignClaimsIn,
  formatRoster,
  normaliseOwns,
  normalisePath,
  PRUNE_GRACE_MS,
  sweepStale,
  pathsCollide,
  reachOf,
  rosterToolDefinition,
  rosterOf,
} from '../src/memory.js'

/** A table handle shaped like the domain's `KvTable`, backed by a Map. */
function stubTable(rows = []) {
  const map = new Map(rows.map((row) => [row.childId, row]))
  return {
    map,
    get: (key) => map.get(key),
    entries: () => map.entries(),
    keys: () => map.keys(),
    get size() { return map.size },
    async put(key, value) { map.set(key, value) },
    async delete(key) { return map.delete(key) },
  }
}

function row(childId, owns, extra = {}) {
  return {
    childId,
    hiredBy: 'coordinator-1',
    role: 'builder',
    label: childId,
    provider: 'gw',
    model: 'fast',
    owns,
    hiredAt: 1,
    ...extra,
  }
}

test('the domain declares a name the harness will accept', () => {
  // `UNIT_NAME_RE` is /^[a-z][a-z0-9_]*$/ and rejects at module load, so a
  // hyphen here would take the whole plugin down before anything mounted.
  assert.match(TEAM_DOMAIN.name, /^[a-z][a-z0-9_]*$/)
  assert.equal(TEAM_DOMAIN.version, 1)
  assert.ok(TEAM_DOMAIN.tables.teammates)
})

test('paths that name the same file collide however they were spelled', () => {
  assert.equal(pathsCollide('src/a.js', 'src/a.js'), true)
  assert.equal(pathsCollide('./src/a.js', 'src/a.js'), true)
  assert.equal(pathsCollide('src//a.js', 'src/a.js'), true)
  assert.equal(pathsCollide('src\\a.js', 'src/a.js'), true)
})

test('a directory collides with everything beneath it', () => {
  assert.equal(pathsCollide('src/', 'src/a.js'), true)
  assert.equal(pathsCollide('src', 'src/deep/a.js'), true)
  assert.equal(pathsCollide('src/parse/', 'src/'), true)
  // But not with a sibling, which is the whole point of splitting the work.
  assert.equal(pathsCollide('src/parse/', 'src/render/'), false)
  // And not with a directory that merely shares a prefix string.
  assert.equal(pathsCollide('src', 'srcache/a.js'), false)
})

test('a glob collides with anything under the directory it can reach', () => {
  assert.equal(reachOf('src/*.js'), 'src')
  assert.equal(reachOf('src/**/*.ts'), 'src')
  assert.equal(reachOf('src/a.js'), 'src/a.js')
  // A pattern rooted at the workspace reaches everything.
  assert.equal(reachOf('*.js'), '')

  assert.equal(pathsCollide('src/*.js', 'src/a.js'), true)
  assert.equal(pathsCollide('src/**/*.ts', 'src/deep/a.ts'), true)
  assert.equal(pathsCollide('src/*.js', 'test/a.js'), false)
  // Rooted globs collide with everything — generous on purpose.
  assert.equal(pathsCollide('*.js', 'src/a.js'), true)
})

test('an empty claim collides with nothing', () => {
  assert.equal(pathsCollide('', 'src/a.js'), false)
  assert.equal(pathsCollide('src/a.js', '   '), false)
  assert.equal(normalisePath('./'), '')
  assert.equal(normalisePath(undefined), '')
})

test('a declared set is trimmed and deduplicated', () => {
  assert.deepEqual(
    normaliseOwns([' src/a.js ', 'src/a.js', './src/a.js', '', null, 'src/b.js']),
    ['src/a.js', 'src/b.js'],
  )
  assert.deepEqual(normaliseOwns(undefined), [])
})

test('a hire that would take a live teammate\'s files is identified, with whose', () => {
  const rows = [row('child-a', ['src/parse']), row('child-b', ['src/render'])]

  assert.deepEqual(collisionsWith(rows, ['src/emit']), [])

  const clash = collisionsWith(rows, ['src/parse/lexer.js', 'src/emit'])
  assert.equal(clash.length, 1)
  assert.equal(clash[0].row.childId, 'child-a')
  assert.deepEqual(clash[0].clashes, [{ held: 'src/parse', claim: 'src/parse/lexer.js' }])

  const message = describeCollisions(clash)
  assert.match(message, /child-a/)
  // What THEY hold and what YOU asked for must be separable in one reading:
  // "already owns A overlaps B" reads as though they owned B.
  assert.match(message, /already owns src\/parse$/m)
  assert.match(message, /you asked for src\/parse\/lexer\.js, which overlaps their src\/parse/)
  // And it says what to do instead, since "taken" alone leaves the model guessing.
  assert.match(message, /send_message/)
  assert.match(message, /action "release"/)

  // An exact same-path clash says so rather than claiming an overlap.
  const exact = describeCollisions(collisionsWith([row('child-a', ['src/a.js'])], ['src/a.js']))
  assert.match(exact, /you asked for src\/a\.js, which is exactly theirs/)
})

test('one coordinator does not see another\'s team', () => {
  const table = stubTable([
    row('child-a', ['src/a.js']),
    row('child-b', ['src/b.js'], { hiredBy: 'coordinator-2' }),
  ])
  assert.deepEqual(rosterOf(table, 'coordinator-1').map((r) => r.childId), ['child-a'])
  assert.deepEqual(rosterOf(table, 'coordinator-2').map((r) => r.childId), ['child-b'])
  assert.deepEqual(rosterOf(undefined, 'coordinator-1'), [])
})

test('the roster names owner, route and files, and says what ownership means', () => {
  const text = formatRoster([row('child-a', ['src/parse', 'test/parse'])], { 'child-a': 'idle' })
  assert.match(text, /builder · child-a/)
  assert.match(text, /id child-a · idle · gw \/ fast/)
  assert.match(text, /owns src\/parse, test\/parse/)
  assert.match(text, /`send_message` its owner/)

  const empty = formatRoster([])
  assert.match(empty, /No teammates/)
  assert.match(empty, /every file is yours/)

  // A teammate hired with no exclusive files must not read as owning nothing
  // by accident — it says so.
  assert.match(formatRoster([row('child-a', [])]), /\(nothing exclusively\)/)
})

test('the roster definition compiles — a bad schema takes the whole tool table down', () => {
  const definition = rosterToolDefinition({ getTable: () => stubTable() })
  assert.equal(definition.name, 'ccg_roster')
  assert.deepEqual(definition.output.schema.required, ['action', 'count', 'text'])
  assert.equal(definition.output.schema.additionalProperties, false)
  const [block] = definition.output.render({}, { action: 'list', count: 0, text: 'hello' })
  assert.equal(block.text, 'hello')
})

test('release hands the files back, and only to the coordinator holding them', async () => {
  const table = stubTable([row('child-a', ['src/parse'])])
  const definition = rosterToolDefinition({ getTable: () => table })
  const exec = { agent: { id: 'coordinator-1' } }

  const listed = await definition.execute({ action: 'list' }, exec)
  assert.equal(listed.count, 1)

  const released = await definition.execute({ action: 'release', subagent_id: 'child-a' }, exec)
  assert.equal(released.released, 'child-a')
  assert.equal(released.count, 0)
  assert.equal(table.map.size, 0)
  // Releasing ends a claim, not a teammate — saying otherwise would invite the
  // coordinator to assume the child is gone.
  assert.match(released.text, /still alive/)

  await assert.rejects(
    () => definition.execute({ action: 'release', subagent_id: 'nobody' }, exec),
    /no teammate "nobody" on your roster/,
  )
  await assert.rejects(
    () => definition.execute({ action: 'release' }, exec),
    /needs the teammate's subagent_id/,
  )
})

test('a coordinator cannot release a teammate it did not hire', async () => {
  const table = stubTable([row('child-b', ['src/b.js'], { hiredBy: 'coordinator-2' })])
  const definition = rosterToolDefinition({ getTable: () => table })
  await assert.rejects(
    () => definition.execute(
      { action: 'release', subagent_id: 'child-b' },
      { agent: { id: 'coordinator-1' } },
    ),
    /no teammate "child-b" on your roster/,
  )
  assert.equal(table.map.size, 1)
})

test('without a storage form the roster says so rather than claiming an empty team', async () => {
  const definition = rosterToolDefinition({ getTable: () => undefined })
  await assert.rejects(
    () => definition.execute({ action: 'list' }, { agent: { id: 'c' } }),
    /team memory is unavailable/,
  )
})

test('live status is a bonus, not a dependency', async () => {
  const table = stubTable([row('child-a', ['src/a.js'])])
  // A subagent service that throws must not cost the ownership map, which is
  // the part nothing else in the harness holds.
  const definition = rosterToolDefinition({
    getTable: () => table,
    getSubagents: () => ({ listChildren: async () => { throw new Error('nope') } }),
  })
  const result = await definition.execute({ action: 'list' }, { agent: { id: 'coordinator-1' } })
  assert.equal(result.count, 1)
  assert.match(result.text, /owns src\/a\.js/)
})

test('a file claimed by another conversation is a warning, never a refusal', () => {
  const table = stubTable([
    row('mine', ['src/a.js'], { workspace: '/w/p' }),
    row('theirs', ['src/b.js'], { hiredBy: 'coordinator-2', workspace: '/w/p' }),
    row('elsewhere', ['src/c.js'], { hiredBy: 'coordinator-2', workspace: '/w/other' }),
  ])

  const foreign = foreignClaimsIn(table, '/w/p', 'coordinator-1')
  assert.deepEqual(foreign.map((r) => r.childId), ['theirs'])
  // Another workspace is none of this conversation's business.
  assert.deepEqual(foreignClaimsIn(table, '/w/other', 'coordinator-1').map((r) => r.childId), ['elsewhere'])
  // And with no workspace to compare, nothing is claimed.
  assert.deepEqual(foreignClaimsIn(table, undefined, 'coordinator-1'), [])

  const text = formatRoster(rosterOf(table, 'coordinator-1'), {}, foreign)
  assert.match(text, /Claimed by another conversation/)
  assert.match(text, /you cannot message these teammates/)
  assert.match(text, /theirs.*src\/b\.js/)

  // The warning also reaches a conversation with no team of its own — that is
  // exactly the session most likely to overwrite someone.
  assert.match(formatRoster([], {}, foreign), /Claimed by another conversation/)

  // It must NOT block a hire: the other session may be long gone, and a guard
  // this conversation cannot lift would be a deadlock.
  assert.deepEqual(collisionsWith(rosterOf(table, 'coordinator-1'), ['src/b.js']), [])
})

test('a row the harness no longer holds is retired — but only on positive evidence', async () => {
  const now = 1_000_000_000
  const old = now - 10 * 60 * 1000
  const table = stubTable([
    row('alive', ['src/a.js'], { hiredAt: old }),
    row('gone', ['src/b.js'], { hiredAt: old }),
  ])

  const removed = await sweepStale(
    table,
    ['coordinator-1'],
    async () => [{ kind: 'child', id: 'alive', activity: 'inactive', mode: 'continuable' }],
    now,
  )
  assert.deepEqual(removed, ['gone'])
  assert.deepEqual([...table.map.keys()], ['alive'])
  // `inactive` is persisted-but-not-running, which is still held — only absence
  // from the listing means gone.
})

test('a teammate hired moments ago is never swept', async () => {
  // `listChildren` omits "a running candidate without [an identity] — its
  // descriptor may not be appended yet". Sweeping on that absence would unclaim
  // a live teammate's files and let the next hire overwrite it.
  const now = 1_000_000_000
  const table = stubTable([row('fresh', ['src/a.js'], { hiredAt: now - 1000 })])
  assert.deepEqual(await sweepStale(table, ['coordinator-1'], async () => [], now), [])
  assert.equal(table.map.size, 1)

  // Past the grace window, the same absence is actionable.
  assert.deepEqual(
    await sweepStale(table, ['coordinator-1'], async () => [], now + PRUNE_GRACE_MS + 1),
    ['fresh'],
  )
})

test('a store that cannot answer keeps every row', async () => {
  const now = 1_000_000_000
  const table = stubTable([row('a', ['src/a.js'], { hiredAt: 0 })])

  // "The listing failed" and "the child is gone" are different facts, and only
  // one of them is safe to act on.
  assert.deepEqual(await sweepStale(table, ['coordinator-1'], async () => { throw new Error('down') }, now), [])
  assert.deepEqual(await sweepStale(table, ['coordinator-1'], async () => undefined, now), [])
  assert.deepEqual(await sweepStale(table, ['coordinator-1'], undefined, now), [])
  assert.deepEqual(await sweepStale(undefined, ['coordinator-1'], async () => [], now), [])
  assert.equal(table.map.size, 1)
})

test('sweeping covers the other conversations whose claims are shown here', async () => {
  const now = 1_000_000_000
  const table = stubTable([
    row('mine', ['src/a.js'], { hiredAt: 0, workspace: '/w' }),
    row('theirs', ['src/b.js'], { hiredAt: 0, workspace: '/w', hiredBy: 'coordinator-2' }),
  ])
  const asked = []
  await sweepStale(table, ['coordinator-1', 'coordinator-2'], async (id) => { asked.push(id); return [] }, now)
  assert.deepEqual(asked.sort(), ['coordinator-1', 'coordinator-2'])
  assert.equal(table.map.size, 0)
})

test('the roster reports what it retired, and reads live activity correctly', async () => {
  const now = 1_000_000_000
  const table = stubTable([
    row('alive', ['src/a.js'], { hiredAt: 0 }),
    row('gone', ['src/b.js'], { hiredAt: 0 }),
  ])
  const definition = rosterToolDefinition({
    getTable: () => table,
    // The entry field is `activity`, not `status`; reading the wrong one
    // silently produced no status at all for every teammate.
    getSubagents: () => ({
      listChildren: async () => [{ kind: 'child', id: 'alive', activity: 'running', mode: 'continuable' }],
    }),
    now: () => now,
  })

  const result = await definition.execute({ action: 'list' }, { agent: { id: 'coordinator-1' } })
  assert.equal(result.count, 1)
  assert.equal(result.pruned, 1)
  assert.match(result.text, /1 teammate the harness no longer holds/)
  assert.match(result.text, /their files are free again/)
  assert.match(result.text, /id alive · running · gw \/ fast/)
})
