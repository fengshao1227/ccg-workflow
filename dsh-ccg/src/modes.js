/**
 * Triage — the front door.
 *
 * A user should be able to just say what they want. What follows should not be
 * a fixed ceremony: a one-line fix does not deserve a four-phase pipeline, and
 * a migration does not deserve a single confident guess.
 *
 * So the plugin publishes three modes and makes the main model choose one
 * openly, with its real cost, before spending anything. The menu is derived
 * from the roles actually mounted — a mode can never advertise a step the
 * deployment cannot run, or a model count that is not what will be billed.
 */

/**
 * The phase a mode spends, named by the role that serves it.
 *
 * Three of the four are sequences: one specialist at a time, each handing to
 * the next. Team is not — it has no fixed roster because its shape comes from
 * how the work splits, which only the request can say.
 */
const MODE_PLANS = {
  direct: { roles: [], label: 'Direct' },
  standard: { roles: ['architect', 'builder', 'reviewer'], label: 'Standard' },
  deep: {
    roles: ['analyzer', 'architect', 'builder', 'tester', 'reviewer'],
    label: 'Deep',
  },
  team: { roles: [], label: 'Team', team: true },
}

/** Mode order shown to the model: the three sequences cheapest first, then the team. */
export const MODE_NAMES = ['direct', 'standard', 'deep', 'team']

const MODE_WHEN = {
  direct: 'a one-line fix, a rename, a question you can answer by reading two files',
  standard: 'an ordinary feature, a bug with a known cause, a contained refactor',
  deep: 'a design with real alternatives, an unclear bug, a migration, anything you would '
    + 'hate to get wrong',
  team: 'work that genuinely splits — several modules, several files, parts that do not wait '
    + 'on each other — and will keep developing after the first assignment',
}

const MODE_KEEPS = {
  direct: 'You do the work yourself. No delegation, no waiting.',
  standard: 'One specialist per phase, each on its own model.',
  deep: 'Every phase gets its specialist, and the quality gates run before the review.',
  team: 'Several specialists at once, each holding its own files and its own context, reporting '
    + 'back as they finish while you integrate.',
}

/**
 * What Deep additionally buys where panels exist.
 *
 * Said only when a role in the plan really holds several models: with none
 * configured, "answers with all of its models at once" describes a deployment
 * this is not.
 */
const DEEP_PANEL_NOTE = 'Roles holding several models answer with all of them at once, so where '
  + 'they disagree is the finding.'

/**
 * Cost one mode against the roles that are actually mounted.
 *
 * @param resolved - output of `resolveRoles`.
 * @param mode - a key of {@link MODE_PLANS}.
 * @returns `{ mode, label, when, keeps, steps, delegations, modelCalls }` where
 * a step names its role's tool and the models that role will really use.
 */
export function costMode(resolved, mode) {
  const byRole = Object.fromEntries(resolved.map((entry) => [entry.role, entry]))
  const plan = MODE_PLANS[mode]

  const steps = []
  let modelCalls = 0
  for (const role of plan.roles) {
    const entry = byRole[role]
    // A role switched off in this deployment is skipped rather than promised.
    if (entry === undefined) continue
    const models = entry.members.length === 0
      ? ['deployment default']
      : entry.members.map((member) => `${member.provider} / ${member.model}`)
    modelCalls += Math.max(1, entry.members.length)
    steps.push({ role, tool: entry.toolName, models })
  }

  // Whether this mode's own steps really put several models on one brief.
  const panelled = steps.some((step) => step.models.length >= 2)

  return {
    mode,
    label: plan.label,
    when: MODE_WHEN[mode],
    keeps: mode === 'deep' && panelled
      ? `${MODE_KEEPS.deep} ${DEEP_PANEL_NOTE}`
      : MODE_KEEPS[mode],
    steps,
    delegations: steps.length,
    modelCalls,
    panelled,
    ...(plan.team === true ? { team: true } : {}),
  }
}

/**
 * The whole menu, cheapest first.
 *
 * @param resolved - output of `resolveRoles`.
 * @param options - `{ team }`; drop the team mode where nothing can be hired.
 * @returns one costed mode per offered entry in {@link MODE_NAMES}.
 */
