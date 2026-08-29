/**
 * The card's data seam.
 *
 * The harness serves settings namespaces to the browser from a fixed allowlist
 * — `dsh-host-apiproxy` builds it from its own constants plus the configurable
 * model providers, so a third-party namespace is deliberately neither readable
 * nor writable over the wire ("a future registration does not become remotely
 * readable or writable by default"). A plugin that wants its own card must
 * therefore serve its own section, which is what this route does: the Host
 * still owns every write, through the same settings scope the profile patch
 * layers under.
 *
 * Writes are refused off-loopback. The harness gates its own configuration
 * methods the same way, because changing model routing from a LAN client is
 * not something a browser-trust fence alone should decide.
 */

import { CROSSCHECK_TOOL, resolvePanel } from './crosscheck.js'
import { rosterOf } from './memory.js'
import { ROLES, ROLE_NAMES, TIERS, resolveRoles } from './roles.js'

/** Route the card reads and writes. */
export const API_PATH = '/api/ccg/config'

/** Route the team strip reads. */
export const TEAM_API_PATH = '/api/ccg/team'

/**
 * Whether a request came from this machine.
 *
 * @param req - the incoming request.
 * @returns whether the peer address is loopback.
 */
export function isLoopback(req) {
  const address = req?.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * Read one tier out of a settings layer, tolerating anything a hand-edited
 * document may hold there.
 *
 * @param layer - resolved value or raw user layer.
 * @param tier - `strong` or `worker`.
 * @returns that tier's provider and model, blank when unset.
 */
function readTier(layer, tier) {
  const section = layer && typeof layer === 'object' ? layer[tier] : undefined
  if (!section || typeof section !== 'object') return { provider: '', model: '' }
  return {
    provider: typeof section.provider === 'string' ? section.provider : '',
    model: typeof section.model === 'string' ? section.model : '',
  }
}

/**
 * Build what the card renders: both tiers, which of them the user layer
 * carries, every role with the model actually serving it and where that model
 * came from, and the model catalog its selectors offer.
 *
 * @param value - the resolved section.
 * @param user - the raw user layer, when one exists.
 * @param writable - whether the settings document accepts writes.
 * @param models - the harness model catalog, as `{provider, id, name}` entries.
 * @returns the card payload.
 */
export function buildConfigPayload(value, user, writable, models = []) {
  const tiers = {}
  for (const tier of TIERS) {
    tiers[tier] = {
      ...readTier(value, tier),
      overridden: Boolean(user && typeof user === 'object' && user[tier] !== undefined),
    }
  }

  const section = value && typeof value === 'object' ? value : {}
  const overrides = section.roles ?? {}

  // Reuse the resolver the plugin actually mounts from, so the card cannot
  // show a role on a model its children are not really running on.
  let resolved = []
  try {
    resolved = resolveRoles(section)
  } catch {
    resolved = []
  }
  const byRole = Object.fromEntries(resolved.map((entry) => [entry.role, entry]))

  const roles = ROLE_NAMES.map((role) => {
    const override = overrides[role] ?? {}
    const entry = byRole[role]
    return {
      role,
      tool: override.toolName ?? ROLES[role].tool,
      tier: override.tier ?? ROLES[role].tier,
      enabled: override.enabled !== false,
      // Every model actually serving this role. Two or more make it a panel.
      members: (entry?.members ?? []).map((member) => ({
        provider: member.provider,
        model: member.model,
      })),
      // `pinned` means the role names its own models; otherwise it follows its
      // tier, and no members at all means the deployment default answers.
      pinned: Boolean(
        (Array.isArray(override.models) && override.models.length > 0)
        || (override.provider && override.model),
      ),
    }
  })

  // Hiring is on unless the document says otherwise; the card shows the
  // effective state and whether the user is the one who set it.
  const team = {
    enabled: section.team !== false,
    overridden: Boolean(user && typeof user === 'object' && user.team !== undefined),
  }

  return {
    writable: Boolean(writable),
    tiers,
    roles,
    team,
    models,
    panels: buildPanelIndex(section, roles),
  }
}

/**
 * Name the tools whose calls come back as a panel, with the roster each asks.
 *
 * Decided here rather than in the browser so one place owns what makes a panel:
 * the browser half only takes over the rendering of a tool named in this list,
 * and a tool that stops being a panel stops being claimed.
 *
 * @param section - the resolved settings section.
 * @param roles - the role rows already built for the card.
 * @returns `{ <toolName>: [{provider, model, label, lens?}] }`, panels only.
 */
export function buildPanelIndex(section, roles) {
  const panels = {}
  for (const entry of roles) {
    if (entry.enabled === false || entry.members.length < 2) continue
    panels[entry.tool] = entry.members.map((member) => ({
      provider: member.provider,
      model: member.model,
      label: `${member.provider} / ${member.model}`,
    }))
  }

  // The standalone cross-check keeps its own roster, which may name roles and
  // lenses the per-role rows never carry.
  let members = []
  try {
    members = section.crosscheck === false ? [] : resolvePanel(section)
  } catch {
    members = []
  }
  if (members.length >= 2) {
    panels[CROSSCHECK_TOOL] = members.map((member) => ({
      provider: member.provider,
      model: member.model,
      label: member.label,
      ...(member.lens ? { lens: member.lens } : {}),
    }))
  }
  return panels
}

/**
 * Fold one card submission into the next user section.
 *
 * A tier or a role arrives as a provider/model pair to store, or null to clear
 * it back to the layer below; every other key the document holds is carried
 * through untouched.
 *
 * @param user - the current raw user section.
 * @param patch - `{ strong?, worker?, roles?: { <role>: pair | null } }`.
 * @returns the next user section.
 * @throws if the patch names an unknown tier or role.
 */
export function nextUserSection(user, patch) {
  const next = user && typeof user === 'object' ? { ...user } : {}

  for (const [key, entry] of Object.entries(patch ?? {})) {
    if (key === 'roles') continue
    if (key === 'team') {
      // A boolean sets it; null returns the key to whatever the profile patch
      // decided, which is not the same as writing `true`.
      if (entry === null || entry === undefined) delete next.team
      else next.team = Boolean(entry)
      continue
    }
    if (!TIERS.includes(key)) throw new Error(`unknown tier "${key}"`)
    const pair = readPair(entry)
    if (pair === undefined) delete next[key]
    else next[key] = pair
  }

  if (patch?.roles !== undefined) {
    const roles = { ...(next.roles && typeof next.roles === 'object' ? next.roles : {}) }
    for (const [role, entry] of Object.entries(patch.roles ?? {})) {
      if (!ROLE_NAMES.includes(role)) throw new Error(`unknown role "${role}"`)
      const existing = roles[role] && typeof roles[role] === 'object' ? { ...roles[role] } : {}
      const models = readModels(entry)
      if (models.length === 0) {
        // Clearing a role's models returns it to its tier, but must not discard
        // whatever else that role carries (its tier, its tool name, enabled).
        delete existing.models
        delete existing.provider
        delete existing.model
      } else {
        existing.models = models
        // The list is the whole answer; a stale single pin beside it would
        // read as a second opinion the resolver never consults.
        delete existing.provider
        delete existing.model
      }

      if (Object.keys(existing).length === 0) delete roles[role]
      else roles[role] = existing
    }
    if (Object.keys(roles).length === 0) delete next.roles
    else next.roles = roles
  }

  return next
}

/**
 * Normalise one submitted provider/model pair.
 *
 * @param entry - the submitted value.
 * @returns the trimmed pair, or undefined when it clears the slot. Half a route
 * is not a route — the schema requires both, so an incomplete pair clears
 * rather than storing something that silently does nothing.
 */
function readPair(entry) {
  if (entry === null || entry === undefined) return undefined
  const provider = typeof entry.provider === 'string' ? entry.provider.trim() : ''
  const model = typeof entry.model === 'string' ? entry.model.trim() : ''
  if (provider === '' || model === '') return undefined
  return { provider, model }
}

/**
 * Normalise a role's submitted model list.
 *
 * @param entry - `{ models: [...] }`, a bare pair, or null.
 * @returns the accepted pairs, deduplicated; empty means the role follows its
 * tier again.
 */
function readModels(entry) {
  if (entry === null || entry === undefined) return []
  const declared = Array.isArray(entry.models)
    ? entry.models
    : Array.isArray(entry) ? entry : [entry]

  const seen = new Set()
  const models = []
  for (const candidate of declared) {
    const pair = readPair(candidate)
    if (pair === undefined) continue
    const key = `${pair.provider}/${pair.model}`
    if (seen.has(key)) continue
    seen.add(key)
    models.push(pair)
  }
  return models
}

/**
 * Lay one coordinator's roster out for the strip above the composer.
 *
 * Deliberately not a sweep. `ccg_roster` prunes rows the harness no longer
 * holds, because a model reading the roster is a considered act; this route is
 * polled by a browser, and a GET that deletes durable rows in the background is
 * the wrong shape entirely. It reports what is stored and what is live, and
 * claims nothing about the gap — a teammate hired seconds ago is legitimately
 * absent from the live listing (the creation window), so "not listed" is not
 * "gone" and this does not say it is.
 *
 * @param rows - the coordinator's durable rows.
 * @param status - childId → live activity, where the service answered.
 * @returns the strip payload.
 */
export function buildTeamPayload(rows = [], status = {}) {
  return {
    teammates: rows.map((row) => ({
      childId: row.childId,
      role: row.role,
      label: row.label,
      ...(row.provider && row.model ? { provider: row.provider, model: row.model } : {}),
      owns: Array.isArray(row.owns) ? row.owns : [],
      hiredAt: row.hiredAt ?? 0,
      ...(status[row.childId] ? { activity: status[row.childId] } : {}),
    })),
  }
}

/**
 * Ask the subagent service which of these children are running.
 *
 * The field is `activity` (`running` | `inactive`); there is no `status`. A
 * service that cannot answer yields no status rather than a guess — the
 * ownership map is the part nothing else holds, and it is still correct.
 *
 * @param subagents - the subagent service, when present.
 * @param parentId - the coordinator session.
 * @param rows - its roster; empty skips the call entirely.
 * @returns childId → activity.
 */
export async function liveActivity(subagents, parentId, rows = []) {
  if (subagents?.listChildren === undefined || rows.length === 0) return {}
  try {
    const status = {}
    for (const entry of await subagents.listChildren(parentId)) {
      const id = String(entry?.id ?? '')
      if (id !== '' && entry?.activity) status[id] = String(entry.activity)
    }
    return status
  } catch {
    return {}
  }
}

/**
 * Serve the team strip's roster.
 *
 * Read-only: this route has no write verb at all, which is why it needs no
 * loopback fence of its own beyond the one the web server already applies.
 *
 * @param ctx - a context carrying `webServer`.
 * @param deps - `{ getTable, getSubagents }`.
 * @returns the disposer removing the route.
 */
export function registerTeamRoute(ctx, deps = {}) {
  const getTable = deps.getTable ?? (() => undefined)
  const getSubagents = deps.getSubagents ?? (() => ctx.get('subagents'))

  return ctx.webServer.register({
    kind: 'exact',
    path: TEAM_API_PATH,
    handler: async (req, res) => {
      try {
        if (req.method !== 'GET') {
          res.writeHead(405, { Allow: 'GET' })
          res.end()
          return
        }
        const session = new URL(req.url, 'http://localhost').searchParams.get('session') ?? ''
        const table = getTable()
        // No session, or a deployment with no storage form: an empty team is
        // the honest answer and the strip renders nothing.
        if (session.trim() === '' || table === undefined) {
          send(res, 200, buildTeamPayload([]))
          return
        }
        const rows = rosterOf(table, session.trim())
        send(res, 200, buildTeamPayload(rows, await liveActivity(getSubagents(), session.trim(), rows)))
      } catch (error) {
        send(res, 400, { error: String(error?.message ?? error) })
      }
    },
  })
}

/**
 * Read a JSON request body, bounded so a stray upload cannot grow the heap.
 *
 * @param req - the incoming request.
 * @param limit - maximum accepted body size in bytes.
 * @returns the parsed body.
 */
function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', reject)
    req.on('end', () => {
      try {
        resolve(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
  })
}

/** Answer with one JSON value. */
function send(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  })
  res.end(text)
}

