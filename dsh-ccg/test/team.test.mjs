/**
 * Unit tests for teams — hiring a CCG role as a colleague that stays alive.
 *
 * Two things are worth testing without a harness: what a teammate is told
 * (pure text, and the difference between a teammate and a one-shot child lives
 * entirely in it), and that the tool definition compiles — a definition that
 * throws takes the whole tool table down, not just this tool.
 *
 * The hire itself is exercised against a stub subagent service, because what
 * matters is the shape of the `startContinuable` call: the wrong provider, a
 * missing persona or the wrong route would all still "work" and quietly hire
 * the wrong colleague.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveRoles } from '../src/roles.js'
import {
  HIRE_APPROVE,
  HIRE_DECLINE,
  HIRE_QUESTION_ID,
  buildTeammatePersona,
  buildTeammatePrompt,
  confirmHire,
  describeTeam,
  formatHireReport,
  hireApprovalQuestion,
  readApproval,
  renderTeamPrompt,
  teamToolDefinition,
  teammateRoute,
} from '../src/team.js'
import { buildModeMenu, renderTriagePrompt } from '../src/modes.js'

const TIERS = {
  strong: { provider: 'gw', model: 'big-model' },
  worker: { provider: 'gw', model: 'fast-model' },
}

/** A subagent service that records what it was asked to start. */
function stubSubagents() {
  const calls = []
  return {
    calls,
    async startContinuable(spec) {
      calls.push(spec)
      return { childId: 'child-42', messageId: 'msg-1' }
    },
  }
}

/** Compile the hiring tool over a resolved matrix, wired to a stub service. */
function hiringTool(config = TIERS, subagents = stubSubagents(), extra = {}) {
  const definition = teamToolDefinition({
    resolved: resolveRoles(config),
    getSubagents: () => subagents,
    ...extra,
  })
  return { definition, subagents }
}

/** A user-questions provider that records what it was asked and answers it. */
function stubQuestions(reply) {
  const asked = []
  return {
    asked,
    async ask(request) {
      asked.push(request)
      if (typeof reply === 'function') return reply(request)
      return reply
    },
  }
}

/** An answer selecting one option for the hire question. */
const answering = (label) => ({ answers: [{ id: HIRE_QUESTION_ID, selected: [label] }] })

test('the hiring definition compiles — a bad schema takes the whole tool table down', () => {
  const { definition } = hiringTool()

  assert.equal(definition.name, 'ccg_team')
  assert.deepEqual(definition.parameters.required, ['role', 'description', 'prompt'])
  // The compiler rewrites the DSL's per-field `required` into a list; seeing it
  // here proves the schema went through the compiler rather than past it.
  // `hired` is required and `childId` is not: a declined hire is a real result
  // with no child, and modelling it as an error would read as a malfunction.
  assert.deepEqual(definition.output.schema.required, ['hired', 'role', 'label', 'route'])
  assert.equal(definition.output.schema.additionalProperties, false)

  // The render path runs on every result; a throw there is also a broken tool.
  const [block] = definition.output.render({}, {
    hired: true,
    childId: 'child-42',
    role: 'builder',
    label: 'parser rewrite',
    route: 'gw / fast-model',
    owns: ['src/parse/'],
  })
  assert.match(block.text, /builder teammate hired: child-42/)

  // Both arms render: a decline has no childId, and a report that tried to name
  // one would print `undefined` at the user.
  const [declined] = definition.output.render({}, {
    hired: false,
    role: 'builder',
    label: 'parser rewrite',
    route: 'gw / fast-model',
  })
  assert.match(declined.text, /Not hired: the user declined/)
  assert.doesNotMatch(declined.text, /undefined/)
})

test('only roles this deployment actually mounted can be hired', () => {
  const { definition } = hiringTool({ ...TIERS, roles: { optimizer: { enabled: false } } })

  const roles = definition.parameters.properties.role.enum
  assert.ok(roles.includes('builder'))
  // A role switched off in config must not be offered — hiring it would fail
  // at execute time after the model already committed to the plan.
  assert.ok(!roles.includes('optimizer'))
})

