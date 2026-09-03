# dsh-ccg

CCG's multi-model role matrix as a DeepSeek Harness plugin.

**Lives in the `ccg-workflow` repo and ships inside its npm package.** One repo,
one package, one version number: `dsh-ccg/` is on `ccg-workflow`'s `files` list,
and `ccg dsh install` copies it to `~/.dsh/ccg/dsh-ccg` and wires it into a
harness profile. Publishing it standalone is a decision that was deliberately
left one line away — `.github/workflows/publish-dsh-ccg.yml` is complete and
reduced to manual dispatch; see the repo's CLAUDE.md for how to flip it back.

The install path is `src/utils/installer-dsh.ts` in the parent package, not
here. Two things it gets right that are easy to get wrong: the plugin must be
COPIED (a profile pointing at an npx cache directory breaks on the next run),
and a profile needs BOTH a dependency and a `dsh.profile.bundles` entry — `pnpm
add` writes only the first.

**Version**: 0.4.7 · **Tests**: 116 · **Runtime deps**: none · **Build step**: none

---

## What it is

Seven role tools (`ccg_analyze` / `ccg_design` / `ccg_build` / `ccg_debug` /
`ccg_optimize` / `ccg_review` / `ccg_test`), plus `ccg_crosscheck` and
`ccg_team`. Each role delegates to the model(s) you give it, carrying that
role's expert persona. Every hop is a provider API request — no external CLI,
which is the whole reason this form is cleaner than CCG on Claude Code.

Three shapes of CCG, all present:

- **Routing** — different roles, different models.
- **Cross-validation** — a role holding two or more models becomes a *panel*:
  they all get the same brief, answer independently, and come back side by
  side. Nothing votes; nothing is averaged. Disagreement is the finding.
- **Teams** — `ccg_team` hires a role as a colleague that stays alive across
  turns, takes more work through `send_message`, and reports back on its own.

Plus a **triage** convention: the user just talks, the agent picks Direct /
Standard / Deep / Team, quotes the real cost, and waits for a yes past Direct.

## Layout

```
src/index.js       plugin body: Config, mounting, settings namespace, hot reload
src/roles.js       the 7 personas + resolveRoles() (which model serves which role)
src/crosscheck.js  panels: prompt building, the report, panelToolDefinition()
src/team.js        hiring: the teammate persona, ownership, teamToolDefinition()
src/memory.js      durable ownership: the storage domain, collision refusal, ccg_roster
src/knowledge.js   project memory: ccg_remember, .ccg/memory.md, its injection
src/modes.js       triage: the four modes, costed from the real matrix
src/api.js         /api/ccg/config (card) + /api/ccg/team (the strip) data seams
src/client.js      browser half: settings card + panel view + team strip (hand-written, no build;
                   borrows dsh-client-ui-primitives when the shell lends it, falls back when not)
skills/            ccg-workflow playbook + the 5 CCG quality gates + gen-docs
test/              116 unit tests over the pure functions, the tool definitions, and the slots
```

## Two kinds of memory, deliberately different media

- **Ownership → `ctx.storageDomain`** (`~/.dsh/storages/ccg_team.json`). Structured,
  queried, machine-owned; nobody needs to read it by hand. Scoped per coordinator
  session, because `send_message` authority is per-lineage — one conversation
  genuinely cannot direct another's teammates. Claims held by a *different*
  session in the same workspace surface as a warning and never a refusal: that
  session may be long gone, and a guard this one cannot lift is a deadlock.
- **Decisions → `.ccg/memory.md` in the workspace.** Markdown, because a decision
  is something a human should read, review in a diff, and delete when it stops
  being true. dsh's own `AGENTS.md` loader would carry this, but it ships
  **disabled** in the default profiles, so relying on it would mean shipping a
  feature that silently does nothing.

## Architecture decisions worth keeping

- **Compose, don't reimplement.** Single-model roles mount the official
  `@deepseek-ai/dsh-tool-subagent`; background jobs, depth caps, cancellation
  and rendering stay official behaviour. Only the two things that tool cannot
  express get their own: a panel (several members, one brief, in parallel) and
  hiring (one call must reach *any* role, not one instance per role — seven more
  delegation tools would double the table and make every call a two-step
  choice).
- **The prompts are generated from the resolved matrix.** The routing, team and
  triage sections cannot advertise a model a role is not pinned to, or a cost
  that is not what will be billed.
