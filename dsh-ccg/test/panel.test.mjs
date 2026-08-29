/**
 * Unit tests for panels — a role, or the standalone cross-check, putting
 * several models on the same brief. What each member is told and how the
 * answers are laid out are pure functions, so they are tested without a
 * harness, a network call, or a token.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildMemberPrompt,
  describeCrosscheck,
  describeRolePanel,
  formatPanelReport,
  memberLabel,
  panelToolDefinition,
  resolvePanel,
} from '../src/crosscheck.js'
import { ROLES, resolveRoles } from '../src/roles.js'

const TIERS = {
  strong: { provider: 'gw', model: 'big-model' },
  worker: { provider: 'gw', model: 'fast-model' },
}

test('a role holding several models becomes a panel; one model stays a delegation', () => {
  const resolved = resolveRoles({
    ...TIERS,
    roles: {
      analyzer: {
        models: [
          { provider: 'gw', model: 'big-model' },
          { provider: 'rival', model: 'other-model' },
        ],
      },
    },
  })
  const byRole = Object.fromEntries(resolved.map((entry) => [entry.role, entry]))

  assert.equal(byRole.analyzer.members.length, 2)
  // A panel has no single route, so nothing is handed to the official tool.
  assert.equal(byRole.analyzer.agentOptions, undefined)

  assert.equal(byRole.reviewer.members.length, 1)
  assert.deepEqual(byRole.reviewer.agentOptions, { provider: 'gw', model: 'big-model' })
})

test('a role list drops duplicates and half-routes rather than mounting them', () => {
  const [analyzer] = resolveRoles({
    roles: {
      analyzer: {
        models: [
          { provider: 'gw', model: 'a' },
          { provider: 'gw', model: 'a' },
          { provider: 'gw' },
          { model: 'orphan' },
        ],
      },
    },
  }).filter((entry) => entry.role === 'analyzer')

  assert.deepEqual(analyzer.members, [{ provider: 'gw', model: 'a' }])
})

test('the standalone panel falls back to the two tiers and collapses clones', () => {
  assert.deepEqual(resolvePanel(TIERS).map((member) => member.model), ['big-model', 'fast-model'])

  // Both tiers on one model is a single voice, not a panel.
  assert.equal(resolvePanel({ strong: TIERS.strong, worker: TIERS.strong }).length, 1)

  // Nothing configured at all leaves no panel to register.
  assert.equal(resolvePanel({}).length, 0)
})

test('an explicit panel wins, and may put one model behind two different lenses', () => {
  const panel = resolvePanel({
    ...TIERS,
    panel: [
      { provider: 'gw', model: 'big-model', lens: 'correctness' },
      { provider: 'gw', model: 'big-model', lens: 'cost' },
      { provider: 'gw', model: 'big-model', lens: 'cost' },
    ],
  })
  assert.equal(panel.length, 2)
  assert.deepEqual(panel.map((member) => member.lens), ['correctness', 'cost'])
})

test('a malformed or mislabelled panel member is refused, never quietly dropped', () => {
  assert.throws(() => resolvePanel({ panel: [{ provider: 'gw' }] }), /needs both a provider and a model/)
  assert.throws(
    () => resolvePanel({ panel: [{ provider: 'gw', model: 'a', role: 'archtiect' }] }),
    /unknown role "archtiect"/,
  )
})

test('every member is told to answer independently, wearing the panel persona', () => {
  const member = { provider: 'gw', model: 'big-model' }
  const prompt = buildMemberPrompt(member, 'Should we shard this table?', 'schema.sql', ROLES.architect.persona)

  assert.match(prompt, /CCG's full-stack architect/)
  assert.match(prompt, /cannot see the others/)
  assert.match(prompt, /Do not hedge toward a middle position/)
  assert.match(prompt, /Shared context:\nschema\.sql/)
  assert.match(prompt, /Task:\nShould we shard this table\?/)
})

test("a member's own role and lens override the panel persona", () => {
  const prompt = buildMemberPrompt(
    { provider: 'gw', model: 'm', role: 'reviewer', lens: 'security only' },
    'Review this diff.',
    '',
    ROLES.analyzer.persona,
  )
  assert.match(prompt, /CCG's code reviewer/)
  assert.ok(!prompt.includes("CCG's senior systems analyst"))
  assert.match(prompt, /Answer through this lens specifically: security only/)
})

test('the report prints every answer and tells the reader what to do with them', () => {
  const report = formatPanelReport('Ship it?', [
    { label: 'strong', provider: 'gw', model: 'big', ok: true, answer: 'Yes, with a migration.' },
    { label: 'worker', provider: 'gw', model: 'fast', ok: true, answer: 'No, the index is missing.' },
  ])

  assert.match(report, /Panel of 2 on: Ship it\?/)
  assert.match(report, /Yes, with a migration\./)
  assert.match(report, /No, the index is missing\./)
  assert.match(report, /Where they disagree is the finding/)
  assert.match(report, /rather than averaging them/)
})

test('a failed member thins the panel instead of hiding it', () => {
  const report = formatPanelReport('Why is it slow?', [
    { label: 'a', provider: 'gw', model: 'big', ok: true, answer: 'N+1 query.' },
    { label: 'b', provider: 'gw', model: 'fast', ok: false, error: 'timeout' },
  ])
  assert.match(report, /\[no answer: timeout\]/)
  assert.match(report, /Too few answers came back/)
})

test('every panel definition compiles — a bad schema takes the whole tool table down', () => {
  // `defineTool` validates both schemas as it builds, and a plugin whose tool
  // definition throws never finishes mounting: its own tools go missing AND
  // the registration it was part of fails. That is a whole-session outage, not
  // one broken tool, so the real definitions are compiled here.
  const [analyzer] = resolveRoles({
    roles: {
      analyzer: {
        models: [{ provider: 'gw', model: 'big' }, { provider: 'rival', model: 'other' }],
      },
    },
  }).filter((entry) => entry.role === 'analyzer')

  const rolePanel = panelToolDefinition({
    toolName: analyzer.toolName,
    description: describeRolePanel(analyzer),
    members: analyzer.members,
    persona: analyzer.persona,
  })
  assert.equal(rolePanel.name, 'ccg_analyze')
  assert.equal(rolePanel.parameters.type, 'object')
  // Same argument names as the official delegation tool: a role holding one
  // model and a role holding five must be callable identically.
  assert.deepEqual(rolePanel.parameters.required, ['description', 'prompt'])
  assert.equal(rolePanel.output.schema.type, 'object')
  // The compiler rewrites the DSL's per-field `required` into a list; seeing it
  // here proves the schema went through the compiler rather than past it.
  assert.deepEqual(rolePanel.output.schema.required, ['question', 'answered', 'answers'])
  assert.equal(rolePanel.output.schema.additionalProperties, false)

  const crosscheck = panelToolDefinition({
    toolName: 'ccg_crosscheck',
    description: describeCrosscheck(resolvePanel(TIERS)),
    members: resolvePanel(TIERS),
  })
  assert.equal(crosscheck.name, 'ccg_crosscheck')

  // The render path runs on every result; a throw there is also a broken tool.
  const text = crosscheck.output.render(
    { description: 'q', prompt: 'q' },
    { question: 'q', answered: 1, answers: [{ label: 'a', provider: 'gw', model: 'm', ok: true, answer: 'yes' }] },
  )
  assert.match(text[0].text, /Panel of 1 on: q/)
})

test('tool descriptions name every member so the model knows who it is asking', () => {
  const [analyzer] = resolveRoles({
    roles: {
      analyzer: {
        models: [{ provider: 'gw', model: 'big' }, { provider: 'rival', model: 'other' }],
      },
    },
  }).filter((entry) => entry.role === 'analyzer')

  const roleDescription = describeRolePanel(analyzer)
  assert.match(roleDescription, /gw \/ big/)
  assert.match(roleDescription, /rival \/ other/)
  assert.match(roleDescription, /2 models at once/)

  const crossDescription = describeCrosscheck(resolvePanel(TIERS))
  assert.match(crossDescription, /Ask 2 models the same question/)
  assert.equal(memberLabel({ provider: 'gw', model: 'big' }), 'gw / big')
})

test('inheriting the conversation is opt-in, and refused where it would fake a panel', () => {
  const [builder] = resolveRoles({ roles: { builder: { context: 'inherit' } } })
    .filter((entry) => entry.role === 'builder')
  assert.equal(builder.context, 'inherit')

  // Every role starts self-contained unless it asks not to.
  const [reviewer] = resolveRoles({}).filter((entry) => entry.role === 'reviewer')
  assert.equal(reviewer.context, 'brief')

  // A panel whose members have read your reasoning is not a second opinion.
  assert.throws(
    () => resolveRoles({
      roles: {
        analyzer: {
          context: 'inherit',
          models: [{ provider: 'a', model: 'b' }, { provider: 'a', model: 'c' }],
        },
      },
    }),
    /answer independently/,
  )
})