test('a teammate is told the three things that make it not a one-shot child', () => {
  const [builder] = resolveRoles(TIERS).filter((entry) => entry.role === 'builder')
  const persona = buildTeammatePersona(builder, ['src/parse/', 'test/parse/'])

  // Its expertise.
  assert.match(persona, /CCG's implementation engineer/)
  // It will be spoken to again.
  assert.match(persona, /stay alive between assignments/)
  // It must speak first.
  assert.match(persona, /Nobody sees your work unless you `report` it/)
  assert.match(persona, /report EARLIER|report\n.*EARLIER|EARLIER/)
  // It is not alone in the tree.
  assert.match(persona, /You own these paths, and only these:/)
  assert.match(persona, /src\/parse\//)
  assert.match(persona, /Do not create, edit, move or delete anything outside them/)
  // Reading widely is still encouraged — ownership bounds writes, not reads.
  assert.match(persona, /Reading outside your paths is/)
})

test('a teammate with no assigned files is warned rather than left to assume', () => {
  const [builder] = resolveRoles(TIERS).filter((entry) => entry.role === 'builder')
  const persona = buildTeammatePersona(builder, [])

  assert.match(persona, /have not been given exclusive files/)
  assert.match(persona, /report` the need rather than making it unilaterally/)
})

test('the opening message carries the assignment and the shared context, nothing else', () => {
  const prompt = buildTeammatePrompt('Rewrite the tokenizer.', 'The grammar is in grammar.md')
  assert.match(prompt, /First assignment:\nRewrite the tokenizer\./)
  assert.match(prompt, /Shared context:\nThe grammar is in grammar\.md/)

  // Persona is scoped to the child for its whole life; repeating it in turn one
  // would just pay for it twice.
  assert.ok(!prompt.includes('CCG'))
  assert.ok(!buildTeammatePrompt('Do it').includes('Shared context'))
})

test('hiring starts a continuable child on the role\'s own model, wearing its persona', async () => {
  const { definition, subagents } = hiringTool()

  const result = await definition.execute(
    {
      role: 'builder',
      description: 'parser rewrite',
      prompt: 'Rewrite the tokenizer to be streaming.',
      owns: ['src/parse/'],
    },
    { agent: { id: 'parent-1' }, signal: undefined },
  )

  assert.equal(subagents.calls.length, 1)
  const [spec] = subagents.calls
  assert.equal(spec.provider, 'spawn')
  assert.match(spec.label, /^builder · parser rewrite$/)
  // The worker tier serves builder, so the child must run there — not on the
  // deployment default, which is what an omitted agentOptions would mean.
  assert.deepEqual(spec.request.agentOptions, { provider: 'gw', model: 'fast-model' })
  assert.match(spec.request.persona, /CCG's implementation engineer/)
  assert.match(spec.request.persona, /You own these paths/)
  assert.match(spec.request.prompt[0].text, /Rewrite the tokenizer to be streaming\./)
  assert.equal(spec.request.parent.id, 'parent-1')

  // `owns` comes back normalised — the trailing slash is dropped so that
  // `src/parse/` and `src/parse` cannot be handed to two different teammates.
  assert.deepEqual(result, {
    hired: true,
    childId: 'child-42',
    role: 'builder',
    label: 'parser rewrite',
    route: 'gw / fast-model',
    owns: ['src/parse'],
  })
})

test('a role holding a panel hires its first model, and the report says which', async () => {
  const { definition, subagents } = hiringTool({
    ...TIERS,
    roles: {
      analyzer: {
        models: [{ provider: 'gw', model: 'big-model' }, { provider: 'rival', model: 'other' }],
      },
    },
  })

  const result = await definition.execute(
    { role: 'analyzer', description: 'survey', prompt: 'Map the call graph.' },
    { agent: { id: 'parent-1' } },
  )

  // A teammate is one agent; a panel role cannot hire all its models at once,
  // so what it did hire has to be visible rather than silently substituted.
  assert.deepEqual(subagents.calls[0].request.agentOptions, { provider: 'gw', model: 'big-model' })
  assert.equal(result.route, 'gw / big-model')
  assert.equal(result.owns, undefined)
})

test('hiring refuses what it cannot deliver instead of failing halfway', async () => {
  const noService = teamToolDefinition({ resolved: resolveRoles(TIERS), getSubagents: () => undefined })
  await assert.rejects(
    () => noService.execute({ role: 'builder', description: 'x', prompt: 'y' }, { agent: {} }),
    /subagents service is not available/,
  )

  // A deployment whose provider cannot keep children alive must say so, not
  // hire a one-shot child that silently never answers again.
  const oneShotOnly = teamToolDefinition({
    resolved: resolveRoles(TIERS),
    getSubagents: () => ({ start: async () => ({}) }),
  })
  await assert.rejects(
    () => oneShotOnly.execute({ role: 'builder', description: 'x', prompt: 'y' }, { agent: {} }),
    /cannot keep children alive/,
  )

  const { definition } = hiringTool()
  await assert.rejects(
    () => definition.execute({ role: 'builder', description: 'x', prompt: '  ' }, { agent: {} }),
    /a teammate needs an assignment/,
  )

  // A misspelt role never reaches `execute`: the framework validates the enum
  // first and names the valid roles, which is a better error than any thrown
  // here. The guard inside `execute` stays for direct calls, but this is the
  // message the model actually sees.
  await assert.rejects(
    () => definition.execute({ role: 'buidler', description: 'x', prompt: 'y' }, { agent: {} }),
    /"role" must be one of .*builder/,
  )
})

test('the hire report says the answer is not coming back through this call', () => {
  const text = formatHireReport({
    childId: 'child-42',
    role: 'builder',
    label: 'parser rewrite',
    route: 'gw / fast-model',
    owns: ['src/parse/'],
  })

  assert.match(text, /Nothing comes back through this call/)
  // Observed live: with everything delegated, the coordinator invented a
  // `sleep` loop and asked to escalate the sandbox for it. Ending the turn is
  // how you wait here, and nothing else says so.
  assert.match(text, /do not sleep, poll or loop waiting for/)
  assert.match(text, /Ending the turn costs nothing/)
  assert.match(text, /send_message\(child-42, \.\.\.\)/)
  assert.match(text, /interrupt_agent\(child-42\)/)
  assert.match(text, /Owns exclusively: src\/parse\//)
})

test('the team convention carries the two rules that keep concurrent agents safe', () => {
  const text = renderTeamPrompt(resolveRoles(TIERS))

  assert.match(text, /ONE WRITER PER FILE/)
  assert.match(text, /lose each other's work with no error/)
  assert.match(text, /SETTLE THE CONTRACTS FIRST/)
  assert.match(text, /Teammates cannot see each other/)
  // Observed live: the coordinator patched a file it had assigned to a
  // still-alive teammate. One writer per file has to bind the coordinator too.
  assert.match(text, /This binds YOU too/)
  assert.match(text, /taking it back/)
  // And how to wait, since sleeping is the obvious wrong answer.
  assert.match(text, /finishing your turn IS how you wait/)
  // And when a team is the wrong tool.
  assert.match(text, /work whose parts must happen in order/)

  assert.equal(renderTeamPrompt([]), '')
})

test('the tool description names every hirable role and what it runs on', () => {
  const description = describeTeam(resolveRoles(TIERS))
  assert.match(description, /builder \(gw \/ fast-model\)/)
  assert.match(description, /reviewer \(gw \/ big-model\)/)
  assert.match(description, /a teammate returns no answer through this call/)

  // With no tiers configured every role still resolves — onto the default.
  assert.equal(teammateRoute(resolveRoles({})[0]), undefined)
  assert.match(describeTeam(resolveRoles({})), /deployment default model/)
})

test('triage offers the team as a fourth gear', () => {
  const resolved = resolveRoles(TIERS)
  const menu = buildModeMenu(resolved)
  assert.deepEqual(menu.map((entry) => entry.mode), ['direct', 'standard', 'deep', 'team'])

  const text = renderTriagePrompt(resolved, { team: true })
  assert.match(text, /\*\*Team\*\*/)
  // The sequential gears quote a total; the team cannot, because its roster
  // comes from the split — so it quotes the rate and demands the arithmetic.
  assert.match(text, /Cost: 3 delegations, 3 model calls\./)
  assert.match(text, /Cost: one model call per teammate per assignment/)

  // And with a panel role in the mix, the sequential total counts every member
  // — the gear that costs more than its phase count must say so.
  const panelled = renderTriagePrompt(
    resolveRoles({ ...TIERS, roles: { reviewer: { models: [
      { provider: 'gw', model: 'big-model' }, { provider: 'rival', model: 'other' },
    ] } } }),
    { team: true },
  )
  assert.match(panelled, /Cost: 3 delegations, 4 model calls\./)
  assert.match(text, /Deep and Team are not a ranking/)
})

test('a deployment that cannot hire is never offered the team gear', () => {
  const resolved = resolveRoles(TIERS)
  assert.deepEqual(
    buildModeMenu(resolved, { team: false }).map((entry) => entry.mode),
    ['direct', 'standard', 'deep'],
  )

  const text = renderTriagePrompt(resolved, { team: false })
  assert.ok(!text.includes('**Team**'))
  assert.ok(!text.includes('Deep and Team are not a ranking'))
  // The gears that remain are unaffected.
  assert.match(text, /\*\*Standard\*\*/)
})

test('a teammate is started without this plugin\'s own tools', async () => {
  const { definition, subagents } = hiringTool()
  const filtered = teamToolDefinition({
    resolved: resolveRoles(TIERS),
    getSubagents: () => subagents,
    toolFilter: { deny: ['ccg_team', 'ccg_roster', 'ccg_build'] },
  })

  await filtered.execute(
    { role: 'builder', description: 'x', prompt: 'y' },
    { agent: { id: 'p' } },
  )
  // Suppressing the convention removed the invitation, not the capability: a
  // teammate that can still call the hiring tool can start a team nobody
  // approved, inside the depth cap.
  assert.deepEqual(subagents.calls[0].request.toolFilter, {
    deny: ['ccg_team', 'ccg_roster', 'ccg_build'],
  })

  // And a deployment whose provider cannot filter simply omits it, rather than
  // sending a field that would fail the start.
  await definition.execute({ role: 'builder', description: 'x', prompt: 'y' }, { agent: { id: 'p' } })
  assert.equal(subagents.calls[1].request.toolFilter, undefined)
})

test('the team gear quotes arithmetic, not just a headcount', () => {
  const text = renderTriagePrompt(resolveRoles(TIERS), { team: true })
  assert.match(text, /one model call per teammate per assignment/)
  assert.match(text, /is 6 calls/)
  // A user who approves "3 people" has approved a headcount, not a figure.
  assert.match(text, /Do the arithmetic out loud before hiring/)
})

test('the convention forbids reviewing work that does not exist yet', () => {
  // Observed live: with everything delegated, the coordinator spent a two-model
  // review panel on three files that were still stubs.
  const text = renderTeamPrompt(resolveRoles(TIERS))
  assert.match(text, /do not invent filler work/i)
  assert.match(text, /a file nobody\s*\n?has written yet/)
  assert.match(text, /Prepare the integration you will/)
})

test('the convention says when to interrupt, not just that it exists', () => {
  const text = renderTeamPrompt(resolveRoles(TIERS))
  assert.match(text, /`interrupt_agent` stops the turn it is in the middle of, and only that/)
  // The judgement, not just the mechanism: a teammate works from a brief you
  // wrote, so a misread costs the whole assignment if it runs to completion.
  assert.match(text, /building the wrong thing/)
  assert.match(text, /Interrupting is cheap; a wrong deliverable is not/)
})

test('hiring retires dead rows before it checks for a collision', async () => {
  // Otherwise an abandoned teammate blocks its files forever, with no way for
  // the coordinator to discover why a legitimate hire keeps being refused.
  const calls = []
  const subagents = {
    calls: [],
    listChildren: async (id) => { calls.push(id); return [] },
    async startContinuable(spec) { subagents.calls.push(spec); return { childId: 'new', messageId: 'm' } },
  }
  const table = {
    rows: new Map([['dead', {
      childId: 'dead', hiredBy: 'p', role: 'builder', label: 'x', owns: ['src/a.js'], hiredAt: 0,
    }]]),
    get(k) { return this.rows.get(k) },
    entries() { return this.rows.entries() },
    async put(k, v) { this.rows.set(k, v) },
    async delete(k) { return this.rows.delete(k) },
  }
  const definition = teamToolDefinition({
    resolved: resolveRoles(TIERS),
    getSubagents: () => subagents,
    getTable: () => table,
    now: () => 10 * 60 * 1000,
  })

  const result = await definition.execute(
    { role: 'builder', description: 'x', prompt: 'y', owns: ['src/a.js'] },
    { agent: { id: 'p' } },
  )
  assert.deepEqual(calls, ['p'])
  assert.equal(result.childId, 'new')
  assert.ok(!table.rows.has('dead'))
  assert.ok(table.rows.has('new'))
})

test('hiring asks first, and a decline starts nobody', async () => {
  const questions = stubQuestions(answering(HIRE_DECLINE))
  const { definition, subagents } = hiringTool(TIERS, stubSubagents(), {
    getUserQuestions: () => questions,
  })

  const result = await definition.execute(
    { role: 'builder', description: 'parser rewrite', prompt: 'Rewrite it.', owns: ['src/parse.js'] },
    { agent: { id: 'parent-1' } },
  )

  // Nothing was started. A gate that asked and then hired anyway is worse than
  // no gate: it teaches the user their answer does not matter.
  assert.equal(subagents.calls.length, 0)
  assert.equal(result.hired, false)
  assert.equal(result.childId, undefined)

  // The approval names what is actually being granted: the role, the model it
  // runs on, and the files nobody else may write while it holds them.
  const [request] = questions.asked
  const [question] = request.questions
  assert.equal(request.agent.id, 'parent-1')
  assert.match(question.detail, /gw \/ fast-model/)
  assert.match(question.detail, /src\/parse\.js/)
  assert.match(question.detail, /Rewrite it\./)
  // The verdict is named, never inferred from option order.
  assert.deepEqual(question.intent, { kind: 'plan-review', approve: HIRE_APPROVE })
  assert.equal(question.options[0].label, HIRE_APPROVE)
})

test('an approval hires exactly once, and asking is skippable by configuration', async () => {
  const questions = stubQuestions(answering(HIRE_APPROVE))
  const { definition, subagents } = hiringTool(TIERS, stubSubagents(), {
    getUserQuestions: () => questions,
  })

  const result = await definition.execute(
    { role: 'builder', description: 'parser rewrite', prompt: 'Rewrite it.' },
    { agent: { id: 'parent-1' } },
  )
  assert.equal(result.hired, true)
  assert.equal(subagents.calls.length, 1)
  assert.equal(questions.asked.length, 1)

  const silent = stubQuestions(answering(HIRE_DECLINE))
  const off = hiringTool(TIERS, stubSubagents(), {
    confirm: false,
    getUserQuestions: () => silent,
  })
  await off.definition.execute(
    { role: 'builder', description: 'x', prompt: 'y' },
    { agent: { id: 'parent-1' } },
  )
  assert.equal(silent.asked.length, 0)
  assert.equal(off.subagents.calls.length, 1)
})

test('the gate fails closed on an answer it cannot read', () => {
  assert.equal(readApproval(answering(HIRE_APPROVE)), true)
  assert.equal(readApproval(answering(HIRE_DECLINE)), false)

  // Anything unreadable is a decline. Hiring needs a yes, so an answer that
  // cannot be parsed must never become one.
  assert.equal(readApproval(undefined), false)
  assert.equal(readApproval({ answers: [] }), false)
  assert.equal(readApproval({ answers: [{ id: 'someone-else', selected: [HIRE_APPROVE] }] }), false)
  assert.equal(readApproval({ answers: [{ id: HIRE_QUESTION_ID }] }), false)
})

test('a deployment where nobody can answer hires rather than deadlocks', async () => {
  const question = hireApprovalQuestion({
    role: 'builder', label: 'x', route: 'gw / m', owns: [], brief: 'do it',
  })

  // No service at all (a deployment that mounts none).
  assert.deepEqual(await confirmHire(undefined, question, {}), { approved: true })

  // Registered, but with no UI provider behind it, or asked by a delegated
  // caller: both mean there is no human at the other end. A gate nobody can
  // answer is a deadlock, not a guard.
  for (const code of ['NO_PROVIDER', 'DELEGATED_CALLER', 'CALLER_NOT_LIVE']) {
    const failing = { ask: async () => { const error = new Error(code); error.code = code; throw error } }
    assert.deepEqual(await confirmHire(failing, question, {}), { approved: true })
  }
})

test('an unexpected failure hires but says so; a cancelled turn just ends', async () => {
  const question = hireApprovalQuestion({
    role: 'builder', label: 'x', route: 'gw / m', owns: [], brief: 'do it',
  })
  const broken = { ask: async () => { throw new Error('the panel exploded') } }

  // Never silently: a confirmation that did not happen is reported, so it
  // cannot be mistaken for one that was given.
  const outcome = await confirmHire(broken, question, {})
  assert.equal(outcome.approved, true)
  assert.match(outcome.note, /without a confirmation/)
  assert.match(outcome.note, /the panel exploded/)
  assert.match(formatHireReport({ hired: true, ...outcome, childId: 'c', role: 'r', label: 'l', route: 'gw / m' }), /without a confirmation/)

  // An aborted turn is not a verdict on the hire; it ends the call.
  await assert.rejects(
    () => confirmHire(broken, question, { signal: { aborted: true } }),
    /the panel exploded/,
  )
})

test('the convention tells the coordinator not to ask the same thing twice', () => {
  const text = renderTeamPrompt(resolveRoles(TIERS))
  assert.match(text, /Each hire asks the user to approve it/)
  assert.match(text, /do not also ask for permission in prose/)
  // A decline is an outcome to work with, not an obstacle to route around.
  assert.match(text, /never route around it/)
})
