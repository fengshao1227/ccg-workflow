/**
 * Panels — the other half of CCG.
 *
 * The role matrix routes different work to different models. A panel puts
 * several models on the SAME work at once and lays the answers side by side,
 * which is what CCG's `analyze` / `review` / `debug` commands have always done
 * on Claude Code: two models answer independently, and the orchestrator reads
 * the disagreement rather than a single confident voice.
 *
 * Any role can hold any number of models. One model is a plain delegation and
 * uses the official subagent tool; two or more make that role a panel, served
 * here. The standalone `ccg_crosscheck` is the same machine with no role
 * persona, for a question that belongs to no single specialism.
 *
 * Nothing here votes or synthesises. A majority of models can be wrong
 * together, and averaging two answers usually destroys what was right in each,
 * so every answer comes back verbatim and the verdict stays where CCG always
 * leaves it: with the model holding the context.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

import { ROLES } from './roles.js'

/** The standalone cross-check's tool name, named once for both halves. */
export const CROSSCHECK_TOOL = 'ccg_crosscheck'

/**
 * Tag on the durable presentation payload, versioned so a browser half from an
 * older install renders nothing rather than misreading a changed shape.
 */
export const PANEL_META_KIND = 'ccg.panel/1'

/** How a panel member is told to answer. */
const PANEL_FRAMING = [
  'You are one of several experts answering the same question at the same time.',
  'You cannot see the others and they cannot see you.',
  'Answer directly and completely, in your own judgement.',
  'State plainly how confident you are and what evidence would change your mind.',
  'Do not hedge toward a middle position and do not pad — a distinct, well-argued answer is',
  'worth more to the reader than a safe one, because they are about to compare yours against',
  'the others and act on where you differ.',
].join(' ')

/** Name one member for the report. */
export function memberLabel(member) {
  return member.label ?? `${member.provider} / ${member.model}`
}

/**
 * Resolve the standalone panel: who `ccg_crosscheck` asks.
 *
 * An explicit `panel` wins. Otherwise the two tiers stand in, which is the
 * common two-model deployment. Members that would ask the same model the same
 * way are collapsed — a panel of clones is a slower single call.
 *
 * @param config - the validated plugin config.
 * @returns the resolved members, in declaration order.
 * @throws if a member is incomplete or names a role that does not exist.
 */
