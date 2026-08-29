/**
 * Teams — the third half of CCG.
 *
 * Routing sends different work to different models. A panel puts several models
 * on the same work. A TEAM is neither: it is a set of colleagues that stay
 * alive across turns, each owning part of the change, each reporting back as
 * they finish. That is what CCG's `/ccg:team` does on Claude Code, and it is
 * the only one of the three that a one-shot delegation genuinely cannot fake —
 * a one-shot child answers once and is gone, so nothing can be handed to it
 * afterwards and nothing can arrive from it unasked.
 *
 * The harness already owns every primitive this needs: `startContinuable`
 * keeps a child resident, `send_message` opens its next turn, `report` is its
 * channel home, `interrupt_agent` stops a turn that went wrong, `list_agents`
 * shows who is alive. What was missing is a way to hire one of those children
 * AS A CCG ROLE — with that role's persona, that role's model, and the file
 * ownership that makes several of them safe to run at once. That is this file.
 *
 * One tool, every role. Seven more continuable delegation tools would double
 * the tool table and force a choice between `ccg_build` and `ccg_build_live` on
 * every call; a `role` enum makes it one decision instead — do I want an
 * answer, or a colleague?
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

import { ROLES, ROLE_NAMES } from './roles.js'
import {
  collisionsWith,
  describeCollisions,
  normaliseOwns,
  rosterOf,
  sweepStale,
} from './memory.js'

/** Default tool name for hiring. */
export const TEAM_TOOL = 'ccg_team'

/**
 * What every teammate is told on top of its role persona.
 *
 * A teammate differs from a one-shot child in exactly three ways, and each of
 * them has to be said or the child behaves like a one-shot anyway: it will be
 * spoken to again, it must speak back on its own initiative, and it is not
 * alone in the working tree.
 */
const TEAM_FRAMING = [
  'You are a member of a team working on this together, not a one-shot helper.',
  '',
  'How your turns work:',
  '- You stay alive between assignments. The coordinator will send you more work as the',
  '  job develops, and each message is a new turn with everything you already know intact.',
  '- You cannot see the coordinator\'s conversation, only what they wrote to you. If an',
  '  assignment leaves out something you need — a decision, a constraint, a file — ask for it',
  '  rather than inventing a plausible version of it.',
  '- Nobody sees your work unless you `report` it. Report once when an assignment is done,',
  '  with a self-contained account of what you changed and how to verify it — and report',
  '  EARLIER, without being asked, the moment you learn something that changes what someone',
  '  else should do: a shared contract you had to alter, a blocker, an assumption of yours',
  '  that turned out to be wrong. A late report is worth much less than a partial one.',
  '- Say what you did not do and what you are unsure about. The coordinator is integrating',
  '  your work with other people\'s and cannot see your reasoning.',
].join('\n')

/** The ownership rule, when the coordinator assigned paths. */
function ownershipRule(owns) {
  if (!Array.isArray(owns) || owns.length === 0) {
    return [
      'You have not been given exclusive files. Other teammates may be editing this tree at',
      'the same time, so keep your edits tightly scoped to your assignment, and if the work',
      'needs a change in shared code, `report` the need rather than making it unilaterally.',
    ].join('\n')
  }
  return [
    'You own these paths, and only these:',
    ...owns.map((path) => `  ${path}`),
    '',
    'Do not create, edit, move or delete anything outside them — a teammate is working there',
    'right now and your write would be silently lost or would silently lose theirs. If your',
    'assignment cannot be finished without a change elsewhere, `report` exactly what you need',
    'and from whom, then continue with whatever else you can do. Reading outside your paths is',
    'fine and encouraged: understand the code you are integrating with.',
  ].join('\n')
}

/**
 * Build one teammate's opening message: their first assignment, and whatever
 * background the coordinator handed over with it.
 *
 * Who they are, how a teammate behaves and what they own all live in the
 * persona instead — persona is scoped to the child for its whole life, while
 * this message is one turn among the many they will have.
 *
 * @param brief - the first assignment.
 * @param context - optional shared background handed over verbatim.
 * @returns the child's opening user message.
 */
