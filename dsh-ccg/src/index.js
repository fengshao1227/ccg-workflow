/**
 * CCG for DeepSeek Harness — the multi-model role matrix as a mounted plugin.
 *
 * CCG's discipline on Claude Code is "different roles, different models": one
 * brain orchestrates and delegates each specialised turn to the model that
 * fits it. Doing that on Claude Code costs an external CLI per backend, a
 * binary bridge, per-vendor logins and a cold-start tax. On dsh the same
 * discipline is configuration: every hop is a provider API request.
 *
 * This plugin does not reimplement delegation. It MOUNTS the official
 * `@deepseek-ai/dsh-tool-subagent` once per CCG role, each instance pinned to
 * that role's model and carrying that role's persona — so background jobs,
 * depth checks, cancellation, rendering and settlement all stay official
 * behaviour, while the role→model matrix and the personas are ours.
 *
 * Configure two tiers once; seven roles resolve from them. With no tiers
 * configured the roles still register — every child then runs on the
 * deployment's default model, and you get the personas alone.
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import Schema from '@deepseek-ai/schemastery'
import { deepEqualJson, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { delegationDepthOf } from '@deepseek-ai/dsh-subagent'
import * as ToolSubagentNamespace from '@deepseek-ai/dsh-tool-subagent'
import * as SkillFilesystemNamespace from '@deepseek-ai/dsh-skill-filesystem'
import { registerConfigRoute, registerTeamRoute } from './api.js'
import { renderTriagePrompt } from './modes.js'
import {
  CROSSCHECK_TOOL,
  describeCrosscheck,
  describeRolePanel,
  registerPanelTool,
  resolvePanel,
} from './crosscheck.js'
import { TEAM_TOOL, registerTeamTool, renderTeamPrompt } from './team.js'
import { ROSTER_TOOL, openTeamMemory, registerRosterTool } from './memory.js'
import {
  REMEMBER_TOOL,
  registerRememberTool,
  renderMemoryPrompt,
  workspaceOf,
} from './knowledge.js'
import { ROLES, ROLE_NAMES, TIERS, resolveRoles } from './roles.js'

export { resolveRoles }

export const name = 'ccg'

export const inject = ['tools']

// An ES module namespace is frozen; copy it into a plain object so the loader
// can treat it as an ordinary plugin record.
const ToolSubagent = { ...ToolSubagentNamespace }
const SkillFilesystem = { ...SkillFilesystemNamespace }

/** The skill root shipped inside this package. */
export const BUNDLED_SKILL_DIR = fileURLToPath(new URL('../skills/', import.meta.url))

/** User-settings namespace: the `ccg:` section of the harness settings document. */
export const SETTINGS_NAMESPACE = 'ccg'

const TierSchema = Schema.object({
  provider: Schema.string().description(
    'Provider route name as declared under `llm-pi-ai.providers` in $DSH_HOME/settings.yaml.',
  ),
  model: Schema.string().description('Model id served by that route.'),
  maxTokens: Schema.number()
    .step(1)
    .min(1)
    .description('Optional per-request output cap for children on this tier.'),
})

