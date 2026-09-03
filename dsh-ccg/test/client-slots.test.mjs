/**
 * Regression tests for the browser half's slot registrations.
 *
 * These read `src/client.js` as text rather than loading it, because it is a
 * `window.__ModuleLoader__.load()` module with no export a test can reach. Text
 * is a weak instrument, and it is used here for the one thing worth the
 * weakness: a registration that omits the option its slot's kind requires
 * THROWS, and that throw fails the entire loader entry — the settings card, the
 * panel view and the team strip disappear together behind one banner. Nothing
 * else in the repo connects a slot's kind to what this file passes.
 *
 * That is not hypothetical: the plugin tab redeclared `settings.plugin.item`
 * from `list` to `keyed` between harness releases (issue #162), and a card
 * carrying only `id` stopped loading.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'

import { SETTINGS_NAMESPACE } from '../src/index.js'

const source = readFileSync(new URL('../src/client.js', import.meta.url), 'utf8')

/**
 * The option object of every `ctx.slots.register({...}, Component)` call,
 * keyed by the slot it registers into.
 *
 * @returns slot name → its options, as raw source text per option.
 */
function registrations() {
  const found = new Map()
  const calls = source.matchAll(/ctx\.slots\.register\(\{\n([\s\S]*?)\n\s*\}, /g)
  for (const call of calls) {
    const options = {}
    for (const line of call[1].split('\n')) {
      const option = line.match(/^\s+([A-Za-z]+): (.+?),\s*$/)
      if (option !== null) options[option[1]] = option[2]
    }
    assert.ok(options.name !== undefined, `a registration passed no slot name: ${call[1]}`)
    found.set(options.name.slice(1, -1), options)
  }
  return found
}

test('the plugin card satisfies a keyed slot and an ordered one at the same time', () => {
  const card = registrations().get('settings.plugin.item')
  assert.ok(card !== undefined, 'the settings card is no longer registered')

  // `keyed` requires `key`, `list` requires `id`, and each ignores the other's.
  // Dropping either option makes the card — and with it the whole browser half
  // — fail to load on one of the two harness lines.
  assert.equal(card.key, 'SETTINGS_NS')
  assert.equal(card.id, "'ccg'")
})

test('the card is keyed by the settings namespace the host half registers', () => {
  // The tab pairs a served namespace with the card claiming it. A key that is
  // not a namespace this plugin registers is never dispatched, so the card
  // would go silently missing rather than loudly failing.
  const declared = source.match(/const SETTINGS_NS = '([^']+)'/)
  assert.ok(declared !== null, 'SETTINGS_NS is no longer declared in the browser half')
  assert.equal(declared[1], SETTINGS_NAMESPACE)
})

/**
 * A slot registry with `settings.plugin.item` declared the way one harness
 * generation declares it. Slots are declared through a parent entry's children
 * table, so the tab's declaration is reproduced here rather than imagined.
 *
 * @param kind - `'list'` (older tabs) or `'keyed'` (current ones).
 * @returns the registry, with the slot declared and nothing registered into it.
 */
function tabDeclaring(kind) {
  const slots = new SlotCore()
  slots.register(
    { name: 'root', children: { 'settings.plugin.item': { kind, scope: 'root' } } },
    () => null,
  )
  return slots
}

test('the card registers against either declaration of the tab it lives in', () => {
  // The real registry, so the rule being relied on is the one that ships:
  // each kind reads the option it requires and ignores the other's.
  const options = { name: 'settings.plugin.item', key: SETTINGS_NAMESPACE, id: 'ccg', order: 50 }

  for (const kind of ['keyed', 'list']) {
    assert.doesNotThrow(
      () => tabDeclaring(kind).register({ ...options }, () => null),
      `the card fails to register into a ${kind} slot`,
    )
  }

  // And the halves of that pair are each load-bearing, one per generation.
  assert.throws(
    () => tabDeclaring('keyed').register({ name: options.name, id: options.id }, () => null),
    /requires options\.key/,
  )
  assert.throws(
    () => tabDeclaring('list').register({ name: options.name, key: options.key }, () => null),
    /requires options\.id/,
  )
})

test('the panel view is keyed by tool name and the team strip is an ordered entry', () => {
  const slots = registrations()

  const panel = slots.get('tool.call.toolview')
  assert.ok(panel !== undefined, 'the panel view is no longer registered')
  assert.equal(panel.key, 'tool')

  const dock = slots.get('conversation.input.dock')
  assert.ok(dock !== undefined, 'the team strip is no longer registered')
  assert.equal(dock.id, "'ccg-team'")
})