export function buildModeMenu(resolved, options = {}) {
  const names = options.team === false
    ? MODE_NAMES.filter((mode) => mode !== 'team')
    : MODE_NAMES
  return names.map((mode) => costMode(resolved, mode))
}

/**
 * Render the triage convention for the system prompt.
 *
 * It asks the model to do three things a user should never have to ask for:
 * say what kind of work it thinks this is, say what running it would cost, and
 * wait for a yes when the cost is real.
 *
 * @param resolved - output of `resolveRoles`.
 * @param options - `{ team, teamTool }`; the team gear is offered only where
 * hiring is actually mounted.
 * @returns the system-prompt section text, or '' when nothing is mounted.
 */
export function renderTriagePrompt(resolved, options = {}) {
  if (resolved.length === 0) return ''
  const teamTool = options.teamTool ?? 'ccg_team'
  const menu = buildModeMenu(resolved, options).filter(
    (entry) => entry.mode === 'direct' || entry.team === true || entry.steps.length > 0,
  )
  // Direct plus one real gear is the least that makes a choice worth stating.
  if (menu.filter((entry) => entry.mode !== 'direct').length === 0) return ''

  const lines = [
    'CCG triage — before working on a request, decide how much machinery it deserves.',
    '',
    'The user should not have to know these modes exist. Read what they asked for, pick the',
    'mode that fits, and say which one you picked and why in one line.',
    '',
  ]

  for (const entry of menu) {
    lines.push(`**${entry.label}** — ${entry.when}`)
    lines.push(`  ${entry.keeps}`)
    for (const step of entry.steps) {
      lines.push(`  ${step.tool} → ${step.models.join(' + ')}`)
    }
    if (entry.team === true) {
      // A team's roster comes from the split, so its total is not knowable
      // here. What IS knowable is the arithmetic — give that, and require the
      // number to be worked out and quoted before anyone is hired. "You choose
      // the headcount" alone is how a user ends up approving an unknown.
      lines.push(
        `  ${teamTool} → one teammate per parallel part, on that role's own model.`,
        '  Cost: one model call per teammate per assignment. A three-person team that takes two',
        '  rounds each is 6 calls, plus your own turns for briefing and integration. Teammates',
        '  keep their context between assignments, so later rounds carry a growing prefix.',
        '  Do the arithmetic out loud before hiring — say the roster, the rounds you expect and',
        '  the resulting number, so the user agrees to a figure rather than to a headcount.',
      )
    } else if (entry.steps.length > 0) {
      lines.push(
        `  Cost: ${entry.delegations} delegation${entry.delegations === 1 ? '' : 's'}, `
        + `${entry.modelCalls} model call${entry.modelCalls === 1 ? '' : 's'}.`,
      )
    }
    lines.push('')
  }

  lines.push(
    'Rules:',
    '- **Direct needs no permission.** If you can just do the work, do it. Asking about a',
    '  one-line fix wastes more of the user\'s time than the fix costs.',
    '- **Anything beyond Direct: say the plan and the cost, then wait for a yes.** These modes',
    '  spend the user\'s money on models they are paying for; they get to decide.',
    '- **Offer the neighbouring mode when it is close.** "This looks Standard; say deep if you',
    '  want the panel on it too" is one sentence and saves a round trip.',
    '- **The user overrules you.** If they name a mode, run that one, even if you would have',
    '  picked another. If they say just do it, stop asking and work.',
    ...(menu.some((entry) => entry.team === true)
      ? [
        '- **Deep and Team are not a ranking.** Deep buys certainty about one thing by asking',
        '  several models about it. Team buys throughput on several things by running colleagues',
        '  at once. A hard question is Deep even if it is small; a wide job is Team even if every',
        '  part is easy. Something both hard and wide is Deep first — settle the design and the',
        '  contracts — then Team to build it.',
      ]
      : []),
    '- Once running, follow the phases in order and report each one as it lands. If a phase',
    '  changes what you believe, say so and re-triage instead of finishing a plan you no',
    '  longer believe in.',
  )
  return lines.join('\n')
}