const RoleSchema = Schema.object({
  enabled: Schema.boolean()
    .default(true)
    .description('Set false to leave this role unregistered.'),
  tier: Schema.union(TIERS).description(
    'Which tier this role draws its model from; overrides the role default.',
  ),
  provider: Schema.string().description('Pin a provider for this role alone, ignoring its tier.'),
  model: Schema.string().description('Pin a model for this role alone, ignoring its tier.'),
  models: Schema.array(Schema.object({
    provider: Schema.string().description('Provider route this member answers on.'),
    model: Schema.string().description('Model id this member answers on.'),
    maxTokens: Schema.number().step(1).min(1).description('Output cap for this member.'),
  }))
    .description(
      'Every model this role runs — as many as you like. One is a plain delegation; two or more '
      + 'make the role a panel that gives them all the same brief and returns the answers side by '
      + 'side. Wins over the single provider/model pin and over the tier.',
    ),
  maxTokens: Schema.number().step(1).min(1).description('Per-request output cap for this role.'),
  toolName: Schema.string().description('Rename this role\'s delegation tool.'),
  context: Schema.union(['brief', 'inherit'])
    .description(
      'What the child starts from. `brief` (default) gives it only the brief you write, so it '
      + 'answers independently. `inherit` seeds it with the conversation so far through the '
      + 'fork provider — right for a role continuing your work, wrong for a panel, because a '
      + 'child that has read your reasoning is no longer a second opinion.',
    ),
  backgroundMode: Schema.union(['one-shot', 'continuable'])
    .description(
      'Override the deployment lifecycle for this role. `continuable` keeps the child alive as '
      + 'a teammate you can `send_message` to instead of a one-shot answer.',
    ),
})

/** Plugin config: two model tiers, optional per-role overrides, delegation policy. */
export const Config = Schema.object({
  strong: TierSchema.description(
    'Reasoning tier — analysis, design, debugging and review default here.',
  ),
  worker: TierSchema.description(
    'Fast tier — implementation, optimisation and tests default here.',
  ),
  roles: Schema.dict(RoleSchema).description(
    'Per-role overrides keyed by role name (analyzer, architect, builder, debugger, '
    + 'optimizer, reviewer, tester). An unknown key is refused rather than ignored.',
  ),
  subagentProvider: Schema.string()
    .default('spawn')
    .description(
      'The `ctx.subagents` provider every role delegates through. `spawn` runs children '
      + 'in-process, which is what supports per-child personas.',
    ),
  maxDepth: Schema.union([Schema.number().step(1).min(0), Schema.const('provider-managed')])
    .default(2)
    .description('Delegation depth cap for role children; 0 forbids them delegating further.'),
  backgroundMode: Schema.union(['one-shot', 'continuable'])
    .default('one-shot')
    .description(
      'Child lifecycle. `one-shot` answers in the foreground by default, which is what an '
      + 'orchestrating turn usually wants.',
    ),
  panel: Schema.array(Schema.object({
    provider: Schema.string().description('Provider route this member answers on.'),
    model: Schema.string().description('Model id this member answers on.'),
    role: Schema.union(ROLE_NAMES).description('Optional CCG persona this member wears.'),
    lens: Schema.string().description('Optional perspective this member is told to answer through.'),
    label: Schema.string().description('Name shown for this member in the report.'),
  }))
    .default([])
    .description(
      'Who `ccg_crosscheck` asks. Empty means the two tiers stand in — set this to put three '
      + 'models, or one model wearing two lenses, on the same question.',
    ),
  crosscheck: Schema.boolean()
    .default(true)
    .description(
      'Register `ccg_crosscheck`: ask every panel member the same question at once and read the '
      + 'answers side by side. Needs at least two distinct members.',
    ),
  team: Schema.boolean()
    .default(true)
    .description(
      'Register `ccg_team`: hire a role as a live teammate that keeps working across turns, '
      + 'takes more work through `send_message`, and reports back on its own. Needs a subagent '
      + 'provider that can keep children alive.',
    ),
  teamTool: Schema.string()
    .default(TEAM_TOOL)
    .description('Rename the hiring tool.'),
  confirmHires: Schema.boolean()
    .default(true)
    .description(
      'Ask before each teammate is started, through the harness\'s own user-questions seam: '
      + 'which role, on which model, holding which files. Hiring is the one act here that keeps '
      + 'running after the turn ends and takes files away from everyone else, so it is confirmed '
      + 'rather than announced. Set false where nobody is watching; a deployment with no '
      + 'question provider (headless) skips it on its own.',
    ),
  memory: Schema.boolean()
    .default(true)
    .description(
      'Remember who owns which files, durably, through the harness storage domain — so a hire '
      + 'that would collide with a teammate is refused, and the ownership map outlives a '
      + 'compaction. Registers `ccg_roster`.',
    ),
  knowledge: Schema.boolean()
    .default(true)
    .description(
      'Register `ccg_remember` and load the workspace\'s `.ccg/memory.md` into the coordinator\'s '
      + 'prompt: the decisions, contracts and conventions earlier sessions settled.',
    ),
  knowledgeMaxBytes: Schema.number()
    .step(1)
    .min(256)
    .default(8192)
    .description('Byte cap on the project memory loaded into the prompt; over it, the newest notes win.'),
  isolateChildren: Schema.boolean()
    .default(true)
    .description(
      'Remove this plugin\'s own tools from every child it starts, so a delegated child cannot '
      + 'hire a team or open a panel the user never approved. Needs a subagent provider with the '
      + '`toolFilter` capability (`spawn`, the default, has it); set false for one that does not.',
    ),
  triage: Schema.boolean()
    .default(true)
    .description(
      'Publish the triage convention: read what the user asked for, pick how much machinery '
      + 'it deserves, say what that costs, and wait for a yes before spending it.',
    ),
  routingPrompt: Schema.boolean()
    .default(true)
    .description(
      'Add the CCG routing convention to the system prompt: what each role tool is for, '
      + 'which model it runs on, and what the main model keeps for itself.',
    ),
  skills: Schema.boolean()
    .default(true)
    .description(
      'Publish the skills bundled with this package: the CCG workflow playbook and the '
      + 'verify-* / gen-docs quality gates.',
    ),
  skillDirs: Schema.array(Schema.string())
    .default([])
    .description(
      'Extra skill roots to publish alongside the bundled ones — an absolute path to a '
      + 'directory of `<name>/SKILL.md` bundles, such as your own CCG skills checkout.',
    ),
})

