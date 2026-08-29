/**
 * The CCG role matrix.
 *
 * Each entry becomes one delegation tool backed by an official
 * `@deepseek-ai/dsh-tool-subagent` instance: its own tool name, its own model
 * (through the tier it points at), and its own persona — the role prompt CCG
 * uses on Claude Code, distilled to what a child agent needs to act in
 * character without the parent's conversation.
 *
 * `tier` is the DEFAULT bucket, not a hard binding: a deployment repoints any
 * single role, or turns it off, through the plugin config.
 */

/** Model buckets a role can point at. */
export const TIERS = ['strong', 'worker']

export const ROLES = {
  analyzer: {
    tool: 'ccg_analyze',
    tier: 'strong',
    summary: 'read-only technical analysis: trade-offs, options, a ranked recommendation',
    persona: [
      'You are CCG\'s senior systems analyst. READ-ONLY: never write or edit files.',
      'Work the problem in this order: current state and constraints; two or three',
      'candidate approaches with explicit pros, cons and effort; one ranked',
      'recommendation with its rationale; risks with mitigations; concrete next steps.',
      'Judge feasibility and technical debt honestly — say when an option is bad.',
      'Ground every claim in what you actually read; mark anything unverified as such.',
    ].join('\n'),
  },

  architect: {
    tool: 'ccg_design',
    tier: 'strong',
    summary: 'design blueprint: component boundaries, interface contracts, migration path',
    persona: [
      'You are CCG\'s full-stack architect. Design contract-first: settle the interfaces',
      'between layers before the internals, and keep concerns separated.',
      'Weigh the constraints you were given before proposing structure, and trade ideal',
      'architecture against delivery cost out loud.',
      'Deliver: component boundaries, data flow, interface and type contracts, a migration',
      'path, and the one or two decisions that dominate the design — defended against the',
      'alternatives you rejected. Illustrate with code only where a contract needs it.',
    ].join('\n'),
  },

  builder: {
    tool: 'ccg_build',
    tier: 'worker',
    summary: 'implement an agreed plan: complete, runnable code plus its verification command',
    persona: [
      'You are CCG\'s implementation engineer. Turn an agreed plan into complete, runnable',
      'code — never a sketch, never a placeholder, never a "implement here" stub.',
      'Read the surrounding code first and match its style, naming and error handling.',
      'Cover edge cases; respect concurrency, transactions and indexes where they apply.',
      'Stay inside the files you were asked to change; do not invent APIs or add',
      'unrequested features. Finish with the exact command that verifies your work.',
    ].join('\n'),
  },

  debugger: {
    tool: 'ccg_debug',
    tier: 'strong',
    summary: 'root-cause diagnosis: evidence, ranked hypotheses, the fix direction',
    persona: [
      'You are CCG\'s debugger. Find the root cause, not the symptom, and do not patch',
      'code — diagnosis only.',
      'Method: reproduce (steps, environment, intermittent or consistent); isolate (which',
      'component, when it started, what changed); analyse (read the stack trace and trace',
      'the data flow — check null, async, state, cache); then rank hypotheses.',
      'Report: symptoms, evidence, ranked hypotheses each with a confidence and a minimal',
      'test that would confirm it, the root cause, and the recommended fix direction.',
      'If the evidence does not identify a cause, say so instead of guessing.',
    ].join('\n'),
  },

  optimizer: {
    tool: 'ccg_optimize',
    tier: 'worker',
    summary: 'performance work: measure, locate the bottleneck, targeted fix',
    persona: [
      'You are CCG\'s performance engineer. Measure before optimising; never optimise on',
      'a hunch.',
      'Look for end-to-end latency, cross-layer bottlenecks (N+1 queries, over-fetching,',
      'redundant renders, cache coherency) and resource efficiency (bundle size, memory,',
      'connection pooling).',
      'Method: baseline, locate the dominant cost, find its root cause, apply a targeted',
      'fix, state how to verify the gain. Report current numbers, the bottleneck with its',
      'share of total, and prioritised changes with expected impact. Say plainly when a',
      'change is not worth its complexity.',
    ].join('\n'),
  },

  reviewer: {
    tool: 'ccg_review',
    tier: 'strong',
    summary: 'graded code review: Critical / Warning / Info findings with file:line anchors',
    persona: [
      'You are CCG\'s code reviewer. READ-ONLY: comment, do not rewrite.',
      'Review for correctness (logic, edge cases, types, error handling, races),',
      'maintainability (naming, responsibilities, duplication, test gaps), cross-cutting',
      'concerns (logging, error messages, configuration over hardcoding) and integration',
      '(contract consistency, breaking changes, backwards compatibility).',
      'Anchor every finding to file:line, state why it is wrong and what to do instead,',
      'and grade it Critical / Warning / Info. Close with a verdict: PASS or',
      'NEEDS_IMPROVEMENT.',
      'Findings first. When the change is clean, write "no findings" — never invent an',
      'issue to look thorough.',
    ].join('\n'),
  },

  tester: {
    tool: 'ccg_test',
    tier: 'worker',
    summary: 'tests: integration and contract coverage, edge cases',
    persona: [
      'You are CCG\'s test engineer. Write tests, not implementation.',
      'Favour integration and contract tests: API endpoints, component integration,',
      'database interaction, mocked external services, request/response validation, type',
      'and schema boundaries.',
      'Cover the edges: boundary values, error paths, empty/null/undefined, concurrency.',
      'Match the project\'s existing test framework and conventions — detect them, do not',
      'assume. Deliver the test code plus a short note on what is and is not covered.',
    ].join('\n'),
  },
}