export function buildTeammatePrompt(brief, context) {
  const parts = [`First assignment:\n${brief}`]
  if (context) parts.push(`Shared context:\n${context}`)
  return parts.join('\n\n')
}

/**
 * Build one teammate's persona: the role's expert instructions, then what being
 * on a team adds to them.
 *
 * @param role - resolved role entry.
 * @param owns - paths this teammate holds exclusively.
 * @returns the persona text shadowing the deployment persona for this child.
 */
export function buildTeammatePersona(role, owns) {
  return [role.persona, TEAM_FRAMING, ownershipRule(owns)].join('\n\n')
}

/**
 * Pick the route a teammate runs on.
 *
 * A team member is one agent, so a role holding a panel cannot hire all of its
 * models at once — it hires the first and the report names it, rather than
 * quietly running something other than what the config shows.
 *
 * @param role - resolved role entry.
 * @returns `{provider, model, maxTokens?}`, or undefined for the deployment default.
 */
export function teammateRoute(role) {
  return role.members[0]
}

/** Name a route for a human reader. */
function routeLabel(route) {
  return route === undefined ? 'deployment default model' : `${route.provider} / ${route.model}`
}

/**
 * The confirmation the coordinator reads after hiring.
 *
 * It says the one thing the model most often gets wrong about a live teammate:
 * the answer is not coming back through this call.
 *
 * @param value - the tool's structured output.
 * @returns the model-facing text.
 */
export function formatHireReport(value) {
  if (value.hired === false) {
    return [
      `Not hired: the user declined a ${value.role} teammate for "${value.label}".`,
      '',
      'That is an answer, not an error. Do this part yourself, or propose a different split —',
      'fewer people, different files, or a one-shot role tool instead of a colleague. Do not',
      'retry the same hire, and do not work around it by starting the same agent another way.',
    ].join('\n')
  }
  const lines = [
    `${value.role} teammate hired: ${value.childId}`,
    `Running on ${value.route}. Working on: ${value.label}`,
  ]
  if (value.note) lines.push(value.note)
  if (Array.isArray(value.owns) && value.owns.length > 0) {
    lines.push(`Owns exclusively: ${value.owns.join(', ')}`)
  }
  lines.push(
    '',
    'They have their assignment and are working now. Nothing comes back through this call —',
    `their findings arrive on their own as a report from ${value.childId}, which may be several`,
    'minutes away, and that report wakes you by itself. So do not sleep, poll or loop waiting for',
    'it: hire the rest of the team, do your own part of the work, or simply end your turn saying',
    'who is working on what. Ending the turn costs nothing and you will be started again when the',
    'first answer lands.',
    '',
    `To give them more work later: send_message(${value.childId}, ...) — it becomes their next`,
    'turn and returns no reply. To stop a turn that has gone wrong:',
    `interrupt_agent(${value.childId}). To see who is alive: list_agents.`,
  )
  return lines.join('\n')
}

/** Question id, so the answer can be matched rather than assumed to be first. */
export const HIRE_QUESTION_ID = 'ccg-hire'

/** The option that hires. The intent names it, so no UI infers it from order. */
export const HIRE_APPROVE = 'Hire'

/** The option that does not. */
export const HIRE_DECLINE = 'Not now'

/** How much of the brief the approval shows before it stops being skimmable. */
const BRIEF_PREVIEW = 600

/**
 * The confirmation shown before a teammate is started.
 *
 * Hiring is the one thing this plugin does that the user cannot easily undo by
 * reading the next message: a colleague starts working immediately, on its own
 * model, holding files nobody else may write, and it keeps going after the turn
 * ends. The convention already tells the coordinator to announce the split and
 * wait for a yes, and that works — but a convention is prose, and this is the
 * decision that deserves a mechanism.
 *
 * It rides `ctx.userQuestions` rather than a card of this plugin's own: the
 * harness owns that seam, ships the UI for it, and even has a `plan-review`
 * intent meaning exactly "here is a plan, approve or decline" — so a capable UI
 * renders this as the approval it is instead of a generic menu.
 *
 * @param spec - `{ role, label, route, owns, brief }`.
 * @returns the question to ask.
 */