- **Conventions go to the coordinator only.** `systemPrompt` registrations are
  global, so without `coordinatorOnly()` every child would pay for a triage
  convention it was never given a choice about — and be invited to hire a team
  of its own inside the depth cap. `delegationDepthOf(agent) > 0` is the test;
  it fails *open* (keeps the text) because losing the convention is worse than
  a child reading it.
- **A panel may not inherit.** Members that read your reasoning are echoes; the
  combination is refused at mount.
- **A teammate always starts from its brief.** Hiring goes through `spawn`, not
  `fork`, even for a role configured `context: inherit` — which follows the
  harness's own reasoning for keeping fork children one-shot.
- **Buildless client.** `src/client.js` is a plain
  `window.__ModuleLoader__.load({id, factory})` module using
  `React.createElement`. What ships is what you can read.

## Harness facts this depends on (verified, not assumed)

- `defineTool`'s schemas use the **value-schema DSL, not raw JSON Schema**: an
  object must state `additionalProperties` outright and `required` goes on each
  property. A definition that throws takes the **whole tool table** down, not
  just that tool — hence `panelToolDefinition()` and `teamToolDefinition()` are
  exported and compiled in tests.
- A tool's `enum` is enforced by the framework **before** `execute` runs, and
  its error names the valid values. That is a better message than anything
  thrown inside, so the in-`execute` guard is only for direct calls.
- Whether third-party settings namespaces reach the browser **depends on the
  harness generation**, so this plugin serves its own route either way. Through
  `0.1.0-rc.x`, `dsh-host-apiproxy` built an allowlist from constants plus
  configurable model providers and refused everything else
  (`settings-not-exposed`). From `0.1.1-rc.x` the describe handler is just
  `settings.describe({redactSecrets: true})` — every registered namespace,
  unfiltered. Writes are refused off-loopback in both.
- The Plugins tab renders **only hand-written cards** from plugins shipping a
  browser half (`exports["./client"]` + `dsh.client` in package.json). It never
  auto-generates a form from a schema.
- `tool.call.toolview` is a **keyed slot dispatched on the wire tool name**, and
  the key domain is open. Registering `key: '<toolName>'` takes over how that
  tool's calls render inside a turn; an unclaimed name falls back to the generic
  row, so registering is additive for your own tool and a takeover for a shipped
  one. The component gets `{callId, toolName, block, cwd, openFile, inspect}`
  plus `t` when the registration names a `locale`. `block` is the running head
  (`{callId, name, argsRaw}`, **no `kind`**) or the settled `ToolResultNode`;
  `'kind' in block` is the only way to tell them apart.
- **`output.presentationMeta(args, value)` is the only channel from a tool to
  the browser.** `block.content` carries only the model-facing rendered text,
  and `presentCall`/`presentResult` emit a **closed** card vocabulary
  (`generic` / `terminal` / `diff` / `search` / `read` / `web`) that arbitrary
  JSON does not fit into. The projector runs **once, when the call settles** —
  never recomputed on replay, because the canonical value is execution-local and
  is not logged — and its result is threaded to the client as
  `ToolResultNode.meta` (`dsh-client-ui-conversation`: `meta: match.event.data.meta`).
  So closing over mounted config inside it is safe, and what it emits survives a
  restart. Verified by restarting the server and reloading the page.
- The theme's CSS custom properties are **`--dsw-alias-*`**, not `--dsh-*`
  (`dsh-client-ui-theme/lib/styles/design-platform.css`, light/dark pairs). The
  card shipped with invented `--dsh-*` names for three versions and had been
  running on its fallbacks the whole time — always check a token exists.
- **Layout variables ARE the `--dsh-` family**, separate from colour:
  `--dsh-composer-card-max-width`, `--dsh-composer-side-clearance`,
  `--dsh-chat-content-width`. The shipped composer card is
  `width: 100%; max-width: var(--dsh-composer-card-max-width); box-sizing: border-box`
  inside a wrapper padded by the clearance — copy that pair to line anything up
  with the composer instead of measuring a number.
- `conversation.input.dock` is a **full-width, session-scoped list slot**. Its
  owner share is `{session: ConversationSnapshot, input: InputState}` and the
  docs say to read those as point-in-time snapshots and **never subscribe**.
  `session.sessionId` is exactly the string a top-level `String(agent.id)`
  yields (`session-<uuid>`), which is what `hiredBy` stores — so the browser can
  ask for its own roster by session with no mapping. A child's durable id is a
  bare uuid, no prefix.