export function resolvePanel(config = {}) {
  const declared = Array.isArray(config.panel) && config.panel.length > 0
    ? config.panel
    : ['strong', 'worker']
      .map((tier) => {
        const entry = config[tier]
        return entry?.provider && entry?.model
          ? { provider: entry.provider, model: entry.model, label: tier }
          : undefined
      })
      .filter(Boolean)

  const seen = new Set()
  const members = []
  for (const member of declared) {
    const provider = typeof member?.provider === 'string' ? member.provider.trim() : ''
    const model = typeof member?.model === 'string' ? member.model.trim() : ''
    if (provider === '' || model === '') {
      throw new Error('ccg: every panel member needs both a provider and a model')
    }
    if (member.role !== undefined && ROLES[member.role] === undefined) {
      throw new Error(
        `ccg: panel member names unknown role "${member.role}"; valid roles are ${Object.keys(ROLES).join(', ')}`,
      )
    }
    const lens = typeof member.lens === 'string' && member.lens.trim() !== ''
      ? member.lens.trim()
      : undefined

    const key = `${provider}/${model}/${member.role ?? ''}/${lens ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)

    members.push({
      provider,
      model,
      role: member.role,
      lens,
      label: member.label ?? member.role ?? `${provider} / ${model}`,
    })
  }
  return members
}

/**
 * Build one member's prompt: the shared task, the persona it wears, its lens,
 * and the framing that keeps independent answers independent.
 *
 * @param member - a resolved member.
 * @param question - the task every member is given.
 * @param context - optional shared background.
 * @param persona - persona applied to every member, when the panel has one.
 * @returns the child's prompt text.
 */
export function buildMemberPrompt(member, question, context, persona) {
  const parts = []
  const own = member.role !== undefined ? ROLES[member.role]?.persona : undefined
  if (own ?? persona) parts.push(own ?? persona)
  if (member.lens !== undefined) parts.push(`Answer through this lens specifically: ${member.lens}`)
  parts.push(PANEL_FRAMING)
  if (context) parts.push(`Shared context:\n${context}`)
  parts.push(`Task:\n${question}`)
  return parts.join('\n\n')
}

/** Flatten a subagent result's content blocks to text. */
function contentText(blocks) {
  if (!Array.isArray(blocks)) return ''
  return blocks.filter((block) => typeof block?.text === 'string').map((block) => block.text).join('\n')
}

/**
 * Lay the answers out for the reader, and say what to do with them.
 *
 * @param question - the task that was given.
 * @param answers - one entry per member.
 * @returns the model-facing report.
 */
export function formatPanelReport(question, answers) {
  const lines = [`Panel of ${answers.length} on: ${question}`, '']
  for (const answer of answers) {
    // A member with no label of its own is already named by its route; saying
    // it twice reads like two different things.
    const route = `${answer.provider} / ${answer.model}`
    lines.push(`── ${answer.label === route ? route : `${answer.label} (${route})`} ──`)
    lines.push(answer.ok ? answer.answer.trim() : `[no answer: ${answer.error}]`)
    lines.push('')
  }
  const answered = answers.filter((answer) => answer.ok).length
  lines.push(
    answered >= 2
      ? 'These were answered independently. Where they agree you have corroboration, not proof — '
        + 'they may share a blind spot. Where they disagree is the finding: work out which is right '
        + 'from the evidence rather than averaging them, and say which you took and why.'
      : 'Too few answers came back to cross-check. Treat what you have as a single opinion.',
  )
  return lines.join('\n')
}

/**
 * Project the durable payload the browser renders the answers from.
 *
 * The rendered report is one blob of text: the only way back to per-model
 * answers would be to parse the `── label ──` rules, which any answer
 * containing such a line would break. So the answers are carried structurally
 * here instead — the documented purpose of this seam, and the reason it is the
 * one thing that survives into the session log alongside the content.
 *
 * The duplication is deliberate: this costs a second copy of each answer in the
 * log, on a tool the triage convention already treats as expensive and rare.
 *
 * Computed once, when the call settles — never recomputed on replay — so
 * reading the lens off the mounted members is reading the configuration that
 * actually produced these answers. Matched on route rather than position all
 * the same, so a future reordering cannot silently mislabel one.
 *
 * @param value - the canonical tool value.
 * @param members - the resolved members this panel was mounted with.
 * @returns the presentation payload.
 */
export function panelPresentationMeta(value, members = []) {
  const answers = Array.isArray(value?.answers) ? value.answers : []
  return {
    kind: PANEL_META_KIND,
    question: String(value?.question ?? ''),
    answers: answers.map((answer, index) => {
      const member = members[index]
      const lens = member?.provider === answer?.provider && member?.model === answer?.model
        ? member.lens
        : undefined
      return {
        label: String(answer?.label ?? ''),
        provider: String(answer?.provider ?? ''),
        model: String(answer?.model ?? ''),
        ok: answer?.ok === true,
        ...(lens ? { lens } : {}),
        ...(answer?.ok === true
          ? { answer: String(answer.answer ?? '') }
          : { error: String(answer?.error ?? '') }),
      }
    }),
  }
}

/**
 * Register one panel as a model-facing tool.
 *
 * @param ctx - a context carrying `tools`, and `subagents` by the time it runs.
 * @param spec - `{ toolName, description, members, persona?, subagentProvider }`.
 * @returns the disposer removing the tool.
 */
export function registerPanelTool(ctx, spec) {
  return ctx.tools.register(panelToolDefinition({
    ...spec,
    getSubagents: () => ctx.get('subagents'),
  }))
}

/**
 * Build the panel tool's definition.
 *
 * Separate from registration so a test can compile this exact definition —
 * `defineTool` validates the schemas as it builds, and a definition that
 * throws takes the whole tool table down with it, not just this tool.
 *
 * @param spec - `{ toolName, description, members, persona?, subagentProvider?, getSubagents }`.
 * @returns the registry-ready definition.
 */
export function panelToolDefinition(spec) {
  const { toolName, description, members, persona } = spec
  const provider = spec.subagentProvider ?? 'spawn'
  const getSubagents = spec.getSubagents ?? (() => undefined)
  // Members answer a question; they do not run the plugin. Without this a panel
  // member could open a panel of its own inside the depth cap.
  const toolFilter = spec.toolFilter

  return defineTool({
    name: toolName,
    description,
    // Named exactly like the official delegation tool's parameters, so every
    // ccg_* tool takes the same arguments whether the role holds one model or
    // five — the model should not have to know which shape it is calling.
    parameters: {
      description: {
        type: 'string',
        required: true,
        description: 'A short label for this delegation (3-5 words), shown while it runs.',
      },
      prompt: {
        type: 'string',
        required: true,
        description:
          'The full, self-contained task every member is given. They see none of this '
          + 'conversation: name the files, symbols and constraints, and say what shape of '
          + 'answer you want.',
      },
      context: {
        type: 'string',
        description: 'Optional shared background given to every member verbatim — a diff, an error, a spec.',
      },
    },
    // The value-schema DSL, not raw JSON Schema: an object must state its
    // `additionalProperties` outright, and a required field says so on itself
    // rather than in a `required` list. `defineTool` refuses anything else,
    // which takes the whole tool table down with it.
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          question: { type: 'string', required: true },
          answered: { type: 'number', required: true },
          answers: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                label: { type: 'string', required: true },
                provider: { type: 'string', required: true },
                model: { type: 'string', required: true },
                ok: { type: 'boolean', required: true },
                answer: { type: 'string' },
                error: { type: 'string' },
              },
            },
          },
        },
      },
      render: (args, value) => [{ type: 'text', text: formatPanelReport(value.question, value.answers) }],
      // What the conversation renders the answers side by side from. The
      // canonical value stays execution-local and is never replayed; this is.
      presentationMeta: (args, value) => panelPresentationMeta(value, members),
    },
    async execute(args, exec) {
      const subagents = getSubagents()
      if (subagents === undefined) throw new Error('ccg: the subagents service is not available')
      const parent = exec?.agent
      if (parent === undefined) throw new Error(`ccg: ${toolName} needs an agent session`)

      const question = String(args.prompt ?? '').trim()
      if (question === '') throw new Error('ccg: prompt is required')
      const context = typeof args.context === 'string' ? args.context.trim() : ''

      // Every member is started before any is awaited: a panel costs the
      // slowest answer, not the sum of them.
      const runs = members.map(async (member) => {
        const label = memberLabel(member)
        try {
          const run = await subagents.start(provider, {
            label: `${String(args.description ?? toolName)} · ${label}`,
            prompt: [{ type: 'text', text: buildMemberPrompt(member, question, context, persona) }],
            parent,
            signal: exec?.signal,
            agentOptions: {
              provider: member.provider,
              model: member.model,
              ...(typeof member.maxTokens === 'number' ? { maxTokens: member.maxTokens } : {}),
            },
            ...(toolFilter ? { toolFilter } : {}),
          })
          const result = await run.result
          const answer = contentText(result?.output).trim()
          if (answer === '') {
            // The result seam carries no failure text, so say what the stop
            // reason usually means: a route that lists a model in its catalog
            // but does not actually serve it is the common cause.
            const reason = result?.stopReason ?? 'unknown'
            return {
              ...member,
              label,
              ok: false,
              error: reason === 'error'
                ? `the child ended with an error and produced nothing — check that ${member.provider} really serves ${member.model}`
                : `no output (${reason})`,
            }
          }
          return { ...member, label, ok: true, answer }
        } catch (error) {
          // One member failing is a thinner panel, not a failed call — the
          // reader still gets the answers that did come back.
          return { ...member, label, ok: false, error: String(error?.message ?? error) }
        }
      })

      const settled = await Promise.all(runs)
      const answers = settled.map((entry) => ({
        label: entry.label,
        provider: entry.provider,
        model: entry.model,
        ok: entry.ok,
        ...(entry.ok ? { answer: entry.answer } : { error: entry.error }),
      }))

      return { question, answered: answers.filter((entry) => entry.ok).length, answers }
    },
  })
}

/**
 * Describe a role whose models answer together.
 *
 * @param entry - a resolved role carrying two or more members.
 * @returns the tool description the model reads.
 */
export function describeRolePanel(entry) {
  const roster = entry.members.map(memberLabel).join(', ')
  return `${entry.summary}. Asked of ${entry.members.length} models at once — ${roster} — each `
    + 'answering independently with the same expert instructions, so their answers come back side '
    + 'by side and where they disagree is the finding. Give it a self-contained brief: the children '
    + 'see none of this conversation.'
}

/**
 * Describe the standalone cross-check.
 *
 * @param members - the resolved panel.
 * @returns the tool description the model reads.
 */
export function describeCrosscheck(members) {
  const roster = members.map(memberLabel).join(', ')
  return `Ask ${members.length} models the same question at once and read their answers side by `
    + `side: ${roster}. Use it when being wrong would be expensive and one opinion is not enough — `
    + 'a design call between real alternatives, a diagnosis you cannot reproduce, an estimate you '
    + 'are staking a plan on. Each answers independently and none sees the others, so where they '
    + 'disagree is the finding. Not for questions with one correct answer you could look up, and '
    + 'not for work you can simply do.'
}