/**
 * Resolve the skill roots this plugin publishes: the bundled one unless it is
 * switched off, then any extra roots a deployment adds.
 *
 * @param config - the validated plugin config.
 * @param deps - injection seam for tests.
 * @returns absolute skill-root paths, in precedence order.
 */
export function resolveSkillDirs(config = {}, deps = {}) {
  const bundledDir = deps.bundledDir ?? BUNDLED_SKILL_DIR
  const exists = deps.exists ?? existsSync

  const dirs = []
  // A consumer importing only `src/` has no bundle beside it; publishing a root
  // that is not there would fail the provider instead of simply adding nothing.
  if (config.skills !== false && exists(bundledDir)) dirs.push(bundledDir)
  for (const dir of config.skillDirs ?? []) {
    if (typeof dir === 'string' && dir.trim() !== '') dirs.push(dir)
  }
  return dirs
}

/**
 * Render the routing convention shown to the main model. Generated from the
 * resolved matrix, so it can never advertise a model a role is not actually
 * pinned to.
 *
 * @param resolved - output of {@link resolveRoles}.
 * @returns the system-prompt section text.
 */
export function renderRoutingPrompt(resolved, panel = []) {
  // Nothing here may describe a capability this deployment does not have. With
  // no tiers set every role lands on one model, so promising "several models at
  // once" would advertise a tool that is not registered and a split that is not
  // happening — the same lie the per-role model names are generated to avoid.
  const anyPanel = panel.length >= 2 || resolved.some((entry) => entry.members.length >= 2)
  const routed = resolved.some((entry) => entry.members.length > 0)

  const lines = [
    anyPanel
      ? 'CCG delegation — specialised work goes to the role whose model and instructions fit it,'
        + '\nand a question worth being right about goes to several models at once.'
      : 'CCG delegation — specialised work goes to the role whose instructions fit it.',
    '',
    'Role tools (one child, the model that suits that work):',
  ]
  for (const entry of resolved) {
    const route = entry.members.length === 0
      ? 'deployment default model'
      : entry.members.length === 1
        ? `${entry.members[0].provider} / ${entry.members[0].model}`
        : `${entry.members.length} models at once: `
          + entry.members.map((member) => `${member.provider} / ${member.model}`).join(', ')
    const notes = []
    if (entry.context === 'inherit') notes.push('starts from this conversation')
    if (entry.backgroundMode === 'continuable') notes.push('stays alive; send_message it more work')
    lines.push(
      `- \`${entry.toolName}\` (${entry.role}, ${route}${notes.length > 0 ? `, ${notes.join(', ')}` : ''})`
      + ` — ${entry.summary}`,
    )
  }
  if (panel.length >= 2) {
    const roster = panel.map((member) => `${member.label} (${member.provider} / ${member.model})`)
    lines.push(
      '',
      'Cross-check (the same question to every member at once, answered independently):',
      `- \`${CROSSCHECK_TOOL}\` — ${roster.join(', ')}.`,
      '  Reach for it when being wrong would be expensive: a design call between real alternatives,',
      '  a diagnosis you cannot reproduce, a review of what you are about to ship.',
      '  Agreement is corroboration, not proof — they can share a blind spot. Disagreement is the',
      '  finding: work out which is right from the evidence instead of averaging them.',
    )
  }
  // The one signal that reaches a user who never opens the settings card: with
  // no tier configured this plugin is running at a fraction of itself — the
  // personas without the routing that makes them worth a round trip. It costs
  // one line and it disappears the moment a tier is set.
  if (!routed) {
    lines.push(
      '',
      'NOTE: no model routing is configured, so every role above runs on this deployment\'s',
      'default model. You have the expert instructions but not the point of them — a second',
      'opinion from the same model is not a second opinion. Say this once, the first time you',
      'delegate, and point the user at Settings › Plugins › CCG to set the two tiers.',
    )
  }

  lines.push(
    '',
    'How to use them:',
    '- Delegate the specialised turn, not the whole job: give the role a self-contained brief.',
    '  A child sees none of this conversation.',
    '- A child returns findings; you decide. Design decisions, trade-off calls and the final',
    '  acceptance stay with you — never delegate the verdict.',
    '- Independent delegations can run together; wait only when your next step needs the result.',
    '- Handle small, obvious work yourself. Delegation is for depth, not for avoiding effort.',
  )
  return lines.join('\n')
}