- `fork` seeds a child with the parent's **completed** turns; `spawn` starts it
  clean. Both in-process, same persona support. In a single-turn headless run
  fork inherits nothing, because no turn has completed.
- `startContinuable()` resolves at **inbox acceptance**, not at an answer. The
  return value is a durable child id and nothing else.
- The child→parent channel is `report` (from `dsh-tool-subagent-report`),
  installed only for continuable in-process children. The waking delivery mode
  starts a new parent turn — so **ending a turn is how a coordinator waits**;
  sleeping or polling is pure waste. It is the default, which is the only
  reason the rename from `wakeup` to `next-step` in `0.1.1-rc.x` costs this
  plugin nothing: no call site here names a delivery.
- `agent/inbox/spliced` with `inserted` is a **delivery**, not a discard;
  `removedCount` is the removal case. Easy to misread when debugging.
- Commands (`ctx.commands.register`) run host-side and cannot start a model
  turn — they return text. Mode/state plus a prompt section is the native way.
- Agent presets are **compositions** (which plugins an agent starts with);
  this plugin is content. Orthogonal, not competing.

## Verified end to end

- Three vendors answering one brief in parallel (Claude Opus 5 + GPT-5.6-sol +
  Grok-4.5), ~21s.
- A planted-bug review: both reviewers caught every planted defect
  (inflight-never-cleared, insertion-order eviction, `NaN` hit rate,
  invalidate-vs-inflight race) and invented none.
- Triage: a vague request produced mode + phase list + "5 delegations / 8 model
  calls" + a request to confirm; a trivial one was answered directly.
- `context: inherit`: a forked builder answered from a decision made three
  turns earlier that was never in its brief.
- The settings card: edits save to `~/.dsh/settings.yaml` and re-apply live.
- **The panel view** (0.4.4): a three-model `ccg_analyze` call rendered as three
  named columns — the running state naming the models first — then rendered
  identically after `dsh web` was restarted and the page reloaded, which is what
  proves the answers come from the durable presentation seam and not from
  anything live. Expanding lifted the clamp on every column.
- **The hire confirmation** (0.4.5), all three arms. Approve: rendered as the
  harness's plan-review card, the label round-tripped, the child started, worked
  and settled. Decline: **no child, no file, no roster row** — and the model got
  "Not hired" as an ordinary result and stopped instead of retrying. Headless,
  where the gate is on by default and no provider exists: the hire went through
  without hanging and the teammate wrote its file — the fail-open path a unit
  test can assert but only a real run can prove does not deadlock.
- **The team strip** (0.4.5), over a real hire: one teammate → two mid-turn with
  the new one marked live and the summary reading `2 人 · 1 在跑`; back to two
  settled rows as it finished; the file it was given (`add(a, b)`) written and
  owned by nobody else. **Ten seconds after settling the tab had made zero
  `/api/ccg/*` requests** — the claim a polling UI has to earn. A session with
  no team renders nothing, and another conversation's teammate never appears.
- **Teams**, on a job with three independent parsers behind one contract: the
  agent picked Team unprompted, quoted the split and waited for a yes; hired
  three builders with disjoint `owns` and the contract copied into every brief;
  all three wrote working code on the worker-tier model, reported, and settled;
  the reports and settlement notices reached the coordinator, which ran the
  assembled result end to end (5 of 6 sample lines parsed, the sixth correctly
  rejected, nothing thrown on malformed input).
- **`send_message`**, in a second run: one teammate, two assignments, the second
  delivered after the first report landed. Two reports from the same child id;
  both files correct.
- **Ownership**, in 52 seconds: `ccg_remember` wrote a contract, one hire took
  `memtest/src/parse.js` and was recorded in `ccg_team.json`, a second hire for
  `memtest/src` was **refused** naming the holder, and `ccg_roster` listed the
  team. The refusal fired before any child started.
- **Project memory, cold**: a note written in one session was answered correctly
  by a new session in a **restarted process with zero tool calls** — the
  `Project memory` section was in the injected prompt, so the answer came from
  the memory layer rather than a file read.

## Found by running it (fixed in 0.3.2)

Three faults that only a live run surfaces, each now pinned by a test:

- The triage convention **leaked into every child** — a hired teammate opened
  its first turn with "**Mode: Direct**". Fixed with `coordinatorOnly()`.
- With everything delegated, the coordinator **invented a `sleep` loop** and
  asked to escalate the sandbox for it. The prompt now says ending the turn is
  how you wait.
