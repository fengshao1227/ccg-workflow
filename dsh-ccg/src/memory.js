/**
 * Team memory — who was hired, and which files are theirs.
 *
 * A team's ownership map lived nowhere but the conversation, and that is where
 * it went wrong in practice: the coordinator hired three builders, and by the
 * time integration found a fault it patched their files itself rather than
 * sending the work back. Nothing was durable, nothing was checked, and after a
 * compaction the map would have been gone entirely.
 *
 * So ownership moves out of the transcript and into `ctx.storageDomain` — the
 * harness's own durable KV, the same one the workspace registry uses. It costs
 * no tokens until the model asks for it, it survives compaction, restart and
 * resume, and it makes the plugin's central claim — one writer per file —
 * mechanical instead of a paragraph of prose that a model may or may not honour.
 *
 * Live status is NOT stored here. `ctx.subagents.listChildren()` already knows
 * whether a child is running, idle or resumable, and a second copy of that
 * would only be a stale one. This holds what the harness does not: the role,
 * the route, and the paths.
 */

import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Default name of the roster tool. */
export const ROSTER_TOOL = 'ccg_roster'

/**
 * The durable team record.
 *
 * Keyed by the child's durable session id, which is what `send_message` and
 * `interrupt_agent` take — so a row is directly actionable, not just
 * informative.
 */
export const TEAM_DOMAIN = defineDomain({
  // `UNIT_NAME_RE` is /^[a-z][a-z0-9_]*$/ — a hyphen is rejected at module load.
  name: 'ccg_team',
  version: 1,
  tables: {
    teammates: domainTable(z.object({
      /** Durable session id of the hired child. */
      childId: z.string(),
      /** Session id of the agent that hired it; the roster is per coordinator. */
      hiredBy: z.string(),
      /** Workspace the hire happened in, so one machine can hold several teams. */
      workspace: z.string().optional(),
      role: z.string(),
      label: z.string(),
      provider: z.string().optional(),
      model: z.string().optional(),
      /** Paths this teammate alone may write. Empty means it was given none. */
      owns: z.array(z.string()),
      hiredAt: z.number(),
    })),
  },
})

/**
 * Open the team memory.
 *
 * @param ctx - a context carrying `storageDomain`.
 * @returns the opened domain handle; the caller closes it.
 */
export function openTeamMemory(ctx) {
  return ctx.storageDomain.open(TEAM_DOMAIN)
}

/**
 * Normalise one declared path so two spellings of the same file collide.
 *
 * @param path - a path or glob as the model wrote it.
 * @returns the comparable form, or '' when it says nothing.
 */
export function normalisePath(path) {
  if (typeof path !== 'string') return ''
  let value = path.trim().replace(/\\/g, '/')
  while (value.startsWith('./')) value = value.slice(2)
  value = value.replace(/\/{2,}/g, '/')
  while (value.length > 1 && value.endsWith('/')) value = value.slice(0, -1)
  return value === '.' ? '' : value
}

/**
 * The directory a pattern can reach into.
 *
 * A glob owns everything under the literal part before its first wildcard, so
 * `src/*.js` reaches `src` and collides with `src/a.js`. A plain path reaches
 * only itself — and, if it is a directory, everything beneath it, which the
 * containment test below handles.
 *
 * @param path - a normalised path.
 * @returns the literal directory prefix, or '' when the pattern is rooted at
 * the workspace and therefore reaches everything.
 */
