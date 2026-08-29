/**
 * Project memory — the decisions, worth keeping, that a transcript throws away.
 *
 * Team memory (`memory.js`) answers "who owns what, right now". This answers
 * the slower question: what did we settle, and why, that the next session would
 * otherwise re-litigate. On Claude Code CCG keeps that in `.context/`; the
 * equivalent here is one Markdown file in the workspace, because a decision is
 * something a human should be able to read, review and commit alongside the
 * code that embodies it. A KV row would be neither.
 *
 * Two halves, and both are needed — a memory nothing reads is a diary:
 *
 * - `ccg_remember` appends a note. It is deliberately narrow: a decision, a
 *   contract, a convention, a gotcha. Not a log of what happened; the session
 *   transcript already is that, and a memory that accumulates narration stops
 *   being worth loading.
 * - The file is then injected into the coordinator's prompt, capped, so the
 *   next turn — and the next session — starts already knowing. dsh's own
 *   `AGENTS.md` loader would do this, but it ships disabled in the default
 *   profiles, so relying on it would mean shipping a feature that silently
 *   does nothing.
 */

import { existsSync, mkdirSync, readFileSync, statSync, appendFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

import { defineTool } from '@deepseek-ai/dsh-tools'

/** Default name of the remember tool. */
export const REMEMBER_TOOL = 'ccg_remember'

/** Where the memory lives, relative to the workspace root. */
export const MEMORY_FILE = join('.ccg', 'memory.md')

/** What a note may be. Narrow on purpose — see the module note. */
export const NOTE_KINDS = ['decision', 'contract', 'convention', 'gotcha']

const KIND_HINT = {
  decision: 'a choice between real alternatives, with the reason it was chosen',
  contract: 'an interface two parts must both honour: a signature, a schema, a format',
  convention: 'how this project does something, where a newcomer would guess otherwise',
  gotcha: 'something that looks fine and is not — a trap the next person would fall into',
}

/** The workspace an agent is working in, when it can be read. */
export function workspaceOf(agent) {
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && isAbsolute(cwd) ? cwd : undefined
}

/** Absolute path of one workspace's memory file. */
export function memoryPathOf(workspace) {
  return workspace === undefined ? undefined : join(workspace, MEMORY_FILE)
}

/**
 * Render one note as it is stored.
 *
 * Markdown, one heading per note, so the file stays readable and diffable and a
 * human can delete a line that stopped being true.
 *
 * @param note - `{ kind, subject, body, at }`.
 * @returns the text appended to the file.
 */
export function formatNote(note) {
  const stamp = new Date(note.at).toISOString().slice(0, 10)
  return `\n## ${note.subject}\n\n_${note.kind} · ${stamp}_\n\n${note.body.trim()}\n`
}

/** The header a new memory file opens with. */
export function memoryHeader() {
  return [
    '# Project memory',
    '',
    'Decisions, contracts, conventions and traps worth carrying into the next session.',
    'Written by `ccg_remember`; read back automatically. Edit or delete freely — a line',
    'that stopped being true is worse than no line at all.',
    '',
  ].join('\n')
}

/**
 * Append one note to a workspace's memory.
 *
 * @param workspace - absolute workspace root.
 * @param note - `{ kind, subject, body, at }`.
 * @param deps - injection seam for tests.
 * @returns the absolute path written.
 */
export function appendNote(workspace, note, deps = {}) {
  const io = {
    exists: existsSync, mkdir: mkdirSync, append: appendFileSync, ...deps,
  }
  const path = memoryPathOf(workspace)
  if (path === undefined) throw new Error('ccg: no workspace to remember into')
  if (!io.exists(path)) {
    io.mkdir(dirname(path), { recursive: true })
    io.append(path, memoryHeader())
  }
  io.append(path, formatNote(note))
  return path
}

/**
 * Read a workspace's memory for injection, bounded.
 *
 * Over the cap it keeps the TAIL — the newest notes are the ones most likely to
 * still be true — and says plainly that it truncated, so the model knows to
 * open the file rather than assume it has read everything.
 *
 * @param workspace - absolute workspace root.
 * @param maxBytes - byte cap.
 * @param deps - injection seam for tests.
 * @returns the text to inject, or '' when there is nothing.
 */
export function readMemory(workspace, maxBytes = 8192, deps = {}) {
  const io = { exists: existsSync, read: readFileSync, stat: statSync, ...deps }
  const path = memoryPathOf(workspace)
  if (path === undefined || !io.exists(path)) return ''
  let text
  try {
    text = io.read(path, 'utf8')
  } catch {
    return ''
  }
  if (typeof text !== 'string' || text.trim() === '') return ''

  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text.trimEnd()
  // Cut on a note boundary so a heading is never split from its body.
  const tail = text.slice(-maxBytes)
  const start = tail.indexOf('\n## ')
  const kept = start === -1 ? tail : tail.slice(start + 1)
  return [
    `_(older notes omitted — the full memory is in ${MEMORY_FILE})_`,
    '',
    kept.trimEnd(),
  ].join('\n')
}

/**
 * The prompt section carrying a workspace's memory.
 *
 * @param workspace - absolute workspace root.
 * @param maxBytes - byte cap.
 * @param deps - injection seam for tests.
 * @returns the section text, or '' when the workspace has no memory yet.
 */
export function renderMemoryPrompt(workspace, maxBytes = 8192, deps = {}) {
  const body = readMemory(workspace, maxBytes, deps)
  if (body === '') return ''
  return [
    `Project memory — what earlier sessions settled, from ${MEMORY_FILE}.`,
    '',
    body,
    '',
    'Treat these as decisions already made: follow them, and do not re-open one without saying',
    'you are re-opening it. If you find one is wrong or out of date, say so and correct the file —',
    'a stale note does more damage than a missing one.',
  ].join('\n')
}

/**
 * Register the remember tool.
 *
 * @param ctx - a context carrying `tools`.
 * @param spec - `{ toolName?, deps? }`.
 * @returns the disposer removing the tool.
 */
export function registerRememberTool(ctx, spec = {}) {
  return ctx.tools.register(rememberToolDefinition(spec))
}

/**
 * Build the remember tool's definition.
 *
 * Separate from registration so a test can compile this exact definition.
 *
 * @param spec - `{ toolName?, deps? }`.
 * @returns the registry-ready definition.
 */
export function rememberToolDefinition(spec = {}) {
  const toolName = spec.toolName ?? REMEMBER_TOOL
  const deps = spec.deps ?? {}
  const now = spec.now ?? (() => Date.now())

  return defineTool({
    name: toolName,
    description:
      `Write one thing down where the next session will find it (${MEMORY_FILE}, loaded `
      + 'automatically). Use it the moment something is settled that would otherwise have to be '
      + 're-argued: a decision between real alternatives, a contract two parts must both honour, '
      + 'a convention someone would guess wrong, a trap that looks fine. Not for narrating what '
      + 'you did — the transcript is that already, and a memory full of narration stops being '
      + 'worth loading.',
    parameters: {
      kind: {
        type: 'string',
        required: true,
        enum: NOTE_KINDS,
        description: Object.entries(KIND_HINT).map(([k, v]) => `${k}: ${v}`).join('; '),
      },
      subject: {
        type: 'string',
        required: true,
        description: 'The heading, in a few words — what this note is about, not what it says.',
      },
      body: {
        type: 'string',
        required: true,
        description:
          'The note itself. Say what was decided AND why, including what was rejected: a decision '
          + 'without its reason cannot be safely revisited, only obeyed or ignored.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          subject: { type: 'string', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `Remembered (${value.kind}): ${value.subject} → ${value.path}\n`
          + 'Later sessions in this workspace start with it already loaded.',
      }],
    },
    async execute(args, exec) {
      const workspace = workspaceOf(exec?.agent)
      if (workspace === undefined) {
        throw new Error('ccg: this session has no workspace directory to remember into')
      }
      const subject = String(args.subject ?? '').trim()
      const body = String(args.body ?? '').trim()
      if (subject === '' || body === '') {
        throw new Error('ccg: a note needs both a subject and a body')
      }
      const path = appendNote(
        workspace,
        { kind: String(args.kind), subject, body, at: now() },
        deps,
      )
      return { path, kind: String(args.kind), subject }
    },
  })
}