- During integration the coordinator **edited a file it had assigned to a
  live teammate**. One-writer-per-file now binds the coordinator too.

## Known gaps

None currently open. The two that were are closed in 0.4.3 (below); anything
new will be found the same way the rest were — by running it.

## Fixed in 0.4.7 — a slot that changed kind under it (issue #162)

On a current harness the whole browser UI was a `Failed to load plugins /
dsh-ccg` page. The plugin tab had redeclared `settings.plugin.item` from a
`list` (ordered by `id`) to a `keyed` one (dispatched by the settings namespace
the card edits), and `SlotCore.register` **throws** when the option its slot's
kind requires is absent.

- **The blast radius is the reason this is worth a section.** The throw fails
  the entire loader entry, not the registration: the settings card, the panel
  view and the team strip go together, and the app renders nothing but the
  banner. Three surfaces and a whole UI behind one missing property.
- **The fix carries both options**, `key` and `id`. Each kind reads the one it
  requires and ignores the other's, so one registration satisfies either
  declaration — no version sniffing, and nothing to revisit when the older line
  disappears.
- **Why the tab changed at all**: from `0.1.1-rc.x` the Host serves *every*
  settings namespace to the browser instead of an allowlist, so a plugin
  distributed outside the harness repo can finally have its card dispatched —
  keyed by a namespace it registers itself. The card now appears on both
  generations, and on the newer one it appears *because* the key matches.
- **Audited the rest of the seams rather than fixing only what threw**, since
  the first throw hides everything after it. Diffed every package this plugin
  touches between the two generations: `dsh-tool-subagent`, `dsh-storage-domain`,
  `dsh-settings` and `dsh-user-questions` are byte-identical; `tool.call.toolview`
  and `conversation.input.dock` are unchanged; the rest is additive. The two
  narrowings found — `SubagentReportDelivery` `'wakeup'` → `'next-step'` and
  `openFile` returning a promise — touch nothing here, because this plugin names
  no delivery and never calls `openFile`.
- **Verified by reproducing it**, in a separate `DSH_HOME` on dsh `0.1.1-rc.2`:
  the reported error page exactly, then a clean boot with the card rendered
  among the built-in ones and an empty console after the swap.
- `test/client-slots.test.mjs` pins all three registrations, ties the card's key
  to the host half's `SETTINGS_NAMESPACE` (a browser module cannot import it,
  so nothing else connects them), and drives **the real slot runtime** under
  both declarations — including the two assertions that removing either option
  throws.

## Added in 0.4.6 — borrowing the app's own component kit

The three browser surfaces now use `@deepseek-ai/dsh-client-ui-primitives`
where it is available, and their own markup where it is not.

- **It is not a plugin bundle.** No `dsh.client` entry, no `./client` export, and
  **not in `window.__DSH_BOOT__.entries`** — so neither the graph-row branch nor
  a lazy import reaches it. It resolves only through the shell's own static
  registry, which is a property of the deployment, not a contract. Confirmed
  live: the dock's dot renders with the kit's own `_dot_*` class and the
  fallback is unused.
- **Every borrow has a fallback**, because a factory's synchronous `require`
  THROWS on an unresolvable specifier and that throw takes the whole file with
  it — settings card, panel view and team strip in one go. `kit.X ?? ownX`.
- **`MarkdownText` is the borrow that matters.** A model's answer IS markdown,
  and preformatted text showed it with the `##` and `**` intact — worst of all
  in the panel, whose entire job is reading answers against each other.
- Two things the swap broke, both found by looking:
  - the renderer sizes blocks for a full-width message (**16px paragraphs**),
    so in a third-width column the body ended up LARGER than the headings above
    it; the document is now rescaled as a whole;
  - its output is wrapped in a div of its own, so `.ccg-pv-body > *:first-child`
    reset the wrapper's margin and never reached the first actual block.
- The panel clamp moved from `-webkit-line-clamp` to `max-height` + a fade:
  line-clamp counts lines only inside a `-webkit-box`, which a document of
  headings, lists and tables is not.
- ⚠ **No backticks anywhere in the `styles` template literal** — a CSS comment
  containing one silently ends the string and the file fails to parse. Cost two
  round trips; there is now a note in the stylesheet itself.

## Added in 0.4.5 — hiring asks first

`ccg_team` confirms each hire before starting anything, through **`ctx.userQuestions`**.