/**
 * Give a prompt section only to the agent orchestrating the conversation.
 *
 * A `systemPrompt` registration is global: every agent assembled in this
 * deployment reads it, INCLUDING the children this plugin starts. That is wrong
 * three times over for CCG's conventions — a teammate paid for two thousand
 * tokens telling it how to triage a request it was never given, announced a
 * mode nobody asked it for, and was invited to hire a team of its own, which at
 * the default depth cap it can actually do. The user approved a headcount, not
 * a tree.
 *
 * `delegationDepthOf` is zero for a top-level agent and parent+1 for a child,
 * and an empty section contributes nothing. Where the depth cannot be read the
 * section is kept: losing the convention outright is a worse failure than a
 * child reading it.
 *
 * @param text - the section body, or a provider resolving it per assembly (for
 * a section whose content depends on which workspace is being assembled).
 * @returns a text provider that yields '' inside a delegated child.
 */
export function coordinatorOnly(text) {
  const resolve = typeof text === 'function' ? text : () => text
  return (assembly) => {
    const agent = assembly?.agent
    if (agent === undefined) return resolve(assembly)
    try {
      return delegationDepthOf(agent) > 0 ? '' : resolve(assembly)
    } catch {
      return resolve(assembly)
    }
  }
}

/**
 * Mount one official delegation tool per enabled role, then publish the
 * routing convention.
 *
 * @param ctx - plugin context.
 * @param config - validated {@link Config}.
 */