export function hireApprovalQuestion(spec) {
  const owns = spec.owns ?? []
  const brief = String(spec.brief ?? '')
  const detail = [
    `**${spec.role}** · ${spec.label}`,
    '',
    `Runs on **${spec.route}**, stays alive across turns, and can be given more work with `
    + '`send_message`.',
    owns.length > 0
      ? `Writes only ${owns.map((path) => `\`${path}\``).join(', ')} — while it holds them, `
        + 'nothing else may write those, including the coordinator.'
      : 'Holds no files exclusively. If it is going to edit anything, it should be given files.',
    '',
    'First assignment:',
    '',
    brief.length > BRIEF_PREVIEW ? `${brief.slice(0, BRIEF_PREVIEW)}…` : brief,
  ].join('\n')

  return {
    id: HIRE_QUESTION_ID,
    header: 'CCG team',
    question: `Hire a ${spec.role} teammate?`,
    detail,
    options: [
      { label: HIRE_APPROVE, description: 'Start it now, on the files above.' },
      { label: HIRE_DECLINE, description: 'Do not hire; this part stays with the coordinator.' },
    ],
    // Presentation only — the answer encoding is identical either way, so a UI
    // that does not know this intent still returns a readable verdict.
    intent: { kind: 'plan-review', approve: HIRE_APPROVE },
  }
}

/**
 * Read the verdict out of an answer.
 *
 * Fails closed: anything that is not an explicit approval is a decline. The
 * whole point of the gate is that hiring needs a yes, so an answer this cannot
 * read must not become one.
 *
 * @param answer - what `ctx.userQuestions.ask()` returned.
 * @returns whether the user approved.
 */
export function readApproval(answer) {
  const item = (answer?.answers ?? []).find((entry) => entry?.id === HIRE_QUESTION_ID)
  return Array.isArray(item?.selected) && item.selected.includes(HIRE_APPROVE)
}

/**
 * Error codes meaning nobody could have answered, as opposed to a failure.
 *
 * A headless deployment registers no provider; a delegated or non-live caller
 * has no human at the other end. Refusing to hire in those cases would be a
 * deadlock rather than a guard — the same reason a foreign ownership claim
 * warns instead of refusing.
 */
const UNANSWERABLE = new Set(['NO_PROVIDER', 'DELEGATED_CALLER', 'CALLER_NOT_LIVE'])

/**
 * Ask the user whether to hire, where anyone can be asked.
 *
 * @param userQuestions - the service, when the deployment has one.
 * @param question - output of {@link hireApprovalQuestion}.
 * @param exec - `{ agent, signal }` from the tool call.
 * @returns `{ approved, note? }`; `note` explains any hire made without a
 * confirmation, so a gate is never bypassed silently.
 */
export async function confirmHire(userQuestions, question, exec) {
  if (userQuestions?.ask === undefined) return { approved: true }
  try {
    return {
      approved: readApproval(await userQuestions.ask({
        questions: [question],
        ...(exec?.agent ? { agent: exec.agent } : {}),
        ...(exec?.signal ? { signal: exec.signal } : {}),
      })),
    }
  } catch (error) {
    // A cancelled turn is not a declined hire; let it end the call.
    if (exec?.signal?.aborted) throw error
    if (UNANSWERABLE.has(error?.code)) return { approved: true }
    // The seam exists but failed. Hiring anyway keeps a UI hiccup from bricking
    // teams, but it must say so — a confirmation that quietly did not happen is
    // worse than none at all.
    return {
      approved: true,
      note: `(Hired without a confirmation: the approval could not be shown — ${error?.message ?? error})`,
    }
  }
}

/**
 * Describe the hiring tool for the model, naming the roles it can actually
 * hire and what each one runs on.
 *
 * @param resolved - output of `resolveRoles`.
 * @returns the tool description.
 */
export function describeTeam(resolved) {
  const roster = resolved
    .map((entry) => `${entry.role} (${routeLabel(teammateRoute(entry))})`)
    .join(', ')
  return 'Hire a CCG specialist as a live teammate: they keep working across turns, you can '
    + 'send them more work, and they report back on their own as they finish. Available: '
    + `${roster}. Use it when a job has parts that can genuinely proceed at the same time and `
    + 'each part is substantial enough to be worth a colleague — then give each teammate the '
    + 'files it alone may write. For a single question you want answered now, use that role\'s '
    + 'own tool instead: a teammate returns no answer through this call.'
}

/**
 * Register the hiring tool.
 *
 * @param ctx - a context carrying `tools`, and `subagents` by the time it runs.
 * @param spec - `{ resolved, toolName?, subagentProvider?, maxDepth? }`.
 * @returns the disposer removing the tool.
 */
export function registerTeamTool(ctx, spec) {
  return ctx.tools.register(teamToolDefinition({
    ...spec,
    getSubagents: () => ctx.get('subagents'),
    // Optional service: read lazily, because a deployment may mount it after
    // this tool registers, and a headless one may never mount it at all.
    getUserQuestions: spec.getUserQuestions ?? (() => ctx.get('userQuestions')),
  }))
}

/**
 * Build the hiring tool's definition.
 *
 * Separate from registration for the same reason the panel's is: `defineTool`
 * validates its schemas while building, and a definition that throws takes the
 * entire tool table down — so a test compiles this exact definition.
 *
 * @param spec - `{ resolved, toolName?, subagentProvider?, maxDepth?, confirm?,
 * getSubagents, getUserQuestions? }`.
 * @returns the registry-ready definition.
 */
export function teamToolDefinition(spec) {
  const resolved = spec.resolved ?? []
  const toolName = spec.toolName ?? TEAM_TOOL
  const provider = spec.subagentProvider ?? 'spawn'
  const getSubagents = spec.getSubagents ?? (() => undefined)
  // Hiring asks the user first unless a deployment turns that off.
  const confirm = spec.confirm !== false
  const getUserQuestions = spec.getUserQuestions ?? (() => undefined)
  // Durable ownership. Absent in a deployment with no storage form, in which
  // case hiring still works — it just cannot check or remember who holds what.
  const getTable = spec.getTable ?? (() => undefined)
  const now = spec.now ?? (() => Date.now())
  // A teammate does one scoped job; it is not the one deciding who else gets
  // hired. Without this it could start a team the user never approved.
  const toolFilter = spec.toolFilter
  const byRole = new Map(resolved.map((entry) => [entry.role, entry]))
  const hirable = resolved.map((entry) => entry.role)

  return defineTool({
    name: toolName,
    description: describeTeam(resolved),
    parameters: {
      role: {
        type: 'string',
        required: true,
        // A closed enum built from the resolved matrix: a role switched off in
        // config is not offered, so the model cannot hire something absent.
        enum: hirable,
        description: 'Which CCG specialist to hire. Each carries that role\'s expert instructions '
          + 'and runs on the model configured for it.',
      },
      description: {
        type: 'string',
        required: true,
        description: 'A short label for this teammate (3-5 words), shown while they work.',
      },
      prompt: {
        type: 'string',
        required: true,
        description:
          'Their first assignment, self-contained. They see none of this conversation: name the '
          + 'files, the contracts they must honour, what "done" means, and how their part fits '
          + 'the whole — a teammate who does not know the shape of the job integrates badly.',
      },
      context: {
        type: 'string',
        description: 'Optional background handed to them verbatim — a spec, a diff, an error, the '
          + 'agreed design.',
      },
      owns: {
        type: 'array',
        items: { type: 'string' },
        description:
          'The files or directories this teammate alone may write, as paths or globs. Give every '
          + 'concurrent teammate a disjoint set: two agents editing one file lose each other\'s '
          + 'work silently. Omit only when this teammate is the sole writer.',
      },
    },
    // The value-schema DSL, not raw JSON Schema: `additionalProperties` is
    // stated outright and `required` sits on each property.
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          // A declined hire is a legitimate outcome, not a failure: throwing
          // would read to the model as "the tool broke, try again".
          hired: { type: 'boolean', required: true },
          childId: { type: 'string' },
          role: { type: 'string', required: true },
          label: { type: 'string', required: true },
          route: { type: 'string', required: true },
          owns: { type: 'array', items: { type: 'string' } },
          note: { type: 'string' },
        },
      },
      render: (args, value) => [{ type: 'text', text: formatHireReport(value) }],
    },
    async execute(args, exec) {
      const subagents = getSubagents()
      if (subagents === undefined) throw new Error('ccg: the subagents service is not available')
      if (subagents.startContinuable === undefined) {
        throw new Error(
          'ccg: this deployment\'s subagent service cannot keep children alive, so a team cannot '
          + 'be hired; use the one-shot role tools instead',
        )
      }
      const parent = exec?.agent
      if (parent === undefined) throw new Error(`ccg: ${toolName} needs an agent session`)

      const role = byRole.get(String(args.role ?? ''))
      if (role === undefined) {
        throw new Error(
          `ccg: no role "${args.role}" is registered; hirable roles are ${hirable.join(', ')}`,
        )
      }
      const brief = String(args.prompt ?? '').trim()
      if (brief === '') throw new Error('ccg: prompt is required — a teammate needs an assignment')

      const context = typeof args.context === 'string' ? args.context.trim() : ''
      const owns = normaliseOwns(args.owns)
      const label = String(args.description ?? role.role)
      const route = teammateRoute(role)

      // Refuse BEFORE starting anything. One writer per file is this feature's
      // central claim, and a check that ran after the child was already working
      // would be a warning, not a rule.
      const table = getTable()
      if (table !== undefined && owns.length > 0) {
        // Retire rows the harness no longer holds first, or an abandoned
        // teammate would block these files forever with no way to notice.
        if (subagents.listChildren !== undefined) {
          await sweepStale(
            table,
            [String(parent.id)],
            (parentId) => subagents.listChildren(parentId, exec?.signal),
            now(),
          )
        }
        const collisions = collisionsWith(rosterOf(table, String(parent.id)), owns)
        if (collisions.length > 0) throw new Error(describeCollisions(collisions))
      }

      // Asked after the collision check and before anything starts: there is no
      // point asking about a hire that is going to be refused anyway, and no
      // point asking about one that has already begun.
      const approval = confirm
        ? await confirmHire(
          getUserQuestions(),
          hireApprovalQuestion({ role: role.role, label, route: routeLabel(route), owns, brief }),
          exec,
        )
        : { approved: true }

      if (!approval.approved) {
        return { hired: false, role: role.role, label, route: routeLabel(route), ...(owns.length > 0 ? { owns } : {}) }
      }

      const { childId } = await subagents.startContinuable({
        provider,
        label: `${role.role} · ${label}`,
        request: {
          prompt: [{ type: 'text', text: buildTeammatePrompt(brief, context) }],
          parent,
          persona: buildTeammatePersona(role, owns),
          ...(route ? { agentOptions: { ...route } } : {}),
          ...(typeof spec.maxDepth === 'number' ? { maxDepth: spec.maxDepth } : {}),
          ...(toolFilter ? { toolFilter } : {}),
        },
        signal: exec?.signal,
      })

      const id = String(childId)
      // Record after the child exists, so a failed start leaves no ghost owner.
      // A memory write that fails must not lose a teammate that is already
      // working — the hire is reported either way.
      if (table !== undefined) {
        try {
          await table.put(id, {
            childId: id,
            hiredBy: String(parent.id),
            ...(parent.session?.header?.cwd ? { workspace: String(parent.session.header.cwd) } : {}),
            role: role.role,
            label,
            ...(route ? { provider: route.provider, model: route.model } : {}),
            owns,
            hiredAt: now(),
          })
        } catch {
          // Ownership goes unrecorded for this one; the roster stays truthful
          // about everyone else rather than failing the whole call.
        }
      }

      return {
        hired: true,
        childId: id,
        role: role.role,
        label,
        route: routeLabel(route),
        ...(owns.length > 0 ? { owns } : {}),
        ...(approval.note ? { note: approval.note } : {}),
      }
    },
  })
}

/**
 * The team convention shown to the coordinator.
 *
 * The primitives are already in the prompt — the harness publishes
 * `send_message`, `report` and `list_agents` on their own. What is missing, and
 * what this supplies, is the judgement around them: when a team beats a
 * delegation at all, and the two rules that decide whether concurrent agents
 * produce work or wreckage.
 *
 * @param resolved - output of `resolveRoles`.
 * @param toolName - the registered hiring tool's name.
 * @returns the system-prompt section text, or '' when nothing can be hired.
 */
export function renderTeamPrompt(resolved, toolName = TEAM_TOOL) {
  if (resolved.length === 0) return ''
  return [
    'CCG teams — several specialists working at once, kept alive between turns.',
    '',
    `\`${toolName}\` hires one; hire the few the job actually needs, all before waiting on any of`,
    'them. Each is a real colleague: it holds its own context across turns, you extend its work',
    'with `send_message`, it answers on its own initiative through a report, `interrupt_agent`',
    'stops a turn heading the wrong way, and `list_agents` shows who is alive.',
    '',
    'When a team earns its cost:',
    '- The work genuinely splits — separate modules, separate files, separate concerns — and the',
    '  parts can proceed without waiting on each other.',
    '- Each part is substantial. Two minutes of work does not need a colleague; delegate it.',
    '- The job will keep developing. If you will have nothing more to say to them after the',
    '  first assignment, one-shot role tools are cheaper and simpler.',
    'When it does not: a single question (use the role tool), a question worth several opinions',
    '(use the panel), or work whose parts must happen in order (just do them in order).',
    '',
    'Each hire asks the user to approve it — role, model, and the files it will hold — and a',
    'decline comes back as an ordinary result, not an error. So say the plan and its arithmetic',
    'once, then hire; do not also ask for permission in prose and wait, or the user answers the',
    'same question twice. If a hire is declined, take that part yourself or propose a different',
    'split — never route around it by starting the same agent another way.',
    '',
    'Two rules decide whether a team helps or corrupts the tree:',
    '- ONE WRITER PER FILE. Give every concurrent teammate a disjoint `owns` set before hiring.',
    '  Two agents editing one file lose each other\'s work with no error. Where a change spans a',
    '  shared file, one owner makes it and the others are told, in order.',
    '  This binds YOU too. While a teammate is alive, its files are its own: when integration',
    '  turns up a fault in one, `send_message` the owner — do not quietly fix it yourself. They',
    '  still believe they own that file, and one more assignment to them would overwrite you',
    '  without either of you seeing a conflict. Editing it yourself is right only once you have',
    '  said you are taking it back and will send them nothing further.',
    '- SETTLE THE CONTRACTS FIRST. Teammates cannot see each other. Any interface two of them',
    '  meet at — a signature, a schema, an event name, a file format — must be decided and',
    '  written into both briefs before either starts, or they will each invent a reasonable',
    '  version and neither will fit.',
    '',
    'While they work: reports arrive as they finish, out of order and possibly minutes apart.',
    'Read each as it lands, integrate it, and route what it implies for the others — a teammate',
    'reporting a changed contract is the signal to `send_message` whoever depends on it. When a',
    'report says something you did not expect, verify it yourself before building on it. The',
    'integration and the final verdict stay yours; never let a teammate ratify its own work.',
    '',
    'When one goes wrong: `interrupt_agent` stops the turn it is in the middle of, and only that',
    'turn — queued messages stay parked and the teammate stays available. Reach for it the moment',
    'you can see a teammate is building the wrong thing: it is working from a brief you wrote, so',
    'a misunderstanding costs the whole assignment if you let it finish. Interrupt, then',
    '`send_message` the correction. Interrupting is cheap; a wrong deliverable is not.',
    '',
    'How to wait: do not. Never sleep, poll, or loop to pass the time — a report wakes you by',
    'itself, so finishing your turn IS how you wait, and it costs nothing. Say who is working on',
    'what and stop. You will be started again when the first one answers. Sleeping only burns the',
    'user\'s money to arrive at the same moment.',
    'And do not invent filler work while they run. Reviewing, testing or analysing a file nobody',
    'has written yet costs a full delegation to examine a stub — it is worse than idling, because',
    'it also produces findings about code that will not exist. Prepare the integration you will',
    'need (the command that proves the whole thing works, the cases you will check) or stop.',
  ].join('\n')
}
