# CCG - Claude + Codex + Gemini Multi-Model Collaboration

<div align="center">

[![npm version](https://img.shields.io/npm/v/ccg-workflow.svg)](https://www.npmjs.com/package/ccg-workflow)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-Compatible-green.svg)](https://claude.ai/code)
[![Tests](https://img.shields.io/badge/Tests-134%20passed-brightgreen.svg)]()

[简体中文](./README.zh-CN.md) | English

</div>

A multi-model collaboration development system where Claude Code orchestrates Codex + Gemini. Frontend tasks route to Gemini, backend tasks route to Codex, and Claude handles orchestration and code review.

## Why CCG?

- **Zero-config model routing** — Frontend tasks automatically go to Gemini, backend tasks to Codex. No manual switching.
- **Security by design** — External models have no write access. They return patches; Claude reviews before applying.
- **27 slash commands** — From planning to execution, git workflow to code review, all accessible via `/ccg:*`.
- **Spec-driven development** — Integrates [OPSX](https://github.com/fission-ai/opsx) to turn vague requirements into verifiable constraints, eliminating AI improvisation.

## Architecture

```
Claude Code (Orchestrator)
       │
   ┌───┴───┐
   ↓       ↓
Codex   Gemini
(Backend) (Frontend)
   │       │
   └───┬───┘
       ↓
  Unified Patch
```

External models have no write access — they only return patches, which Claude reviews before applying.

## Quick Start

### Prerequisites

| Dependency | Required | Notes |
|------------|----------|-------|
| **Node.js 20+** | Yes | `ora@9.x` requires Node >= 20. Node 18 causes `SyntaxError` |
| **Claude Code CLI** | Yes | [Install guide](#install-claude-code) |
| **jq** | Yes | Used for auto-authorization hook ([install](#install-jq)) |
| **Codex CLI** | No | Enables backend routing |
| **Gemini CLI** | No | Enables frontend routing |

### Installation

```bash
npx ccg-workflow
```

On first run, CCG prompts you to select a language (English / Chinese). This preference is saved for all future sessions.

### Install jq

```bash
# macOS
brew install jq

# Linux (Debian/Ubuntu)
sudo apt install jq

# Linux (RHEL/CentOS)
sudo yum install jq

# Windows
choco install jq   # or: scoop install jq
```

### Install Claude Code

```bash
npx ccg-workflow menu  # Select "Install Claude Code"
```

Supports: npm, homebrew, curl, powershell, cmd.

## Commands

### Development Workflow

| Command | Description | Model |
|---------|-------------|-------|
| `/ccg:workflow` | Full 6-phase development workflow | Codex + Gemini |
| `/ccg:plan` | Multi-model collaborative planning (Phase 1-2) | Codex + Gemini |
| `/ccg:execute` | Multi-model collaborative execution (Phase 3-5) | Codex + Gemini + Claude |
| `/ccg:codex-exec` | Codex full execution (plan → code → review) | Codex + multi-model review |
| `/ccg:feat` | Smart feature development | Auto-routed |
| `/ccg:frontend` | Frontend tasks (fast mode) | Gemini |
| `/ccg:backend` | Backend tasks (fast mode) | Codex |

### Analysis & Quality

| Command | Description | Model |
|---------|-------------|-------|
| `/ccg:analyze` | Technical analysis | Codex + Gemini |
| `/ccg:debug` | Problem diagnosis + fix | Codex + Gemini |
| `/ccg:optimize` | Performance optimization | Codex + Gemini |
| `/ccg:test` | Test generation | Auto-routed |
| `/ccg:review` | Code review (auto git diff) | Codex + Gemini |
| `/ccg:enhance` | Prompt enhancement | Built-in |

### OPSX Spec-Driven

| Command | Description |
|---------|-------------|
| `/ccg:spec-init` | Initialize OPSX environment |
| `/ccg:spec-research` | Requirements → Constraints |
| `/ccg:spec-plan` | Constraints → Zero-decision plan |
| `/ccg:spec-impl` | Execute plan + archive |
| `/ccg:spec-review` | Dual-model cross-review |

### Agent Teams (v1.7.60+)

| Command | Description |
|---------|-------------|
| `/ccg:team-research` | Requirements → constraints (parallel exploration) |
| `/ccg:team-plan` | Constraints → parallel implementation plan |
| `/ccg:team-exec` | Spawn Builder teammates for parallel coding |
| `/ccg:team-review` | Dual-model cross-review |

> **Prerequisite**: Enable Agent Teams in `settings.json`: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`

### Git Tools

| Command | Description |
|---------|-------------|
| `/ccg:commit` | Smart commit (conventional commit format) |
| `/ccg:rollback` | Interactive rollback |
| `/ccg:clean-branches` | Clean merged branches |
| `/ccg:worktree` | Worktree management |

### Project Setup

| Command | Description |
|---------|-------------|
| `/ccg:init` | Initialize project CLAUDE.md |
| `/ccg:context` | Project context management (.context/ init, log, compress, history) |

## Workflow Guides

### Planning & Execution Separation

```bash
# 1. Generate implementation plan
/ccg:plan implement user authentication

# 2. Review the plan (editable)
# Plan saved to .claude/plan/user-auth-YYYYMMDD-HHmmss.md

# 3a. Execute (Claude refactors) — fine-grained control
/ccg:execute .claude/plan/user-auth-YYYYMMDD-HHmmss.md

# 3b. Execute (Codex does everything) — efficient, low Claude token usage
/ccg:codex-exec .claude/plan/user-auth-YYYYMMDD-HHmmss.md
```

### OPSX Spec-Driven Workflow

Integrates [OPSX architecture](https://github.com/fission-ai/opsx) to turn requirements into constraints, eliminating AI improvisation:

```bash
/ccg:spec-init                          # Initialize OPSX environment
/ccg:spec-research implement user auth  # Research → constraints
/ccg:spec-plan                          # Parallel analysis → zero-decision plan
/ccg:spec-impl                          # Execute the plan
/ccg:spec-review                        # Independent review (anytime)
```

> **Tip**: `/ccg:spec-*` commands internally call `/opsx:*`. You can `/clear` between phases — state is persisted in the `openspec/` directory.

### Agent Teams Parallel Workflow

Leverage Claude Code Agent Teams to spawn multiple Builder teammates for parallel coding:

```bash
/ccg:team-research implement kanban API  # 1. Requirements → constraints
# /clear
/ccg:team-plan kanban-api               # 2. Plan → parallel tasks
# /clear
/ccg:team-exec                          # 3. Builders code in parallel
# /clear
/ccg:team-review                        # 4. Dual-model cross-review
```

> **vs Traditional Workflow**: Team series uses `/clear` between steps to isolate context, passing state through files. Ideal for tasks decomposable into 3+ independent modules.

## Configuration

### Directory Structure

```
~/.claude/
├── commands/ccg/       # 26 slash commands
├── agents/ccg/         # Sub-agents
├── skills/ccg/         # Quality gates + multi-agent orchestration
├── bin/codeagent-wrapper
└── .ccg/
    ├── config.toml     # CCG configuration
    └── prompts/
        ├── codex/      # 6 Codex expert prompts
        └── gemini/     # 7 Gemini expert prompts
```

### Environment Variables

Configure in `~/.claude/settings.json` under `"env"`:

| Variable | Description | Default | When to change |
|----------|-------------|---------|----------------|
| `CODEAGENT_POST_MESSAGE_DELAY` | Wait after Codex completion (sec) | `5` | Set to `1` if Codex process hangs |
| `CODEX_TIMEOUT` | Wrapper execution timeout (sec) | `7200` | Increase for very long tasks |
| `BASH_DEFAULT_TIMEOUT_MS` | Claude Code Bash timeout (ms) | `120000` | Increase if commands time out |
| `BASH_MAX_TIMEOUT_MS` | Claude Code Bash max timeout (ms) | `600000` | Increase for long builds |

<details>
<summary>Example settings.json</summary>

```json
{
  "env": {
    "CODEAGENT_POST_MESSAGE_DELAY": "1",
    "CODEX_TIMEOUT": "7200",
    "BASH_DEFAULT_TIMEOUT_MS": "600000",
    "BASH_MAX_TIMEOUT_MS": "3600000"
  }
}
```

</details>

### MCP Configuration

```bash
npx ccg-workflow menu  # Select "Configure MCP"
```

**Code retrieval** (choose one):
- **ace-tool** (recommended) — Code search via `search_context`. [Official](https://augmentcode.com/) | [Third-party proxy](https://acemcp.heroman.wtf/)
- **fast-context** (recommended) — Windsurf Fast Context, AI-powered search without full-repo indexing. Requires Windsurf account
- **ContextWeaver** (alternative) — Local hybrid search, requires SiliconFlow API Key (free)

**Optional tools**:
- **Context7** — Latest library documentation (auto-installed)
- **Playwright** — Browser automation / testing
- **DeepWiki** — Knowledge base queries
- **Exa** — Search engine (requires API Key)

### Auto-Authorization Hook

CCG automatically installs a Hook to auto-authorize `codeagent-wrapper` commands (requires [jq](#install-jq)).

<details>
<summary>Manual setup (for versions before v1.7.71)</summary>

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.command' 2>/dev/null | grep -q 'codeagent-wrapper' && echo '{\"hookSpecificOutput\": {\"hookEventName\": \"PreToolUse\", \"permissionDecision\": \"allow\", \"permissionDecisionReason\": \"codeagent-wrapper auto-approved\"}}' || true",
            "timeout": 1
          }
        ]
      }
    ]
  }
}
```

</details>

## Utilities

```bash
npx ccg-workflow menu  # Select "Tools"
```

- **ccusage** — Claude Code usage analytics
- **CCometixLine** — Status bar tool (Git + usage tracking)

## Update / Uninstall

```bash
# Update
npx ccg-workflow@latest            # npx users
npm install -g ccg-workflow@latest  # npm global users

# Uninstall
npx ccg-workflow  # Select "Uninstall"
npm uninstall -g ccg-workflow  # npm global users need this extra step
```

## FAQ

### Codex CLI 0.80.0 process does not exit

In `--json` mode, Codex does not automatically exit after output completion.

**Fix**: Set `CODEAGENT_POST_MESSAGE_DELAY=1` in your environment variables.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

Looking for a place to start? Check out issues labeled [`good first issue`](https://github.com/fengshao1227/ccg-workflow/labels/good%20first%20issue).

## Contributors

<!-- readme: contributors,claude/-,bots/- -start -->
<table>
<tr>
    <td align="center"><a href="https://github.com/fengshao1227"><img src="https://avatars.githubusercontent.com/fengshao1227?v=4&s=100" width="100;" alt="fengshao1227"/><br /><sub><b>fengshao1227</b></sub></a></td>
    <td align="center"><a href="https://github.com/RebornQ"><img src="https://avatars.githubusercontent.com/RebornQ?v=4&s=100" width="100;" alt="RebornQ"/><br /><sub><b>RebornQ</b></sub></a></td>
    <td align="center"><a href="https://github.com/23q3"><img src="https://avatars.githubusercontent.com/23q3?v=4&s=100" width="100;" alt="23q3"/><br /><sub><b>23q3</b></sub></a></td>
    <td align="center"><a href="https://github.com/MrNine-666"><img src="https://avatars.githubusercontent.com/MrNine-666?v=4&s=100" width="100;" alt="MrNine-666"/><br /><sub><b>MrNine-666</b></sub></a></td>
    <td align="center"><a href="https://github.com/GGzili"><img src="https://avatars.githubusercontent.com/GGzili?v=4&s=100" width="100;" alt="GGzili"/><br /><sub><b>GGzili</b></sub></a></td>
</tr>
</table>
<!-- readme: contributors,claude/-,bots/- -end -->

## Credits

- [cexll/myclaude](https://github.com/cexll/myclaude) — codeagent-wrapper
- [UfoMiao/zcf](https://github.com/UfoMiao/zcf) — Git tools
- [GudaStudio/skills](https://github.com/GuDaStudio/skills) — Routing design
- [ace-tool](https://linux.do/t/topic/1344562) — MCP tool

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=fengshao1227/ccg-workflow&type=timeline&legend=top-left)](https://www.star-history.com/#fengshao1227/ccg-workflow&type=timeline&legend=top-left)

## Contact

- **Email**: [fengshao1227@gmail.com](mailto:fengshao1227@gmail.com) — Sponsorship, collaboration, or development ideas
- **Issues**: [GitHub Issues](https://github.com/fengshao1227/ccg-workflow/issues) — Bug reports and feature requests
- **Discussions**: [GitHub Discussions](https://github.com/fengshao1227/ccg-workflow/discussions) — Questions and community chat

## License

MIT

---

v1.7.83 | [Issues](https://github.com/fengshao1227/ccg-workflow/issues) | [Contributing](./CONTRIBUTING.md)