export function reachOf(path) {
  const wildcard = path.search(/[*?[{]/)
  if (wildcard === -1) return path
  const separator = path.lastIndexOf('/', wildcard)
  return separator === -1 ? '' : path.slice(0, separator)
}

/** Whether `child` is `dir` itself or sits beneath it. */
function within(child, dir) {
  if (dir === '') return true
  return child === dir || child.startsWith(`${dir}/`)
}

/**
 * Whether two ownership claims can touch the same file.
 *
 * Deliberately generous: a claim that *might* overlap is treated as one. The
 * cost of a false positive is the coordinator rewording an assignment; the cost
 * of a false negative is two agents silently overwriting each other.
 *
 * @param a - one declared path or glob.
 * @param b - the other.
 * @returns whether they may collide.
 */
export function pathsCollide(a, b) {
  const left = normalisePath(a)
  const right = normalisePath(b)
  if (left === '' || right === '') return false
  if (left === right) return true
  return within(left, reachOf(right)) || within(right, reachOf(left))
}

/**
 * Drop blanks and duplicates from a declared ownership set.
 *
 * @param owns - the submitted paths.
 * @returns the normalised, deduplicated set.
 */
export function normaliseOwns(owns) {
  if (!Array.isArray(owns)) return []
  const seen = new Set()
  const paths = []
  for (const entry of owns) {
    const path = normalisePath(entry)
    if (path === '' || seen.has(path)) continue
    seen.add(path)
    paths.push(path)
  }
  return paths
}

/**
 * Find which existing teammates already hold any of these paths.
 *
 * @param rows - the coordinator's current roster.
 * @param owns - the paths about to be handed out.
 * @returns one entry per colliding row, naming the exact pair of paths.
 */
export function collisionsWith(rows, owns) {
  const claims = normaliseOwns(owns)
  const found = []
  for (const row of rows) {
    const clashes = []
    for (const held of row.owns ?? []) {
      for (const claim of claims) {
        if (pathsCollide(held, claim)) clashes.push({ held, claim })
      }
    }
    if (clashes.length > 0) found.push({ row, clashes })
  }
  return found
}

/**
 * The refusal a colliding hire produces.
 *
 * It names the holder and the exact overlapping pair, because "that is taken"
 * without saying by whom leaves the model guessing at a fix.
 *
 * @param collisions - output of {@link collisionsWith}.
 * @returns the error message.
 */
export function describeCollisions(collisions) {
  const lines = collisions.flatMap(({ row, clashes }) => [
    `  ${row.role} (${row.childId}) already owns ${row.owns.join(', ')}`,
    // Named separately from the holding set: "already owns A overlaps B" reads
    // as though the holder owned B, which is the opposite of what happened.
    ...clashes.map(({ held, claim }) => (held === claim
      ? `    — you asked for ${claim}, which is exactly theirs`
      : `    — you asked for ${claim}, which overlaps their ${held}`)),
  ])
  return [
    'ccg: those files already belong to a teammate, and two writers on one file lose each',
    "other's work with no error:",
    ...lines,
    '',
    'Either give this teammate different files, or send the work to the owner with',
    `send_message. To take the files back first, call ${ROSTER_TOOL} with action "release".`,
  ].join('\n')
}

/**
 * Read one coordinator's roster, newest last.
 *
 * @param table - the `teammates` table handle.
 * @param hiredBy - session id of the coordinator.
 * @returns its rows.
 */
export function rosterOf(table, hiredBy) {
  if (table === undefined) return []
  const rows = []
  for (const [, row] of table.entries()) {
    if (row?.hiredBy === hiredBy) rows.push(row)
  }
  return rows.sort((a, b) => (a.hiredAt ?? 0) - (b.hiredAt ?? 0))
}

/**
 * How long a row is immune from pruning after it is written.
 *
 * `listChildren` omits "a running candidate without [a served identity] — its
 * descriptor may not be appended yet (the creation window)". A teammate hired
 * seconds ago can therefore be legitimately absent from the list. Pruning it
 * would unclaim its files and let the next hire land on top of it, which is the
 * exact silent overwrite this whole map exists to prevent.
 *
 * So absence alone is never enough: a row must also be older than any creation
 * window could plausibly be. Generous on purpose — a stale row costing five
 * extra minutes of shelf life is nothing, and the opposite error corrupts work.
 */
export const PRUNE_GRACE_MS = 5 * 60 * 1000

/**
 * Drop rows whose child the subagent service no longer knows about.
 *
 * Rows are otherwise immortal: `release` removes one deliberately, but a
 * teammate simply abandoned — or one whose coordinator session was deleted —
 * would sit in the domain forever, blocking its files and growing the file.
 *
 * The service's enumeration is the authority; this guesses nothing. A parent
 * whose listing FAILS keeps every row, because "the store did not answer" and
 * "the child is gone" are not the same fact, and only one of them is safe to
 * act on.
 *
 * @param table - the `teammates` table handle.
 * @param parentIds - coordinator sessions to sweep.
 * @param listChildren - `(parentId) => Promise<entries>`; may reject.
 * @param now - current epoch ms.
 * @param graceMs - creation-window immunity, {@link PRUNE_GRACE_MS} by default.
 * @returns the child ids removed.
 */
export async function sweepStale(table, parentIds, listChildren, now, graceMs = PRUNE_GRACE_MS) {
  if (table === undefined || typeof listChildren !== 'function') return []
  const removed = []
  for (const parentId of new Set(parentIds.filter(Boolean))) {
    const rows = rosterOf(table, parentId)
    if (rows.length === 0) continue

    let known
    try {
      const entries = await listChildren(parentId)
      if (!Array.isArray(entries)) continue
      known = new Set(entries.map((entry) => String(entry?.id ?? '')).filter(Boolean))
    } catch {
      // The store did not answer. Keep everything.
      continue
    }

    for (const row of rows) {
      if (known.has(row.childId)) continue
      if (now - (row.hiredAt ?? 0) < graceMs) continue
      try {
        if (await table.delete(row.childId)) removed.push(row.childId)
      } catch {
        // A failed delete leaves a stale row, which is the harmless direction.
      }
    }
  }
  return removed
}

/**
 * Claims held in this workspace by a DIFFERENT conversation.
 *
 * A roster is scoped to its coordinator, which is right — `send_message`
 * authority is per-lineage, so one session genuinely cannot direct another's
 * teammates. But scoping it away entirely means a new session on the same
 * project cannot see that a file is spoken for, which is exactly the silent
 * overwrite this whole feature exists to prevent. So they are surfaced as a
 * warning and never as a refusal: the other session may be long gone, and a
 * hire this one cannot possibly unblock would be a deadlock, not a guard.
 *
 * @param table - the `teammates` table handle.
 * @param workspace - the current workspace, when known.
 * @param hiredBy - session id of the coordinator asking.
 * @returns rows claimed elsewhere in the same workspace.
 */
export function foreignClaimsIn(table, workspace, hiredBy) {
  if (table === undefined || workspace === undefined) return []
  const rows = []
  for (const [, row] of table.entries()) {
    if (row?.hiredBy === hiredBy) continue
    if (row?.workspace !== workspace) continue
    if ((row.owns ?? []).length === 0) continue
    rows.push(row)
  }
  return rows.sort((a, b) => (a.hiredAt ?? 0) - (b.hiredAt ?? 0))
}

/** The warning appended when another conversation holds files here. */
function formatForeign(foreign) {
  if (foreign.length === 0) return []
  return [
    '',
    'Claimed by another conversation in this workspace — you cannot message these teammates,',
    'but someone assigned them these files, so check before you rewrite one:',
    ...foreign.map((row) => `  ${row.role} (${row.childId}) — ${row.owns.join(', ')}`),
  ]
}

/**
 * Lay the roster out for the model, merging durable ownership with live status.
 *
 * @param rows - the coordinator's rows.
 * @param status - childId → live activity from `listChildren`, when readable.
 * @param foreign - claims held here by another conversation.
 * @param pruned - how many rows this read retired.
 * @returns the model-facing text.
 */
export function formatRoster(rows, status = {}, foreign = [], pruned = 0) {
  const swept = pruned > 0
    ? [`(${pruned} teammate${pruned === 1 ? '' : 's'} the harness no longer holds `
      + 'were dropped from this list; their files are free again.)', '']
    : []
  if (rows.length === 0) {
    return [
      ...swept,
      'No teammates. Nobody has been hired in this conversation, so every file is yours.',
      ...formatForeign(foreign),
    ].join('\n')
  }
  const lines = [
    ...swept,
    `Your team — ${rows.length} teammate${rows.length === 1 ? '' : 's'}:`,
    '',
  ]
  for (const row of rows) {
    const route = row.provider && row.model ? `${row.provider} / ${row.model}` : 'deployment default'
    const live = status[row.childId]
    lines.push(`${row.role} · ${row.label}`)
    lines.push(`  id ${row.childId}${live ? ` · ${live}` : ''} · ${route}`)
    lines.push(`  owns ${row.owns.length > 0 ? row.owns.join(', ') : '(nothing exclusively)'}`)
    lines.push('')
  }
  lines.push(
    'These files are theirs while they are listed here. To change one, `send_message` its owner;',
    `to take it back yourself, release it with ${ROSTER_TOOL} first and say so.`,
    ...formatForeign(foreign),
  )
  return lines.join('\n')
}

/**
 * Register the roster tool.
 *
 * @param ctx - a context carrying `tools`.
 * @param spec - `{ toolName?, getTable, getSubagents? }`.
 * @returns the disposer removing the tool.
 */
export function registerRosterTool(ctx, spec) {
  return ctx.tools.register(rosterToolDefinition({
    ...spec,
    getSubagents: spec.getSubagents ?? (() => ctx.get('subagents')),
  }))
}

/**
 * Build the roster tool's definition.
 *
 * Separate from registration so a test can compile this exact definition — a
 * definition that throws takes the whole tool table down.
 *
 * @param spec - `{ toolName?, getTable, getSubagents }`.
 * @returns the registry-ready definition.
 */
export function rosterToolDefinition(spec) {
  const toolName = spec.toolName ?? ROSTER_TOOL
  const getTable = spec.getTable ?? (() => undefined)
  const getSubagents = spec.getSubagents ?? (() => undefined)
  const now = spec.now ?? (() => Date.now())

  return defineTool({
    name: toolName,
    description:
      'Who is on your team and which files are theirs. This outlives the conversation: after a '
      + 'compaction, or in a later session, it is the only thing that still knows who owns what. '
      + 'Read it before touching a file you did not write, and before hiring someone whose files '
      + 'may overlap. `release` hands a teammate\'s files back to you.',
    parameters: {
      action: {
        type: 'string',
        enum: ['list', 'release'],
        description: 'Default `list`. Use `release` to take one teammate\'s files back — do that '
          + 'only when you have said you are taking over and will send them nothing further.',
      },
      subagent_id: {
        type: 'string',
        description: 'The teammate to release. Required for `release`, ignored for `list`.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          count: { type: 'number', required: true },
          released: { type: 'string' },
          pruned: { type: 'number' },
          text: { type: 'string', required: true },
        },
      },
      render: (args, value) => [{ type: 'text', text: value.text }],
    },
    async execute(args, exec) {
      const table = getTable()
      if (table === undefined) {
        throw new Error(
          'ccg: team memory is unavailable in this deployment (no storageDomain), so ownership '
          + 'is not recorded; track it in the conversation instead',
        )
      }
      const agent = exec?.agent
      if (agent === undefined) throw new Error(`ccg: ${toolName} needs an agent session`)
      const hiredBy = String(agent.id)

      if (args.action === 'release') {
        const childId = String(args.subagent_id ?? '').trim()
        if (childId === '') throw new Error('ccg: release needs the teammate\'s subagent_id')
        const row = table.get(childId)
        if (row === undefined || row.hiredBy !== hiredBy) {
          throw new Error(`ccg: no teammate "${childId}" on your roster`)
        }
        await table.delete(childId)
        const rows = rosterOf(table, hiredBy)
        const workspace = agent.session?.header?.cwd
        return {
          action: 'release',
          count: rows.length,
          released: childId,
          text: [
            `Released ${row.role} (${childId}). Its files are yours again: `
            + `${row.owns.length > 0 ? row.owns.join(', ') : '(it held none)'}.`,
            'It is still alive and still holds its own context — releasing only ends its claim on',
            'those files. Send it nothing further about them unless you hand them back.',
            '',
            formatRoster(rows, {}, foreignClaimsIn(table, workspace, hiredBy)),
          ].join('\n'),
        }
      }

      const subagents = getSubagents()
      const listChildren = subagents?.listChildren === undefined
        ? undefined
        : (parentId) => subagents.listChildren(parentId, exec?.signal)

      // Reading the roster is also when it gets tidied: sweep this
      // coordinator's rows and the ones warned about in this workspace, so an
      // abandoned teammate stops holding files it can never write again.
      const workspace = agent.session?.header?.cwd
      const swept = await sweepStale(
        table,
        [hiredBy, ...foreignClaimsIn(table, workspace, hiredBy).map((row) => row.hiredBy)],
        listChildren,
        now(),
      )

      const rows = rosterOf(table, hiredBy)
      // Live activity is the service's to know; a stored copy would only go
      // stale. The entry field is `activity` (`running` | `inactive`) — reading
      // a `status` that does not exist silently produced no status at all.
      const status = {}
      if (listChildren !== undefined && rows.length > 0) {
        try {
          for (const entry of await listChildren(agent.id)) {
            const id = String(entry?.id ?? '')
            if (id !== '' && entry?.activity) status[id] = String(entry.activity)
          }
        } catch {
          // A roster without live status is still the ownership map, which is
          // the part nothing else holds.
        }
      }
      const foreign = foreignClaimsIn(table, workspace, hiredBy)
      return {
        action: 'list',
        count: rows.length,
        ...(swept.length > 0 ? { pruned: swept.length } : {}),
        text: formatRoster(rows, status, foreign, swept.length),
      }
    },
  })
}
