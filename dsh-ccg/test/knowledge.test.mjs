/**
 * Unit tests for project memory — the decisions a transcript throws away.
 *
 * Filesystem access goes through an injected seam so these run without touching
 * a real workspace; what matters is the shape of what gets written and what
 * comes back into the prompt.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MEMORY_FILE,
  NOTE_KINDS,
  appendNote,
  formatNote,
  memoryPathOf,
  readMemory,
  rememberToolDefinition,
  renderMemoryPrompt,
  workspaceOf,
} from '../src/knowledge.js'

/** A filesystem seam recording what was written. */
function stubFs(initial) {
  const files = new Map(initial === undefined ? [] : [[initial.path, initial.text]])
  const made = []
  return {
    files,
    made,
    exists: (path) => files.has(path),
    mkdir: (path) => { made.push(path) },
    append: (path, text) => { files.set(path, (files.get(path) ?? '') + text) },
    read: (path) => {
      if (!files.has(path)) throw new Error('ENOENT')
      return files.get(path)
    },
  }
}

test('the workspace comes from the session header, and only when absolute', () => {
  assert.equal(workspaceOf({ session: { header: { cwd: '/w/project' } } }), '/w/project')
  // A relative or missing cwd is not a workspace — writing into one would put
  // the file wherever the process happens to be.
  assert.equal(workspaceOf({ session: { header: { cwd: 'project' } } }), undefined)
  assert.equal(workspaceOf({ session: { header: {} } }), undefined)
  assert.equal(workspaceOf(undefined), undefined)
  assert.equal(memoryPathOf('/w/project'), `/w/project/${MEMORY_FILE}`)
  assert.equal(memoryPathOf(undefined), undefined)
})

test('a note is stored as readable Markdown, dated and typed', () => {
  const text = formatNote({
    kind: 'contract',
    subject: 'Parser entry shape',
    body: '  parse(line) returns Entry | null and never throws.  ',
    at: Date.UTC(2026, 7, 28, 12),
  })
  assert.match(text, /^\n## Parser entry shape\n/)
  assert.match(text, /_contract · 2026-08-28_/)
  assert.match(text, /parse\(line\) returns Entry \| null and never throws\.$/m)
})

test('the first note creates the file with a header explaining itself', () => {
  const fs = stubFs()
  const path = appendNote('/w/p', { kind: 'decision', subject: 'S', body: 'B', at: 0 }, fs)

  assert.equal(path, `/w/p/${MEMORY_FILE}`)
  assert.deepEqual(fs.made, [`/w/p/.ccg`])
  const written = fs.files.get(path)
  assert.match(written, /# Project memory/)
  // A memory nobody may prune rots; say so where the reader is.
  assert.match(written, /Edit or delete freely/)
  assert.match(written, /## S/)

  // A second note appends rather than re-heading.
  appendNote('/w/p', { kind: 'gotcha', subject: 'T', body: 'U', at: 0 }, fs)
  const after = fs.files.get(path)
  assert.equal(after.match(/# Project memory/g).length, 1)
  assert.match(after, /## T/)
})

test('memory reads back, and an absent or empty one contributes nothing', () => {
  const path = `/w/p/${MEMORY_FILE}`
  assert.equal(readMemory('/w/p', 8192, stubFs()), '')
  assert.equal(readMemory('/w/p', 8192, stubFs({ path, text: '   \n ' })), '')
  assert.equal(readMemory(undefined, 8192, stubFs()), '')
  assert.equal(readMemory('/w/p', 8192, stubFs({ path, text: '# Project memory\n\n## A\n\nbody' })),
    '# Project memory\n\n## A\n\nbody')
})

test('over the cap the newest notes win, cut on a note boundary', () => {
  const path = `/w/p/${MEMORY_FILE}`
  const body = ['# Project memory', '']
  for (let i = 0; i < 60; i += 1) body.push(`## Note ${i}`, '', 'x'.repeat(120), '')
  const text = readMemory('/w/p', 900, stubFs({ path, text: body.join('\n') }))

  assert.ok(Buffer.byteLength(text, 'utf8') < 1200)
  // It must say it truncated — silence here reads as "you have the whole file".
  assert.match(text, /older notes omitted/)
  assert.match(text, new RegExp(MEMORY_FILE.replace('.', '\\.').replace('/', '\\/')))
  // A heading is never split from its body.
  assert.match(text, /## Note \d+/)
  assert.ok(!/^x+$/m.test(text.split('\n')[2] ?? ''))
  // The tail is what survived, not the head.
  assert.match(text, /## Note 59/)
  assert.ok(!text.includes('## Note 0\n'))
})

test('the prompt section tells the model these are decisions, not suggestions', () => {
  const path = `/w/p/${MEMORY_FILE}`
  const section = renderMemoryPrompt('/w/p', 8192, stubFs({ path, text: '## A\n\nUse SQLite.' }))
  assert.match(section, /Project memory/)
  assert.match(section, /Use SQLite\./)
  assert.match(section, /do not re-open one without saying/)
  // And that a wrong note must be corrected, not quietly worked around.
  assert.match(section, /stale note does more damage/)

  // Nothing recorded yet costs nothing.
  assert.equal(renderMemoryPrompt('/w/p', 8192, stubFs()), '')
})

test('the remember definition compiles — a bad schema takes the whole tool table down', () => {
  const definition = rememberToolDefinition({ deps: stubFs() })
  assert.equal(definition.name, 'ccg_remember')
  assert.deepEqual(definition.parameters.required, ['kind', 'subject', 'body'])
  assert.deepEqual(definition.parameters.properties.kind.enum, NOTE_KINDS)
  assert.deepEqual(definition.output.schema.required, ['path', 'kind', 'subject'])
  const [block] = definition.output.render({}, { path: '/w/p/x', kind: 'decision', subject: 'S' })
  assert.match(block.text, /Remembered \(decision\): S/)
})

test('remembering writes into the calling session\'s workspace', async () => {
  const fs = stubFs()
  const definition = rememberToolDefinition({ deps: fs, now: () => 0 })
  const result = await definition.execute(
    { kind: 'decision', subject: 'Storage', body: 'SQLite, because the data is relational.' },
    { agent: { session: { header: { cwd: '/w/p' } } } },
  )

  assert.equal(result.path, `/w/p/${MEMORY_FILE}`)
  assert.match(fs.files.get(result.path), /SQLite, because the data is relational\./)
})

test('an empty note or a workspaceless session is refused', async () => {
  const definition = rememberToolDefinition({ deps: stubFs() })
  await assert.rejects(
    () => definition.execute({ kind: 'decision', subject: 'S', body: 'B' }, { agent: {} }),
    /no workspace directory/,
  )
  await assert.rejects(
    () => definition.execute(
      { kind: 'decision', subject: '  ', body: 'B' },
      { agent: { session: { header: { cwd: '/w/p' } } } },
    ),
    /needs both a subject and a body/,
  )
})
