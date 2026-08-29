/**
 * Unit tests for the presentation seam — how a panel result reaches the
 * browser.
 *
 * The rendered report is one blob of text. `output.presentationMeta` is the one
 * channel that carries the answers to the conversation view structurally, and
 * it is the only part of a call that survives into the session log alongside
 * the content. So what it projects, and which tools the browser is told to
 * claim, are both worth pinning: get either wrong and the side-by-side view
 * silently degrades to a generic card with no error anywhere.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CROSSCHECK_TOOL,
  PANEL_META_KIND,
  panelPresentationMeta,
  panelToolDefinition,
  resolvePanel,
} from '../src/crosscheck.js'
import { buildConfigPayload, buildPanelIndex } from '../src/api.js'

const TIERS = {
  strong: { provider: 'gw', model: 'big-model' },
  worker: { provider: 'gw', model: 'fast-model' },
}

/** A settled panel value as `execute` returns it. */
const VALUE = {
  question: 'Which storage engine?',
  answered: 1,
  answers: [
    { label: 'strong', provider: 'gw', model: 'big-model', ok: true, answer: 'Postgres, because…' },
    { label: 'worker', provider: 'gw', model: 'fast-model', ok: false, error: 'no output (error)' },
  ],
}

test('the payload carries the answers apart, which the report cannot', () => {
  const meta = panelPresentationMeta(VALUE, resolvePanel(TIERS))

  assert.equal(meta.kind, PANEL_META_KIND)
  assert.equal(meta.question, 'Which storage engine?')
  assert.equal(meta.answers.length, 2)

  assert.deepEqual(meta.answers[0], {
    label: 'strong',
    provider: 'gw',
    model: 'big-model',
    ok: true,
    answer: 'Postgres, because…',
  })
  // A member that did not answer carries why, and no empty answer beside it —
  // a blank column reads as "it said nothing", which is a different finding.
  assert.deepEqual(meta.answers[1], {
    label: 'worker',
    provider: 'gw',
    model: 'fast-model',
    ok: false,
    error: 'no output (error)',
  })
})

test('a lens rides along, but only for the member it was actually given to', () => {
  const members = resolvePanel({
    panel: [
      { provider: 'gw', model: 'big-model', lens: 'what breaks in production' },
      { provider: 'gw', model: 'fast-model' },
    ],
  })

  const meta = panelPresentationMeta(VALUE, members)
  assert.equal(meta.answers[0].lens, 'what breaks in production')
  assert.equal(meta.answers[1].lens, undefined)

  // Matched on route, not position: a roster that no longer lines up with the
  // answers must lose the lens rather than hang it on the wrong model.
  const shuffled = panelPresentationMeta(VALUE, [members[1], members[0]])
  assert.equal(shuffled.answers[0].lens, undefined)
  assert.equal(shuffled.answers[1].lens, undefined)
})

test('the projector is wired into the tool and survives a value it did not expect', () => {
  const members = resolvePanel(TIERS)
  const definition = panelToolDefinition({
    toolName: CROSSCHECK_TOOL,
    description: 'x',
    members,
  })

  assert.equal(typeof definition.output.presentationMeta, 'function')
  const meta = definition.output.presentationMeta({ prompt: 'q' }, VALUE)
  assert.equal(meta.answers.length, 2)

  // Replay hands back whatever was logged. A projector that throws would take
  // the conversation down with it, so it must be total.
  assert.doesNotThrow(() => panelPresentationMeta(undefined))
  assert.deepEqual(panelPresentationMeta({}).answers, [])
})

test('the browser is told to claim exactly the tools that answer as a panel', () => {
  const payload = buildConfigPayload({
    ...TIERS,
    roles: {
      analyzer: { models: [{ provider: 'gw', model: 'a' }, { provider: 'rival', model: 'b' }] },
      builder: { models: [{ provider: 'gw', model: 'a' }] },
    },
  }, undefined, true)

  const claimed = Object.keys(payload.panels).sort()
  // The analyzer holds two models; the builder holds one and stays a plain
  // delegation the official row already renders well.
  assert.deepEqual(claimed, ['ccg_analyze', CROSSCHECK_TOOL].sort())
  assert.deepEqual(payload.panels.ccg_analyze, [
    { provider: 'gw', model: 'a', label: 'gw / a' },
    { provider: 'rival', model: 'b', label: 'rival / b' },
  ])
})

test('a tool that is not mounted is never claimed', () => {
  // Two tiers alone make the cross-check a panel and no role one.
  assert.deepEqual(Object.keys(buildPanelIndex(TIERS, [])), [CROSSCHECK_TOOL])

  // Switched off, or with one voice, there is nothing to lay side by side.
  assert.deepEqual(buildPanelIndex({ ...TIERS, crosscheck: false }, []), {})
  assert.deepEqual(buildPanelIndex({ strong: TIERS.strong, worker: TIERS.strong }, []), {})

  // A disabled role does not mount a tool, so claiming its name would take over
  // a key nothing ever dispatches — or worse, one a later plugin owns.
  assert.deepEqual(
    buildPanelIndex({}, [{ tool: 'ccg_analyze', enabled: false, members: [{ provider: 'a', model: 'b' }, { provider: 'a', model: 'c' }] }]),
    {},
  )
})

test('the cross-check roster keeps the labels and lenses the role rows never carry', () => {
  const panels = buildPanelIndex({
    panel: [
      { provider: 'gw', model: 'big-model', label: 'optimist', lens: 'why this works' },
      { provider: 'gw', model: 'big-model', label: 'sceptic', lens: 'why this fails' },
    ],
  }, [])

  assert.deepEqual(panels[CROSSCHECK_TOOL], [
    { provider: 'gw', model: 'big-model', label: 'optimist', lens: 'why this works' },
    { provider: 'gw', model: 'big-model', label: 'sceptic', lens: 'why this fails' },
  ])
})