- **The seam already existed; the model-facing tool for it does not ship.**
  `dsh-user-questions` is mounted in `dsh-base` and the web app ships
  `dsh-client-ui-user-questions`, but **no bundle mounts `dsh-tool-ask-user`** —
  so there is a UI-backed ask with no default caller. Calling `ask()` from
  inside the tool is better than a card of this plugin's own anyway: the
  approval belongs to the act, not beside it.
- **`intent: {kind: 'plan-review', approve: '<label>'}` is a first-class
  presentation intent** meaning exactly "here is a plan, approve or decline".
  The harness renders it as 计划待审 with 拒绝 / 确认执行 instead of a generic
  menu. The intent NAMES the approving option rather than taking it by
  position — and the answer comes back carrying **this plugin's own label**, not
  the localised button text, which is the thing that would have silently turned
  every approval into a decline had it gone the other way. Verified by clicking.
- **Fail closed on the answer, fail open on the ask.** `readApproval` treats
  anything it cannot read as a decline, because hiring needs a yes. But
  `NO_PROVIDER` / `DELEGATED_CALLER` / `CALLER_NOT_LIVE` mean nobody could have
  answered — headless, or a delegated caller — and refusing there would be a
  deadlock, not a guard. Any other failure hires **and says so in the report**:
  a confirmation that quietly did not happen is worse than none.
- **A decline is a result, not an error** (`hired: false`), so `childId` had to
  become optional in the output schema. Throwing would read to the model as a
  malfunction and invite a retry; the report instead tells it to take the part
  itself or propose a different split, and not to route around the refusal.
- Asked **after** the collision check and **before** `startContinuable`: no
  point asking about a hire that would be refused anyway, or one already begun.

## Added in 0.4.5 — the team strip

Who is hired, what each exclusively owns, and who is still working, on a row
above the composer. Ownership is the plugin's one mechanical guarantee and it
was invisible unless you spent a turn asking the model to read `ccg_roster` —
to learn something the harness already knew.

- **Reading it never mutates.** `ccg_roster` sweeps stale rows on read because a
  model reading the roster is a considered act. This route is polled by a
  browser; a GET that deleted durable rows in the background would unclaim files
  nobody asked it to. So the strip reports stored ∪ live and claims nothing
  about the gap — "not in the live listing" is not "gone" (the creation window),
  and it does not say it is.
- **The polling rule was wrong on the first pass and the bug was in the idea,
  not the code**: polling only while `session.running` stops exactly when the
  team is doing the work, because a teammate keeps going AFTER the coordinator's
  turn ends — that is what continuable means. It now also polls while any
  teammate is live, and stops on its own when the last settles. A `report` wakes
  the parent, so `running` turns back on and covers the window where a
  just-hired child is not listed yet.
- **Its own route, not a section of the card's**: this is per conversation and
  read while a turn runs; the card's payload is per deployment and read when a
  tab is opened. Different lifetime, different reader, different route.
- Registered outside the settings seam — it needs neither `settings` nor the
  matrix fiber, only `webServer` and the already-open storage domain.
- Cosmetics again only visible by looking: the strip spanned the dock's full
  width (1526px) over a 780px composer card until it copied the shipped
  `max-width` / clearance pair, and it was 22px wider than its own parent
  because the app's `box-sizing: border-box` is not global.

## Added in 0.4.4 — the panel view

A panel's answers now render side by side in the conversation instead of as the
one blob of text a generic tool card shows. This is the plugin's only genuinely
unshared capability, so it was worth its own presentation.

- **Why the metadata seam and not a route.** The result is immutable once the
  tool returns, so there is nothing to poll and no state to serve. The answers
  ride `output.presentationMeta` and land as `block.meta`. The alternative —
  splitting the rendered report back apart on its `── label ──` rules — breaks
  the first time an answer contains such a line.
- **The duplication is deliberate.** Each answer is stored twice in the log:
  once in the model-facing content, once structurally in the metadata. Panels
  are rare and expensive by design (the triage convention says so), and the
  parse alternative is not sound.
- **Which tools are claimed is decided host-side**, in `buildPanelIndex()`, and
  served in the config payload as `panels`. The browser registers exactly those
  keys and releases one that stops being a panel. It is unit-tested there rather
  than re-derived in a browser file no test can load. A single-model role tool
  is deliberately not claimed — the official row renders it well already.