/**
 * Serve the card's section over the harness web server.
 *
 * @param ctx - a context carrying `webServer`.
 * @param scope - the host-side settings scope for the `ccg` namespace.
 * @param snapshot - reads `{ value, user, writable }` for the current section.
 * @param catalog - resolves the model catalog the selectors offer.
 * @returns the disposer removing the route.
 */
export function registerConfigRoute(ctx, scope, snapshot, catalog = async () => []) {
  return ctx.webServer.register({
    kind: 'exact',
    path: API_PATH,
    handler: async (req, res) => {
      try {
        if (req.method === 'GET') {
          const { value, user, writable } = snapshot()
          send(res, 200, buildConfigPayload(value, user, writable, await catalog()))
          return
        }
        if (req.method === 'POST') {
          if (!isLoopback(req)) {
            send(res, 403, { error: 'ccg: settings writes are accepted from this machine only' })
            return
          }
          const patch = await readJsonBody(req)
          const { user } = snapshot()
          await scope.replace(nextUserSection(user, patch))
          const after = snapshot()
          send(res, 200, buildConfigPayload(after.value, after.user, after.writable, await catalog()))
          return
        }
        res.writeHead(405, { Allow: 'GET, POST' })
        res.end()
      } catch (error) {
        send(res, 400, { error: String(error?.message ?? error) })
      }
    },
  })
}