/**
 * Mount everything one config asks for — the role tools, the skill root and the
 * routing convention — under a single child fiber, so a settings change can
 * retire the whole matrix in one call before the next one registers. Tool names
 * must be unique among loaded instances, which is why a reload disposes first.
 *
 * @param ctx - plugin context.
 * @param config - the config to realise.
 * @returns the fiber owning this generation of the matrix.
 */
function mountMatrix(ctx, config, deps = {}) {
  const getTable = deps.getTable ?? (() => undefined)
  return ctx.plugin({
    name: 'ccg-matrix',
    inject: ['tools'],
    apply(inner) {
      const resolved = resolveRoles(config)

      // Decided before anything mounts, because the child tool filter has to
      // name exactly the tools this generation registers — an unknown name in
      // a filter fails the child's startup, not just that entry.
      const teamTool = config.teamTool ?? TEAM_TOOL
      const team = config.team !== false && resolved.length > 0
      const remembersOwnership = config.memory !== false
      const panel = config.crosscheck === false ? [] : resolvePanel(config)
      const crosscheck = panel.length >= 2

      const ownTools = [
        ...resolved.map((entry) => entry.toolName),
        ...(crosscheck ? [CROSSCHECK_TOOL] : []),
        ...(team ? [teamTool] : []),
        ...(team && remembersOwnership ? [ROSTER_TOOL] : []),
        ...(config.knowledge !== false ? [REMEMBER_TOOL] : []),
      ]
      // Suppressing the conventions in a child removed the invitation but not
      // the capability: a teammate could still call the hiring tool and start a
      // team nobody approved, inside the depth cap. These are the coordinator's
      // instruments. A child that genuinely needs help still has the harness's
      // own `subagent`, which runs on the deployment default and springs no
      // per-model surprise.
      const childTools = config.isolateChildren === false || ownTools.length === 0
        ? undefined
        : { deny: ownTools }

      for (const entry of resolved) {
        // A role holding two or more models becomes a panel: they all answer
        // the same brief, wearing the same persona, and the answers come back
        // side by side. One model is a plain delegation, which the official
        // tool already does better than anything written here would.
        if (entry.members.length >= 2) {
          inner.effect(
            () => registerPanelTool(inner, {
              toolName: entry.toolName,
              description: describeRolePanel(entry),
              members: entry.members,
              persona: entry.persona,
              subagentProvider: config.subagentProvider ?? 'spawn',
              ...(childTools ? { toolFilter: childTools } : {}),
            }),
            `ccg: ${entry.role} panel`,
          )
          continue
        }
        inner.plugin(ToolSubagent, {
          // `fork` seeds the child with the parent's completed turns; `spawn`
          // starts it clean. Both run in-process, so persona and tool scoping
          // behave identically — the session seed is the only difference.
          provider: entry.context === 'inherit' ? 'fork' : (config.subagentProvider ?? 'spawn'),
          toolName: entry.toolName,
          persona: entry.persona,
          maxDepth: config.maxDepth ?? 2,
          backgroundMode: entry.backgroundMode ?? config.backgroundMode ?? 'one-shot',
          ...(entry.agentOptions ? { agentOptions: entry.agentOptions } : {}),
          ...(childTools ? { toolFilter: childTools } : {}),
        })
      }

      // Skills ride on the official filesystem provider under a name of our own,
      // so the deployment's existing skill roots keep their provider and ranks.
      const skillDirs = resolveSkillDirs(config)
      if (skillDirs.length > 0) {
        inner.plugin(SkillFilesystem, {
          providerName: 'ccg',
          includeDefaultRoots: false,
          customSkillDirs: skillDirs,
        })
      }

      // Teams: the same roles, hired as colleagues that stay alive instead of
      // answering once. One tool for every role — seven more delegation tools
      // would double the table and make every call a two-step choice.
      if (team) {
        inner.effect(
          () => registerTeamTool(inner, {
            resolved,
            toolName: teamTool,
            subagentProvider: config.subagentProvider ?? 'spawn',
            confirm: config.confirmHires !== false,
            ...(typeof config.maxDepth === 'number' ? { maxDepth: config.maxDepth } : {}),
            ...(remembersOwnership ? { getTable } : {}),
            ...(childTools ? { toolFilter: childTools } : {}),
          }),
          'ccg: team hiring tool',
        )
        // The roster is only worth a tool where something durable backs it;
        // without the storage form it would answer "nothing recorded" forever.
        if (remembersOwnership) {
          inner.effect(
            () => registerRosterTool(inner, { getTable }),
            'ccg: roster tool',
          )
        }
      }

      // Project memory is independent of teams — a solo session accumulates
      // decisions worth carrying just as much as a team does.
      if (config.knowledge !== false) {
        inner.effect(() => registerRememberTool(inner), 'ccg: remember tool')
      }

      // The other half of CCG: the same question to several models at once.
      // A panel needs two distinct members — one model cross-checking itself
      // is a slower single call, so the tool simply does not appear.
      if (crosscheck) {
        inner.effect(
          () => registerPanelTool(inner, {
            toolName: CROSSCHECK_TOOL,
            description: describeCrosscheck(panel),
            members: panel,
            subagentProvider: config.subagentProvider ?? 'spawn',
            ...(childTools ? { toolFilter: childTools } : {}),
          }),
          'ccg: crosscheck tool',
        )
      }

      // Optional service: read it lazily — at boot-time apply it may not be
      // registered yet, and a deployment may not carry one at all.
      const systemPrompt = inner.get('systemPrompt')
      if (systemPrompt === undefined) return

      const routing = config.routingPrompt !== false && resolved.length > 0
      if (routing) {
        const text = renderRoutingPrompt(resolved, panel)
        inner.effect(
          () => systemPrompt.context({
            name: 'ccg:routing',
            order: 92,
            text: coordinatorOnly(text),
          }),
          'ccg: routing convention',
        )

        // The team convention sits just below routing: it is the same roles,
        // used a different way, and only worth reading once you know they exist.
        if (team) {
          const teamText = renderTeamPrompt(resolved, teamTool)
          if (teamText !== '') {
            inner.effect(
              () => systemPrompt.context({
                name: 'ccg:team',
                order: 93,
                text: coordinatorOnly(teamText),
              }),
              'ccg: team convention',
            )
          }
        }
      }

      // What earlier sessions settled, read per assembly from the workspace of
      // the agent being assembled — one deployment serves many workspaces, so
      // this cannot be resolved once at mount. Coordinator-only for the usual
      // reason, and because a child was given its brief on purpose.
      if (config.knowledge !== false) {
        const cap = config.knowledgeMaxBytes ?? 8192
        inner.effect(
          () => systemPrompt.context({
            name: 'ccg:memory',
            order: 90,
            text: coordinatorOnly((assembly) => {
              const workspace = workspaceOf(assembly?.agent)
              return workspace === undefined ? '' : renderMemoryPrompt(workspace, cap)
            }),
          }),
          'ccg: project memory',
        )
      }

      // Triage sits above routing: which gear to use comes before which tool.
      // It describes the role tools, so it goes only where they were described.
      if (config.triage === false || !routing) return
      const triage = renderTriagePrompt(resolved, { team, teamTool })
      if (triage === '') return
      inner.effect(
        () => systemPrompt.context({
          name: 'ccg:triage',
          order: 91,
          text: coordinatorOnly(triage),
        }),
        'ccg: triage convention',
      )
    },
  })
}