- **Live re-registration**: the card publishes each payload it reads to an
  in-module watcher set, so adding a second model to a role starts rendering
  that role as a panel on the next call rather than the next page load.
- **A member's `lens` is read from the mounted members**, matched on route
  rather than position, so a roster that no longer lines up loses the lens
  instead of hanging it on the wrong model.
- Cosmetics found only by looking at it: a role's members carry no label of
  their own, so the column printed `gw / m` twice until the view reused the
  report's rule; and three columns wrapped to two rows until the grid minimum
  came down to 200px — a panel on two rows is no longer a comparison.

## Closed in 0.4.3

- **Rows were immortal.** `release` removed one deliberately; a teammate simply
  abandoned — or one whose coordinator session was deleted — sat in the domain
  forever, holding files nothing could ever write again. `sweepStale()` now runs
  on every roster read and every hire, and prunes from the subagent service's
  own enumeration, so it guesses nothing. Two rules make it safe: a parent whose
  listing FAILS keeps every row ("the store did not answer" and "the child is
  gone" are different facts), and a row is immune for `PRUNE_GRACE_MS` because
  `listChildren` omits "a running candidate without [an identity] — its
  descriptor may not be appended yet". Sweeping that creation window would
  unclaim a live teammate's files and let the next hire overwrite it.
- **Live status never displayed.** The roster read `entry.status`;
  `SubagentListEntry` carries `activity: 'running' | 'inactive'`. Reading a
  field that does not exist is silent, so every teammate had simply shown no
  status since the tool was written. Found by reading the type, not the output.
- **`interrupt_agent` is now proven.** A teammate mid-assignment was interrupted
  and corrected: `turn/end {turn: 1, reason: {kind: 'aborted', reason: {kind:
  'parent'}}}`, then `turn/start {turn: 2}` from the follow-up, then the
  corrected deliverable and a report. Only the turn stopped; the teammate lived.
  The convention now also says *when* to reach for it.

## Closed in 0.4.1, each found by running it

- **A child could call `ccg_team`** — the conventions were suppressed in
  children but the tools stayed globally registered, so a teammate could hire a
  team the user never approved, inside the depth cap. Every child this plugin
  starts now carries `toolFilter: { deny: <this generation's tool names> }`.
  The list is built from what is actually registered, because **an unknown name
  in a filter fails the child's startup**, not just that entry. Verified from a
  real teammate's tool table: eleven `ccg_*` entries gone, `report` untouched
  (the report package registers scope-locally and deliberately survives a
  global filter). `isolateChildren: false` for a provider without the
  capability.
- **Team quoted a headcount, not a figure.** Every other gear quotes model
  calls. Team now states the arithmetic — one call per teammate per assignment,
  a worked example — and requires the number to be said out loud before hiring.
- **The coordinator burned a two-model review panel on files that were still
  stubs** while its team worked. The convention now names that specifically:
  reviewing what nobody has written is worse than idling, because it also
  produces findings about code that will not exist.

## The fresh-install path (0.4.2)

Checked on a genuinely empty `DSH_HOME` — provider routes copied in, no `ccg:`
section at all. It boots, all seven roles register, the card is populated, and
the harness's own onboarding (beta notice, API-key prompt) is what a new user
meets first. What that exposed:

- **The prose over-claimed where the model names did not.** The stated principle
  is that every prompt is generated from the resolved matrix. It was honoured
  for "which model serves this role" and violated one line above: with no tiers,
  the preamble still promised "a question worth being right about goes to
  several models at once" while `ccg_crosscheck` was not registered, and Deep
  still described panels that did not exist. Both are now conditional on the
  resolved matrix, with tests.
- **Nothing said the plugin was half-inert.** Seven roles all on one model is
  the personas without the routing. The routing section now carries one line
  saying so and where to fix it, and it disappears the moment a tier is set —
  the only channel that reaches a user who never opens the card.
- **Credentials live in the harness credential store**, not in env vars, so a
  copied `settings.yaml` alone cannot run a turn. Said in Requirements now.

## Not done

- Standalone npm publication — deliberately off; the plugin rides the
  `ccg-workflow` package instead. Reversing it is documented in the repo's
  CLAUDE.md, and the workflow is already written.
- The `dsh-plugin` topic on the GitHub repo, and a listing submission.
- A live turn on a fresh install: the credential store is per-home and copying
  the user's keys into a temp home was the wrong way to get one. Boot, mount,
  card and prompt were verified there; the turn itself was verified everywhere
  else.