/** Stable role order for prompts and registration. */
export const ROLE_NAMES = Object.keys(ROLES)

/**
 * Resolve the role matrix from config. Pure — no context, no side effects — so
 * the mapping that decides which model serves which role is unit-testable
 * without booting a harness.
 *
 * @param config - the validated plugin config (may be empty).
 * @returns one entry per enabled role, in declaration order.
 * @throws if `roles` names a role that does not exist, or a role points at a
 * tier that does not exist. Both are typos that would otherwise silently
 * downgrade a child to the default model.
 */
export function resolveRoles(config = {}) {
  const overrides = config.roles ?? {}

  for (const key of Object.keys(overrides)) {
    if (!ROLE_NAMES.includes(key)) {
      throw new Error(
        `ccg: unknown role "${key}" in config.roles; valid roles are ${ROLE_NAMES.join(', ')}`,
      )
    }
  }

  const resolved = []
  for (const roleName of ROLE_NAMES) {
    const role = ROLES[roleName]
    const override = overrides[roleName] ?? {}
    if (override.enabled === false) continue

    const tierName = override.tier ?? role.tier
    if (!TIERS.includes(tierName)) {
      throw new Error(
        `ccg: role "${roleName}" points at unknown tier "${tierName}"; valid tiers are ${TIERS.join(', ')}`,
      )
    }
    const tier = config[tierName] ?? {}
    const maxTokens = override.maxTokens ?? tier.maxTokens

    // A role may name any number of models. The list wins over a single pin,
    // which wins over the tier; nothing at all leaves the child on the
    // deployment default. Half a route is not a route — the child schema needs
    // both halves — so an incomplete pair is dropped rather than mounted as a
    // model it cannot reach.
    const declared = Array.isArray(override.models) && override.models.length > 0
      ? override.models
      : [{
        provider: override.provider ?? tier.provider,
        model: override.model ?? tier.model,
      }]

    const seen = new Set()
    const members = []
    for (const entry of declared) {
      const provider = typeof entry?.provider === 'string' ? entry.provider.trim() : ''
      const model = typeof entry?.model === 'string' ? entry.model.trim() : ''
      if (provider === '' || model === '') continue
      const key = `${provider}/${model}`
      // Two identical members would ask one model the same question twice.
      if (seen.has(key)) continue
      seen.add(key)
      members.push({
        provider,
        model,
        ...(typeof entry.maxTokens === 'number'
          ? { maxTokens: entry.maxTokens }
          : typeof maxTokens === 'number' ? { maxTokens } : {}),
      })
    }

    // Inheriting the conversation and answering independently are opposite
    // things. A panel whose members have read your reasoning is not a panel,
    // so this combination is refused rather than silently producing echoes.
    const context = override.context ?? 'brief'
    if (context === 'inherit' && members.length >= 2) {
      throw new Error(
        `ccg: role "${roleName}" holds ${members.length} models AND inherits the conversation; `
        + 'a panel is only worth running when its members answer independently — drop to one '
        + 'model, or set context: brief',
      )
    }

    resolved.push({
      role: roleName,
      toolName: override.toolName ?? role.tool,
      context,
      backgroundMode: override.backgroundMode,
      tier: tierName,
      summary: role.summary,
      persona: role.persona,
      members,
      // What a single-model role hands the official delegation tool; a role
      // running a panel has no one route and leaves this undefined.
      agentOptions: members.length === 1 ? members[0] : undefined,
    })
  }
  return resolved
}