/**
 * Realise the matrix, then expose the same shape as a user-settings namespace
 * so it can be edited from the harness settings document — and from the
 * configuration surfaces reading it — instead of only the profile patch. The
 * profile patch stays the composition `base`, the user layer sits above it, and
 * a change re-applies live without a restart.
 *
 * @param ctx - plugin context.
 * @param config - validated {@link Config} from the loader.
 */
export function apply(ctx, config = {}) {
  let active = config

  // Ownership memory is opened ONCE, out here, not inside the matrix fiber: a
  // domain name may be open only once at a time, and the matrix is disposed and
  // rebuilt on every settings change. Reopening on each of those would race its
  // own close. The tools read it through this getter, so a matrix built before
  // the domain finished opening picks it up on its next call rather than
  // capturing `undefined` forever.
  let teammates
  const getTable = () => teammates

  let fiber = mountMatrix(ctx, active, { getTable })

  const reload = async (next) => {
    if (deepEqualJson(next, active)) return
    active = next
    const previous = fiber
    fiber = undefined
    if (previous !== undefined) await previous.dispose()
    fiber = mountMatrix(ctx, next, { getTable })
  }

  // Optional: a deployment without the storage form still hires teammates, it
  // just cannot check or remember who owns what.
  ctx.inject(['storageDomain'], (storeCtx) => {
    storeCtx.effect(() => {
      let domain
      const opening = openTeamMemory(storeCtx).then(
        (handle) => {
          domain = handle
          teammates = handle.table('teammates')
        },
        (error) => {
          storeCtx.logger?.warn?.(`ccg: team memory unavailable — ${error}`)
        },
      )
      return async () => {
        // Wait for an in-flight open before closing, or the handle leaks.
        await opening
        teammates = undefined
        await domain?.close()
      }
    }, 'ccg: team memory')
  })

  // The team strip above the composer. Its own route rather than a section of
  // the card's, because it is per conversation and read while a turn runs,
  // where the card's payload is per deployment and read when a tab is opened.
  // Registered outside the settings seam: it needs neither.
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => registerTeamRoute(webCtx, { getTable, getSubagents: () => webCtx.get('subagents') }),
      'ccg: team strip route',
    )
  })

  // The settings seam is optional and arrives on its own schedule; the matrix
  // above is already serving by the time this resolves.
  ctx.inject(['settings'], (settingsCtx) => {
    const scope = settingsCtx.settings.register(settingsNamespace(SETTINGS_NAMESPACE), Config, {
      base: config,
      applies: 'live',
    })
    settingsCtx.effect(() => scope.watch(reload), 'ccg: settings watch')
    reload(scope.get()).catch((error) => {
      settingsCtx.logger?.warn?.(`ccg: could not apply stored settings — ${error}`)
    })

    // The raw user layer lives on the provider's descriptor, not on the owner
    // scope — the card needs it to mark which tiers the user overrode.
    const snapshot = () => {
      const descriptor = settingsCtx.settings
        .describe()
        .find((entry) => entry.ns === SETTINGS_NAMESPACE)
      return {
        value: descriptor?.value ?? scope.get(),
        user: descriptor?.user,
        writable: true,
      }
    }

    // Serving the card's section is only meaningful where a browser can ask
    // for it; a headless deployment mounts no web server and skips this.
    // What the card's selectors offer: every model the harness can actually
    // route to. Read per request so a provider configured after boot appears
    // without a restart, and tolerant of an adapter that cannot answer.
    const catalog = async () => {
      const llm = settingsCtx.get('llm')
      if (llm?.listConfigurableProviders === undefined) return []
      const providers = llm.listConfigurableProviders()
      const perProvider = await Promise.all(providers.map(async (entry) => {
        try {
          const models = await llm.listModels(entry.provider)
          return models.map((model) => ({
            provider: entry.provider,
            id: model.id,
            name: model.name ?? model.id,
          }))
        } catch {
          return []
        }
      }))
      return perProvider.flat()
    }

    settingsCtx.inject(['webServer'], (webCtx) => {
      webCtx.effect(
        () => registerConfigRoute(webCtx, scope, snapshot, catalog),
        'ccg: card configuration route',
      )
    })
  })
}
