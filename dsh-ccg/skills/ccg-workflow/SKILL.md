---
name: ccg-workflow
description: How to run a non-trivial change end to end with the CCG role tools (ccg_analyze / ccg_design / ccg_build / ccg_debug / ccg_optimize / ccg_review / ccg_test) and the verify-* quality gates. Use when a task is a whole feature, a refactor, a bug whose cause is not yet known, or any change large enough that one straight-through attempt would be a guess.
---

# CCG workflow

Seven role tools are available, each running a child agent on its own model with
its own expert persona. This is how to chain them so the work converges instead
of sprawling.

**Skip all of this for small, obvious work.** A one-line fix, a rename, a
question you can answer by reading two files — do it yourself. Delegation buys
depth, and it costs a round trip and a fresh context. Spend it only where depth
is the thing you lack.

## Picking a gear

Four modes. The user should not have to name one: read what they asked for,
pick, say which you picked in a line, and — for anything past Direct — say what
it costs and wait for a yes. They are paying per model call.

| Mode | For | Runs |
|------|-----|------|
| **Direct** | a one-line fix, a rename, a question you can answer by reading | you, alone |
| **Standard** | an ordinary feature, a bug with a known cause, a contained refactor | design → build → review |
| **Deep** | a design with real alternatives, an unclear bug, a migration, anything expensive to get wrong | analyze → design → build → test → review |
| **Team** | work that splits across files and will keep developing | `ccg_team` — several specialists at once, each owning its own files |

A role holding several models answers with all of them at once, so Deep costs
more than its phase count suggests — quote the real number of model calls, not
the number of phases. If the user names a mode, run that one. If a phase
changes what you believe, say so and re-pick rather than finishing a plan you
no longer believe in.

**Deep and Team are not a ranking.** Deep buys certainty about one thing by
asking several models about it. Team buys throughput on several things by
running colleagues at once. A hard question is Deep even if it is small; a wide
job is Team even if every part is easy. Something both hard and wide is Deep
first — settle the design and the contracts — then Team to build it.

## The loop

| Phase | Tool | Ends when |
|-------|------|-----------|
| 1. Understand | `ccg_analyze` | you can state the constraints and the options with their trade-offs |
| 2. Design | `ccg_design` | the interfaces and the boundaries are settled |
| 3. Build | `ccg_build` | the code exists and its verify command passes |
| 4. Verify | `ccg_review` + the gates | findings are triaged and the criticals are gone |

Diagnose before you build when the cause is unknown (`ccg_debug`), and treat
`ccg_optimize` and `ccg_test` as phases of their own when the task is
performance or coverage rather than a feature.

Not every task needs four phases. A well-understood change is design → build →
review. An investigation may be analyze → debug and stop there, with no code at
all.

## Writing a brief

A child sees **none of this conversation**. It gets your prompt and nothing
else, so an under-specified brief is the main way this goes wrong. Every brief
carries:

- **The goal** — one sentence on what the child must produce.
- **The anchors** — the exact files, symbols and commands it should start from.
  Paths, not descriptions.
- **The constraints** — what it must not change, the conventions to follow, the
  decisions already made (and by whom).
- **The shape of the answer** — a diff, a report, a ranked list. Say which.

Bad: *"look at the auth code and improve it."*
Good: *"In `src/auth/session.ts`, the refresh path drops the CSRF token when a
retry follows a 401 (see `refreshSession`, lines 40-80). Diagnose the root
cause. Do not change code. Report ranked hypotheses with the minimal test that
would confirm each."*

## The quality gates

Bundled beside this skill, each runnable through the shell and each documenting
its own arguments:

| Gate | Use it after |
|------|--------------|
| `verify-change` | any change — analyses the diff and flags docs that drifted |
| `verify-quality` | a complex or refactored module — complexity, duplication, naming, length |
| `verify-security` | new modules, auth/crypto/input handling, anything touching secrets |
| `verify-module` | a newly created module — structure and required docs |
| `gen-docs` | creating a module — scaffolds its README and DESIGN |

They are deterministic scanners, not opinions: run them before `ccg_review` so
the reviewer spends its turn on judgement rather than on what a script already
knows. A gate's findings are input to your decision, not a verdict — a flagged
line can still be correct.

## What stays with you

Delegate the turn, never the decision.

- **Choosing between options is yours.** A child ranks; you pick, and you own
  the reason.
- **Acceptance is yours.** Never let a child's "looks good" close a task. Read
  what came back and judge it — children are confident about work they cannot
  see the context of.
- **Integration is yours.** Children work in isolation; nothing but you is
  watching how the pieces meet.
- **Contradictions are signal.** When the analyzer and the reviewer disagree,
  that disagreement is the most valuable thing you have. Resolve it explicitly
  instead of averaging it away.

## Running them in parallel

Independent delegations can run at once — a review of one module and tests for
another have nothing to say to each other. Wait (`run_in_background: false`)
only when your next move depends on the answer.

Do not parallelise work that writes to the same files. Two builders editing one
module will produce a conflict nobody asked for; sequence those, or split the
work along file boundaries first.

## Running a team

`ccg_team` hires a role as a colleague instead of asking it a question: it stays
alive across turns, takes more work through `send_message`, and reports back on
its own. Use it when the job splits into substantial parts that do not wait on
each other and will keep developing. For a single question, the role's own tool
is cheaper.

Before hiring anything:

1. **Settle every shared contract.** Teammates cannot see each other. Any
   interface two of them meet at — a signature, a schema, an event name, a file
   format — has to be decided and written into *both* briefs, or each will
   invent a reasonable version and neither will fit. Read the code and pin the
   contract down yourself; this is the step that decides whether the team works.
   Record it with `ccg_remember` as you settle it — the next session should not
   have to re-derive it, and neither should you after a compaction.
2. **Draw the file boundaries.** Give every concurrent teammate a disjoint
   `owns` set. Two agents editing one file lose each other's work with no error.
   A hire that reaches into someone else's files is refused, naming the holder,
   so a refusal is a prompt to re-split the work — not an error to route around.
3. **Say the roster and the cost**, then wait for a yes.

`ccg_roster` is the durable answer to "who owns what". Read it whenever you are
unsure — after a compaction it is the only thing that still knows, and it is the
difference between routing a fix to its owner and quietly overwriting them.

While they work, do not sleep or poll — a report wakes you by itself, so ending
your turn *is* how you wait, and it costs nothing. Say who is working on what
and stop.

As reports land: read each one, integrate it, and route what it implies. A
teammate reporting a changed contract is the signal to `send_message` whoever
depends on it. When integration turns up a fault in a file a live teammate owns,
send it back to them rather than fixing it quietly — they still think they own
that file, and their next assignment would overwrite you. Take a file back only
by saying so.

Then verify the whole yourself: run the thing end to end, check the contract
that every part was supposed to honour, and review the assembled result. No
teammate can see the seam it was built against.

## What to write down

`ccg_remember` puts one thing in `.ccg/memory.md`, which loads itself into every
later session in this workspace. Use it the moment something is settled that
would otherwise be re-argued:

| Kind | Write it when |
|------|---------------|
| `decision` | you chose between real alternatives — record the reason and what you rejected, or it can only be obeyed, never revisited |
| `contract` | two parts must agree: a signature, a schema, an event name, a file format |
| `convention` | this project does something in a way a newcomer would guess wrong |
| `gotcha` | something looks fine and is not |

Not a log of what happened. The transcript is that already, and a memory that
fills with narration stops being worth loading. If you find a note is wrong or
out of date, say so and fix the file — a stale note does more damage than a
missing one.
