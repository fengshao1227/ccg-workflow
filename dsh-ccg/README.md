# dsh-ccg

**CCG's multi-model role matrix for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — seven role-pinned delegation tools, each on its own model, with no external CLI. Any role can answer as a panel of models, or be hired as a live teammate with files of its own. Ownership and project decisions are durable.**

[中文](./README.zh-CN.md) · MIT · tracks dsh `0.1.x` · part of [CCG](https://github.com/fengshao1227/ccg-workflow) — ⭐ the repo, not this folder

---

## Quick start

```sh
dsh plugin --profile web add dsh-ccg
```

Boot as usual, then open **Settings › Plugins › CCG role matrix** and set the two tiers — a reasoning model and a fast one, picked from routes the harness can already reach.

That is the whole setup. **There is nothing to invoke.** Say what you want in your own words:

> **the three parsers in `src/` are stubs — implement them against `src/contract.md`**
>
> I judge this a **Team**: the three parsers can be written in parallel and each is its own file. I'd put one builder on each of `nginx.js`, `json.js`, `apache.js` — three teammates, one round each, so 3 model calls — then check them all against the contract and the samples myself. Go ahead?

The agent reads what you asked for, picks how much machinery it deserves, says which and what it costs, and waits. A one-line question it just answers — asking permission for that wastes more of your time than the answer.

Four things you can then do without learning any commands:

| You want | Say | What happens |
|----------|-----|--------------|
| a specialist's opinion | *"review this diff"* | one child on the reviewer's model, with CCG's reviewer instructions |
| several opinions | *"I want to be sure about this"* | give a role two models in the card — they answer the same brief independently, side by side |
| parallel work | *"implement these four modules"* | `ccg_team` hires a colleague per part, each owning its own files |
| decisions to stick | *"remember that we settled on SQLite"* | written to `.ccg/memory.md`, loaded automatically in every later session |

**Skipping the tiers is allowed but disappointing.** Every role still registers and still carries its expert instructions, but they all run on one model — you get the personas without the routing that makes delegating worth a round trip. The plugin says so in its own prompt until you set them.

**Expect approval prompts.** dsh's sandbox asks before anything outside a workspace write, so a run that verifies its own work end to end will ask a few times. That is the harness's policy, not this plugin's; widen the default permission mode in Settings if you would rather not be asked.

**What it writes to disk.** Exactly two things. `.ccg/memory.md` in the workspace — meant to be committed, since it is your project's decisions and your teammates read it; delete any line that stops being true. And `~/.dsh/storages/ccg_team.json`, the ownership map, which stays outside your repo because it is machine state, not knowledge. Nothing else: no cache, no lockfile, no dotfile in your home.

---

## What it does

One model rarely fits every turn. Review wants care; implementation wants speed; design wants reasoning depth. [CCG](https://github.com/fengshao1227/ccg-workflow) has run that discipline on Claude Code for a year — **different roles, different models** — at the cost of driving one vendor CLI per backend: an install, a login, and a startup tax on every call.

On dsh that layer disappears. This plugin gives the agent seven delegation tools:

| Tool | Role | Default tier | What the child does |
|------|------|--------------|---------------------|
| `ccg_analyze` | analyzer | strong | read-only analysis: options, trade-offs, a ranked recommendation |
| `ccg_design` | architect | strong | blueprint: boundaries, interface contracts, migration path |
| `ccg_build` | builder | worker | implement an agreed plan, complete and runnable, plus its verify command |
| `ccg_debug` | debugger | strong | root cause: evidence, ranked hypotheses, fix direction |
| `ccg_optimize` | optimizer | worker | measure, locate the bottleneck, targeted fix |
| `ccg_review` | reviewer | strong | graded findings with `file:line`, PASS / NEEDS_IMPROVEMENT |
| `ccg_test` | tester | worker | integration and contract tests, edge cases |

Each tool starts a child on **its own model**, carrying **its own expert persona** — the role prompts CCG uses in production. You configure two tiers; the seven roles resolve from them.

### The user just talks; the harness picks the gear

There is nothing to invoke. Say what you want, and the agent decides how much machinery the request deserves, says so in a line, and — for anything past the cheapest mode — tells you what it will cost before spending it:

> **I want to add rate limiting to my API.**
>
> This looks **Deep** because rate limiting depends on your stack, deployment topology and whether limits must hold across instances. I'd use analysis → design → build → test → review. That is **5 delegations / 8 model calls**. Say *yes, deep* to proceed, or *standard* for a lighter 3-delegation pass.

Ask it what `isEven` does and it just answers — asking permission for a one-line question wastes more of your time than the answer costs.

The menu is generated from the roles actually mounted, so a mode can never advertise a step this deployment cannot run or a model count that is not what you will be billed. Name a mode yourself and it runs that one. Set `triage: false` to remove the convention entirely.

### What a child starts from

A delegated child sees none of your conversation by default. That is usually right — an opinion is only worth asking for if it was formed independently — but it puts the whole burden on the brief you write, and a role that is *continuing* your work should not have to be told what you just agreed.

So each role chooses:

```yaml
    roles:
      builder: { context: inherit }   # starts from the conversation so far
      reviewer: { context: brief }    # default: only the brief you write
```

`inherit` runs the child through dsh's `fork` provider, which seeds it with every completed turn of the parent session. Ask a forked builder "which database are we using?" without saying so in the brief and it answers from what you agreed three turns ago.

**A panel may not inherit.** Members that have read your reasoning are echoes, not second opinions, so a role holding two or more models with `context: inherit` is refused at mount rather than quietly producing agreement.

### A role can hold any number of models

Give one role several models and it becomes a **panel**: they all receive the same brief, wearing the same expert persona, answering independently — and the answers come back side by side. That is the other half of CCG, the part its `analyze` / `review` / `debug` commands have always done: two models answer, and what you act on is **where they disagree**.

```yaml
ccg:
  roles:
    analyzer:
      models:                       # as many as you like
        - { provider: gateway-a, model: a-reasoning-model }
        - { provider: gateway-b, model: a-rival-model }
        - { provider: gateway-c, model: a-third-opinion }
```

One model is a plain delegation and uses the official subagent tool. Two or more make the role a panel. Nothing votes and nothing is averaged: a majority can be wrong together, and averaging two answers usually destroys what was right in each — so every answer arrives verbatim and the verdict stays with the model holding the context.

`ccg_crosscheck` is the same machine with no role persona, for a question that belongs to no single specialism. It asks the `panel` you configure, or the two tiers when you configure none.

Every hop is a provider API request. No binary bridge, no per-vendor login, no cold-start tax.

**And you read them side by side.** A panel call renders in the conversation as one column per model — names, routes, the lens each was given, and each answer rendered as the markdown it actually is — instead of the single scrolling blob a generic tool card would give you. While it runs, the columns name the models being asked, so the routing is visible without opening settings.

The plugin claims that rendering only for the tools that actually answer as a panel; a role holding one model keeps the standard row it already renders well. Answers are carried to the browser through the tool's `output.presentationMeta`, the harness's own durable presentation seam, so they survive a reload and a replay of the session log rather than existing only while the call is live.

### Or hire a role as a teammate

A role tool asks a question and gets an answer. `ccg_team` **hires** the same role instead: a colleague that stays alive across turns, takes more work through `send_message`, and reports back on its own as it finishes.

```
ccg_team(role: "builder", description: "parser rewrite",
         owns: ["src/parse/"], prompt: "…")
→ builder teammate hired: 776d6301-…  Running on claude / claude-sonnet-5
```

Hire several and they work at once. Two rules decide whether that helps or corrupts the tree, and the plugin states both in the prompt:

- **One writer per file.** Every concurrent teammate gets a disjoint `owns` set, written into its persona. Two agents editing one file lose each other's work with no error — and this binds the coordinator too: when integration finds a fault in a live teammate's file, it sends the fix back rather than making it quietly.
- **Settle the contracts first.** Teammates cannot see each other, so any interface two of them meet at has to be decided and written into both briefs, or each invents a reasonable version and neither fits.

Waiting is free: a report wakes the coordinator by itself, so ending the turn *is* how you wait — no sleeping, no polling, and no inventing filler work over files nobody has written yet. When one is visibly building the wrong thing, `interrupt_agent` stops that turn and only that turn; the teammate stays alive for the correction. Verified: an interrupted teammate's transcript shows `turn 1 aborted (parent)`, then turn 2 doing the corrected work.

A teammate cannot hire a team of its own. Suppressing the convention in a child removed the invitation but not the capability, so every child this plugin starts also has this plugin's tools filtered out of it — verified from a hired teammate's own tool table, where all eleven `ccg_*` entries are gone and its `report` channel is untouched. It keeps the harness's own `subagent`, which runs on the deployment default and springs no per-model surprise.

This is CCG's Agent Teams, and on dsh it needs no bridge: `startContinuable`, `send_message`, `report`, `interrupt_agent` and `list_agents` are all native. What this plugin adds is the CCG role behind each teammate — its persona, its model, and its file ownership. Set `team: false` to leave `ccg_team` unregistered.

### Hiring asks you first

Every hire is confirmed before the teammate starts: which role, on which model, and exactly which files it will hold. It rides the harness's own user-questions seam and its `plan-review` intent, so it renders as the approval it is rather than a card this plugin invented — and a decline comes back to the model as an ordinary result, not an error, so it proposes a different split instead of retrying.

This is the one act here you cannot undo by reading the next message: a colleague starts working immediately, keeps going after the turn ends, and takes files away from everyone else including the coordinator. A convention in the prompt asks for that; a confirmation is the mechanism. Set `confirmHires: false` where nobody is watching — a deployment with no question provider (headless) skips it on its own rather than deadlocking, and a hire that could not be confirmed says so in its report instead of pretending it was.

### Ownership is enforced, not requested

One writer per file is the claim the whole feature rests on, so it is not left to a paragraph in a persona. Every hire is recorded in the harness's own durable storage domain, and a hire that would reach into a teammate's files is **refused before the child starts**:

```
ccg: those files already belong to a teammate, and two writers on one file lose each
other's work with no error:
  builder (e9b3109d-abac) already owns memtest/src/parse.js
    — you asked for memtest/src, which overlaps their memtest/src/parse.js

Either give this teammate different files, or send the work to the owner with
send_message. To take the files back first, call ccg_roster with action "release".
```

The check is deliberately generous — `src/`, `src/*.js` and `./src/a.js` all collide with `src/a.js` — because a false positive costs one reworded assignment and a false negative costs a silent overwrite.

`ccg_roster` reads that map back: who is on the team, what they run on, which files are theirs, and their live status — and it tidies as it reads, retiring rows for teammates the harness no longer holds so an abandoned one stops claiming files nothing can write again. It prunes only from the service's own enumeration, never a heuristic: a listing that fails keeps every row, and a teammate hired moments ago is immune, because the service legitimately omits a child whose descriptor is not appended yet. **It outlives the conversation.** After a compaction — the point at which the transcript's copy is gone — it is the only thing that still knows who owns what. Files claimed by a *different* conversation in the same workspace appear as a warning rather than a refusal: you cannot message someone else's teammates, and a guard you have no way to lift would be a deadlock.

### Project memory

`ccg_remember` writes one thing down where the next session will find it — a decision and why it beat the alternatives, a contract two parts must honour, a convention, a trap. It lands in `.ccg/memory.md` in the workspace: Markdown, so a human reads it, reviews it in a diff, and deletes the line that stopped being true.

The file is then loaded into the coordinator's prompt automatically, capped, newest notes first when it overflows. Verified cold: a note written in one session was answered correctly by a **new session in a restarted process, with zero tool calls** — it came from the prompt, not from a file read.

Deliberately narrow. It is not a log of what happened — the transcript is that already, and a memory that fills up with narration stops being worth loading.

## Verified, not asserted

Checked on a real dsh install (`0.1.0-rc.6`, pi-ai gateway) by reading the session store — the ground truth of which model served which turn:

```
parent session      model: glm-5.2            ← the orchestrator
ccg_review  child   model: deepseek-v4-pro    ← strong tier
ccg_build   child   model: deepseek-v4-flash  ← worker tier
```

Three models, one session, split by role. The child's transcript also carries its role persona, and `provider: spawn` confirms it ran in-process — no CLI was launched. All seven tools register out of the box with no configuration.

The side-by-side rendering was checked the same way: a three-model `ccg_analyze` call rendered as three columns, then rendered identically after the server was restarted and the page reloaded — which is what proves the answers are carried by the durable presentation seam and not by anything live.

The team strip was checked over a whole hire: the count went from one teammate to two mid-turn with the new one marked live, dropped back as it settled, and the file it was given (`add(a, b)`, nobody else's) was there afterwards. Ten seconds after everything settled the strip had made no further requests, which is the part a polling UI has to earn.

The hire confirmation was checked on both arms. Approving rendered as the harness's own plan-review card — role, model, files, brief — and the teammate started, worked and settled. Declining started nobody: no child, no file, and no row in the ownership map; the model received "Not hired" as a normal result and stopped rather than trying again.

Teams were checked the same way, on a job with three independent parsers behind one contract. The agent picked Team unprompted, quoted the split, and waited for a yes; hired three builders with `owns: [src/nginx.js] / [src/json.js] / [src/apache.js]` and the contract copied into every brief; all three reported back and settled; the coordinator ran the assembled result end to end. Five of six sample lines parsed, the sixth correctly rejected, and no parser threw on malformed input. A second run confirmed the follow-up direction: one teammate, two assignments, the second delivered through `send_message` after the first report landed.

## Bundled skills

The package also publishes six skills through the official filesystem provider, under its own provider name so your existing skill roots keep theirs:

| Skill | What it is |
|-------|-----------|
| `ccg-workflow` | The playbook: which role for which phase, how to write a brief a context-free child can act on, what stays with the main model, when to parallelise, and how to run a team |
| `verify-change` | Analyses the diff and flags documentation that drifted |
| `verify-quality` | Complexity, duplication, naming, function and file length |
| `verify-security` | Dangerous patterns, injection surfaces, leaked secrets |
| `verify-module` | Structure and required docs for a new module |
| `gen-docs` | Scaffolds a module's README and DESIGN |

The five gates are CCG's own scanners, shipped byte-identical. They are deterministic — run them before `ccg_review` so the reviewer spends its turn on judgement instead of on what a script already knows.

Set `skills: false` to publish none of them, or add your own roots with `skillDirs`.

## Install

```sh
dsh plugin --profile web add ./dsh-ccg     # from a local checkout
```

Then boot as usual. With no configuration every role registers and runs on your deployment's default model — you get the personas immediately. Add tiers to get the model split.

To try it before installing:

```sh
dsh --profile headless --patch ./cordis.dev.yml "your task"
```

(Edit the absolute path inside `cordis.dev.yml` first — the loader needs a real path to the source.)

## Configure from the UI

The plugin ships a browser half with three surfaces.

The matrix has a card in **Settings › Plugins › Plugin configuration**: both tiers as editable fields, a badge on each tier the user layer overrides, a row per role where you add as many models as you like from the routes the harness can actually reach, and a switch for hiring. Edits are staged and written only on save — a settings write is a durable document mutation, not something a control should perform as it settles. Adding a second model to a role also makes that role's calls render as a panel from the next call on, without a reload.

The second is the panel view described above, registered into the conversation's `tool.call.toolview` slot under each panel tool's own name.

All three borrow the harness's own component kit (`dsh-client-ui-primitives`) where the shell lends it — the same buttons, state dots and markdown renderer the rest of the app uses — and fall back to markup this plugin owns where it does not. Nothing here needs a build step either way.

The third is the **team strip** above the composer: who is hired, what each one exclusively owns, and who is still working. It appears only when a team exists, so a solo session never sees it. Ownership is the plugin's one mechanical guarantee, and until now the only way to see it was to spend a turn asking the model to read `ccg_roster` — something the harness already knew. It reads its own `/api/ccg/team` route and polls only while a turn is running or a teammate is still working; once everything settles it makes no requests at all. Reading it never mutates the roster: `ccg_roster` prunes rows the harness no longer holds, because a model reading the roster is a considered act, but a background GET that quietly unclaimed files would not be.

The card reads and writes through this plugin's own `/api/ccg/config` route rather than the client settings scope. That is not a shortcut: `dsh-host-apiproxy` serves settings namespaces to the browser from a fixed allowlist, on the principle that *"a future registration does not become remotely readable or writable by default"*, so a third-party namespace is deliberately not on it. The Host still owns every write, through the same settings scope the profile patch layers under, and writes from anywhere but this machine are refused.

## Configure by hand

In your profile's `cordis.patch.yml`:

```yaml
- id: ccg
  name: dsh-ccg
  config:
    strong:
      provider: my-gateway      # a route under llm-pi-ai.providers
      model: a-reasoning-model
    worker:
      provider: my-gateway
      model: a-fast-model
```

`provider` names a route you declared in `$DSH_HOME/settings.yaml` under `llm-pi-ai.providers`. Any vendor API or OpenAI-compatible gateway works.

…or in the harness settings document (`$DSH_HOME/settings.yaml`), which the Settings dialog opens for you and which re-applies **live, without a restart**:

```yaml
ccg:
  strong: { provider: my-gateway, model: a-reasoning-model }
  worker: { provider: my-gateway, model: a-fast-model }
```

The plugin registers `ccg` as a settings namespace, so the profile patch is the composition base and this section is the user layer above it. Editing it retires the current role tools and registers the next set in place.

Per-role overrides sit under `roles`:

```yaml
    roles:
      builder:   { tier: strong }                          # move one role to the other tier
      reviewer:  { provider: other-gw, model: specialist }  # pin one role outright
      optimizer: { enabled: false }                        # drop a role
      analyzer:  { toolName: deep_think }                  # rename its tool
```

| Key | Default | Meaning |
|-----|---------|---------|
| `strong` / `worker` | unset | The two model tiers. Unset → children use the deployment default model. |
| `roles.<name>` | — | Per-role `enabled`, `tier`, `provider`, `model`, `maxTokens`, `toolName`. |
| `subagentProvider` | `spawn` | The `ctx.subagents` provider to delegate through. `spawn` runs children in-process, which is what supports per-child personas. |
| `maxDepth` | `2` | Delegation depth cap for role children. |
| `backgroundMode` | `one-shot` | `one-shot` answers in the foreground by default — usually what an orchestrating turn wants. |
| `team` | `true` | Register `ccg_team`: hire a role as a live teammate. Needs a subagent provider that can keep children alive. |
| `teamTool` | `ccg_team` | Rename the hiring tool. |
| `memory` | `true` | Record file ownership durably through the storage domain, refuse colliding hires, and register `ccg_roster`. |
| `knowledge` | `true` | Register `ccg_remember` and load the workspace's `.ccg/memory.md` into the coordinator's prompt. |
| `knowledgeMaxBytes` | `8192` | Byte cap on the loaded project memory; over it, the newest notes win. |
| `isolateChildren` | `true` | Remove this plugin's own tools from every child it starts, so a delegated child cannot hire a team or open a panel the user never approved. Needs a provider with the `toolFilter` capability (`spawn` has it). |
| `routingPrompt` | `true` | Publish the routing convention (which tool for what, on which model) to the system prompt. |
| `skills` | `true` | Publish the bundled skills — the workflow playbook and the quality gates. |
| `skillDirs` | `[]` | Extra skill roots to publish: absolute paths to directories of `<name>/SKILL.md` bundles. |

A typo in a role name or tier is **refused at mount** with the valid names listed, rather than silently downgrading a child to the default model.

## How it works

The plugin does not reimplement delegation. It mounts the official
[`@deepseek-ai/dsh-tool-subagent`](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/subagent) once per role, each instance pinned through its schema-validated `agentOptions` and `persona`. Background jobs, depth checks, cancellation, rendering and settlement all stay official behaviour; the role→model matrix, the personas and the routing convention are what this package adds. Only the two things the official tool cannot express have their own tool: a panel, whose members answer one brief in parallel, and hiring, which must reach any role from a single call rather than one instance per role.

The conventions published to the system prompt are generated from the resolved matrix, so they can never advertise a model a role is not actually pinned to. They are also **shown only to the agent talking to you** — a `systemPrompt` registration is global, so without that every delegated child would pay for a triage convention it was never given a choice about, and be invited to hire a team of its own inside the depth cap.

## Requirements

- DeepSeek Harness `0.1.0-rc.6` or newer (developer preview — its plugin API is still moving)
- At least one configured provider route, with its credential stored through the harness (the web **Settings › Models** page writes it) — a route whose `apiKeyEnv` is unset fails at the first request, not at boot
- A subagent provider with the `persona` capability for personas to apply (`spawn`, the default, has it)

## Development

```sh
node --test test/*.test.mjs
```

The role matrix resolves through one pure function (`resolveRoles`), so which model serves which role is unit-tested without booting a harness or spending a token.

## Part of CCG

This plugin lives in the [**CCG**](https://github.com/fengshao1227/ccg-workflow) repository, under `dsh-ccg/`. CCG is the same discipline for Claude Code (`npx ccg-workflow`), where the same role prompts drive Claude, Codex, Gemini, Grok, Kimi and OpenCode. One repo, two packages: issues, stars and pull requests all belong to CCG.

If this was useful, the star goes on [the repository](https://github.com/fengshao1227/ccg-workflow).

MIT.
