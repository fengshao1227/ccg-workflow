# templates (CCG 模板库)

> [根目录](../CLAUDE.md) > **templates**

**Last Updated**: 2026-04-10

---

## 模块职责

`templates/` 是 CCG Workflow 的"弹药库"。所有安装到用户 `~/.claude/` 的素材都从这里出发，经过 `src/utils/installer.ts` 模板变量替换后写入目标位置。职责涵盖：

- **29 个斜杠命令** + **7 个子智能体**（→ `~/.claude/commands/ccg/` + `~/.claude/agents/ccg/`）
- **19 个专家提示词**（Claude / Codex / Gemini 三组，→ `~/.claude/.ccg/prompts/`）
- **100+ 技能文件**（质量关卡 + 10 大域知识秘典 + impeccable + 工具，→ `~/.claude/skills/ccg/`）
- **2 个全局规则**（→ `~/.claude/rules/`）
- **8 种输出风格**（→ `~/.claude/output-styles/`，由菜单命令安装）

`commands-v2/` 和 `examples/` 目前无实际内容，详见末尾说明。

---

## 目录总览

| 目录 | 文件数 | 用途 | 安装目标 |
|------|--------|------|----------|
| `commands/` | 29 `.md` | 斜杠命令模板 | `~/.claude/commands/ccg/` |
| `commands/agents/` | 7 `.md` | 子智能体定义 | `~/.claude/agents/ccg/` |
| `prompts/claude/` | 6 `.md` | Claude 专家提示词 | `~/.claude/.ccg/prompts/claude/` |
| `prompts/codex/` | 6 `.md` | Codex 专家提示词 | `~/.claude/.ccg/prompts/codex/` |
| `prompts/gemini/` | 7 `.md` | Gemini 专家提示词 | `~/.claude/.ccg/prompts/gemini/` |
| `skills/` | 100+ | 技能文件（质量关卡 + 域知识 + 工具） | `~/.claude/skills/ccg/` |
| `rules/` | 2 `.md` | 全局规则（质量关卡触发 + 域知识路由） | `~/.claude/rules/` |
| `output-styles/` | 8 `.md` | 输出风格（邪修/专业/猫娘/大小姐等） | `~/.claude/output-styles/`（菜单安装） |
| `commands-v2/` | 0（仅空目录） | v2 命令结构重构预留，尚无内容 | 不安装 |
| `examples/` | 0（仅目录结构） | `.claude/tasks/` 目录结构示例 | 不安装 |

---

## commands/（29 个斜杠命令）

所有命令均含 YAML frontmatter `description` 字段，Skill Registry 使用此字段生成命令索引。

### 开发工作流（核心 8 个）

| 命令文件 | slash command | 描述 |
|----------|--------------|------|
| `workflow.md` | `/ccg:workflow` | 多模型协作开发工作流（研究→构思→计划→执行→优化→评审），智能路由前端/后端 |
| `plan.md` | `/ccg:plan` | 多模型协作规划：上下文检索 + 双模型分析 → 生成 Step-by-step 实施计划 |
| `execute.md` | `/ccg:execute` | 多模型协作执行：根据计划获取原型 → Claude 重构实施 → 多模型审计交付 |
| `codex-exec.md` | `/ccg:codex-exec` | 后端模型全权执行计划：MCP 搜索 + 代码实现 + 测试，多模型审核 |
| `feat.md` | `/ccg:feat` | 智能功能开发：自动识别输入类型，规划/讨论/实施全流程 |
| `frontend.md` | `/ccg:frontend` | 前端专项工作流（研究→构思→计划→执行→优化→评审），前端主模型主导 |
| `backend.md` | `/ccg:backend` | 后端专项工作流（研究→构思→计划→执行→优化→评审），后端主模型主导 |
| `enhance.md` | `/ccg:enhance` | 内置 Prompt 增强：将模糊需求转化为结构化任务描述 |

### 分析与优化（4 个）

| 命令文件 | slash command | 描述 |
|----------|--------------|------|
| `analyze.md` | `/ccg:analyze` | 多模型技术分析（并行）：后端视角 + 前端视角，交叉验证综合见解 |
| `debug.md` | `/ccg:debug` | 多模型调试：后端诊断 + 前端诊断，交叉验证定位问题 |
| `optimize.md` | `/ccg:optimize` | 多模型性能优化：后端优化 + 前端优化 |
| `test.md` | `/ccg:test` | 多模型测试生成：智能路由后端测试 / 前端测试 |

### 代码质量（2 个）

| 命令文件 | slash command | 描述 |
|----------|--------------|------|
| `review.md` | `/ccg:review` | 多模型代码审查：无参数时自动审查 git diff，双模型交叉验证 |
| `context.md` | `/ccg:context` | 项目上下文管理：初始化 `.context` 目录、记录决策日志、压缩归档、查看历史 |

### 项目管理（1 个）

| 命令文件 | slash command | 描述 |
|----------|--------------|------|
| `init.md` | `/ccg:init` | 初始化项目 AI 上下文：生成根级与模块级 CLAUDE.md 索引 |

### Git 工具（4 个）

| 命令文件 | slash command | 描述 |
|----------|--------------|------|
| `commit.md` | `/ccg:commit` | 智能 Git 提交：分析改动生成 Conventional Commit 信息，支持拆分建议 |
| `rollback.md` | `/ccg:rollback` | 交互式 Git 回滚：安全回滚到历史版本，支持 reset/revert 模式 |
| `clean-branches.md` | `/ccg:clean-branches` | 清理 Git 分支：安全清理已合并或过期分支，默认 dry-run 模式 |
| `worktree.md` | `/ccg:worktree` | 管理 Git Worktree：在 `../.ccg/项目名/` 目录创建，支持 IDE 集成 |

### Agent Teams 并行系列（5 个，v1.7.60+ / v1.8.3+）

> 需启用 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`

| 命令文件 | slash command | 描述 |
|----------|--------------|------|
| `team.md` | `/ccg:team` | **统一工作流（推荐）**：8 阶段全流程（需求→架构→规划→开发→测试→审查→修复→集成），7 角色自动编排 |
| `team-research.md` | `/ccg:team-research` | 需求研究：并行探索代码库，产出约束集 + 可验证成功判据 |
| `team-plan.md` | `/ccg:team-plan` | 规划：Lead 调用前端/后端模型并行分析，产出零决策并行实施计划 |
| `team-exec.md` | `/ccg:team-exec` | 并行实施：读取计划文件，spawn Builder teammates 并行写代码 |
| `team-review.md` | `/ccg:team-review` | 双模型交叉审查：分级处理 Critical/Warning/Info |

### OpenSpec (OPSX) 系列（5 个）

| 命令文件 | slash command | 描述 |
|----------|--------------|------|
| `spec-init.md` | `/ccg:spec-init` | 初始化 OPSX 环境 + 验证多模型 MCP 工具 |
| `spec-research.md` | `/ccg:spec-research` | 需求 → 约束集（并行探索 + OPSX 提案） |
| `spec-plan.md` | `/ccg:spec-plan` | 多模型分析 → 消除歧义 → 零决策可执行计划 |
| `spec-impl.md` | `/ccg:spec-impl` | 按规范执行 + 多模型协作 + 归档 |
| `spec-review.md` | `/ccg:spec-review` | 双模型交叉审查（独立工具，随时可用） |

---

## commands/agents/（7 个子智能体）

子智能体安装为 Claude Code 的子 Agent，由主命令通过 `Agent(subagent_type=...)` 调用。

| 文件 | name | 描述 |
|------|------|------|
| `planner.md` | `planner` | 📋 任务规划师：使用 WBS 方法论分解功能需求为可执行任务 |
| `ui-ux-designer.md` | `ui-ux-designer` | 🎨 UI/UX 设计师：为前端功能生成页面结构、组件拆分和交互流程设计 |
| `init-architect.md` | `init-architect` | 🏗 自适应初始化：根级简明 + 模块级详尽，分阶段遍历并回报覆盖率 |
| `get-current-datetime.md` | `get-current-datetime` | 🕐 执行日期命令并仅返回原始输出（无格式、无说明、无并行） |
| `team-architect.md` | `team-architect` | 🏗 架构师：扫描代码库，综合多模型分析，输出架构蓝图和文件分配矩阵（v1.8.3+） |
| `team-qa.md` | `team-qa` | 🧪 QA 工程师：检测测试框架，编写测试，运行全量测试 + lint + typecheck（v1.8.3+） |
| `team-reviewer.md` | `team-reviewer` | 🔬 代码审查员：综合 Codex/Gemini 审查结果，分级输出 Critical/Warning/Info（v1.8.3+） |

---

## prompts/（19 个专家提示词）

专家提示词在 `codeagent-wrapper` 调用时通过 `--prompt-file` 注入，赋予模型特定领域角色。三组提示词覆盖相同角色，但针对各自模型的指令格式和上下文差异做了优化。

### claude/（6 个）

| 文件 | 角色 |
|------|------|
| `analyzer.md` | Claude 技术分析专家 |
| `architect.md` | Claude 系统架构师 |
| `debugger.md` | Claude 调试诊断专家 |
| `optimizer.md` | Claude 性能优化专家 |
| `reviewer.md` | Claude 代码审查员 |
| `tester.md` | Claude 测试工程师 |

### codex/（6 个）

| 文件 | 角色 |
|------|------|
| `analyzer.md` | Codex 后端技术分析 |
| `architect.md` | Codex 后端架构师 |
| `debugger.md` | Codex 后端调试专家 |
| `optimizer.md` | Codex 后端性能优化 |
| `reviewer.md` | Codex 后端代码审查 |
| `tester.md` | Codex 后端测试工程师 |

### gemini/（7 个，比 claude/codex 多 `frontend.md`）

| 文件 | 角色 |
|------|------|
| `analyzer.md` | Gemini 全栈技术分析 |
| `architect.md` | Gemini 前端架构师 |
| `debugger.md` | Gemini 前端调试专家 |
| `frontend.md` | Gemini 前端开发专家（Gemini 专属） |
| `optimizer.md` | Gemini 前端性能优化 |
| `reviewer.md` | Gemini 前端代码审查 |
| `tester.md` | Gemini 前端测试工程师 |

---

## skills/（100+ 技能文件，Skill Registry 驱动）

### 入口文件

| 文件 | 用途 |
|------|------|
| `SKILL.md` | Skill Registry 根入口，frontmatter `user-invocable: false`，描述目录结构与使用方式 |
| `run_skill.js` | 统一 Skill 运行时，`scripted` 类型技能通过 `node run_skill.js {name} $ARGUMENTS` 调用（路径于 v1.7.86 修正为 `~/.claude/skills/ccg/`） |

### tools/（质量关卡 + 工具）

由 `src/utils/installer.ts` 的 `installSkillFiles()` 递归复制，`user-invocable: true` 的自动生成 slash command。

| 目录 | slash command | 触发场景 |
|------|--------------|---------|
| `gen-docs/` | `/ccg:gen-docs` | 新建模块 → 生成 README.md + DESIGN.md 骨架 |
| `verify-module/` | `/ccg:verify-module` | 模块完成后 → 扫描结构完整性 |
| `verify-security/` | `/ccg:verify-security` | 新模块/安全变更/重构 → 漏洞扫描 |
| `verify-change/` | `/ccg:verify-change` | >30 行变更 → 文档同步状态分析 |
| `verify-quality/` | `/ccg:verify-quality` | 复杂模块/重构 → 复杂度/重复/命名检查 |
| `override-refusal/` | `/ccg:hi` | 会话级反拒绝覆写器 |
| `lib/` | 共享库 | `shared.js`：各 scripted 技能共用工具函数 |

**脚本文件分布**：
- `tools/verify-security/scripts/security_scanner.js`
- `tools/verify-module/scripts/module_scanner.js`
- `tools/verify-quality/scripts/quality_checker.js`
- `tools/verify-change/scripts/change_analyzer.js`
- `tools/gen-docs/scripts/doc_generator.js`
- `tools/lib/shared.js`

### domains/（10 大领域秘典）

纯知识型（`knowledge` 类型），触发关键词时 Claude 自动读取对应文件获取域专业知识（规则见 `rules/ccg-skill-routing.md`）。

#### security/（6 篇）

| 文件 | 触发关键词 |
|------|-----------|
| `red-team.md` | 渗透、红队、exploit、C2、免杀、持久化 |
| `blue-team.md` | 蓝队、告警、IOC、应急、取证、SIEM、EDR |
| `pentest.md` | Web 渗透、API 安全、OWASP、SQLi、XSS、SSRF |
| `code-audit.md` | 代码审计、危险函数、污点分析、sink |
| `vuln-research.md` | 二进制、逆向、PWN、Fuzzing、栈溢出、堆溢出 |
| `threat-intel.md` | OSINT、威胁情报、威胁建模、ATT&CK |

#### architecture/（5 篇 + SKILL.md）

`api-design.md` / `caching.md` / `cloud-native.md` / `message-queue.md` / `security-arch.md`

#### devops/（7 篇 + SKILL.md）

`git-workflow.md` / `testing.md` / `database.md` / `performance.md` / `observability.md` / `devsecops.md` / `cost-optimization.md`

#### ai/（4 篇 + SKILL.md）

`rag-system.md` / `agent-dev.md` / `llm-security.md` / `prompt-and-eval.md`

#### development/（7 篇 + SKILL.md）

`python.md` / `go.md` / `rust.md` / `typescript.md` / `java.md` / `cpp.md` / `shell.md`

#### frontend-design/（多文件，含 4 种设计风格）

**基础知识**：`ui-aesthetics.md` / `ux-principles.md` / `component-patterns.md` / `state-management.md` / `engineering.md`

**参考资料**（`reference/`）：`typography.md` / `color-and-contrast.md` / `interaction-design.md` / `motion-design.md` / `spatial-design.md` / `responsive-design.md` / `ux-writing.md`

**设计风格子技能**（各含 `SKILL.md` + `references/tokens.css`）：

| 目录 | 风格 | 触发词 |
|------|------|--------|
| `claymorphism/` | 黏土态 | claymorphism |
| `glassmorphism/` | 玻璃态 | glassmorphism |
| `liquid-glass/` | 液态玻璃 | liquid glass |
| `neubrutalism/` | 新野兽主义 | neubrutalism |

#### 其他 4 大领域（含 SKILL.md 入口）

| 目录 | 状态 |
|------|------|
| `infrastructure/` | SKILL.md 入口（详细知识文件待填充） |
| `mobile/` | SKILL.md 入口（详细知识文件待填充） |
| `data-engineering/` | SKILL.md 入口（详细知识文件待填充） |
| `orchestration/` | `multi-agent.md` + SKILL.md（多智能体协作规范） |

### impeccable/（20 个设计 playbook — v3.5.1 起收敛为 frontend-design 的知识模块，不再是独立命令）

每个 playbook 为独立子目录含 `SKILL.md`（部分含 `reference/`）。**v3.5.1 起全部 `user-invocable: false`**：曾经的 20 个 `/ccg:polish`/`critique`/… 平铺命令占了可调用命令的 65%，而它们已被 `/ccg:frontend-design` 完整融合。现统一由 `/ccg:frontend-design` 一个入口统领，各手法作为其 playbook 按需读取（`domains/frontend-design/SKILL.md` 的「Technique Playbooks」章节列出全部 20 个 + 读取路径）。文件保留、知识零丢失，仅不再各自生成 slash command。

`adapt` · `animate` · `arrange` · `audit` · `bolder` · `clarify` · `colorize` · `critique` · `delight` · `distill` · `extract` · `harden` · `normalize` · `onboard` · `optimize` · `overdrive` · `polish` · `quieter` · `teach-impeccable` · `typeset`

### scrapling/

网页抓取技能，支持 Cloudflare/WAF 绕过，触发词：`scrapling`，命令：`/ccg:scrapling`。

### orchestration/multi-agent/

多智能体协作规范（CCG 唯一权威定义）：角色分配、文件所有权锁、任务分解策略。安装后供 `~/.claude/CLAUDE.md` 中的 `skills/orchestration/multi-agent/SKILL.md` 引用。

---

## output-styles/（8 种输出风格）

由 `src/commands/menu.ts:installOutputStyle()` 安装到 `~/.claude/output-styles/`（不经过主 installer）。

| 文件 | 风格名 | 定位 |
|------|--------|------|
| `abyss-cultivator.md` | 邪修红尘仙·宿命深渊 | 末法邪修角色扮演，道语标签，劫数体系 |
| `abyss-command.md` | 铁律军令 | 令下即行，句句落地，只要动作与结果 |
| `abyss-concise.md` | 冷刃简报 | 言如冷刃，够用即可，不作空响 |
| `abyss-ritual.md` | 祭仪长卷 | 劫火为墨，深渊为纸，求势求压迫 |
| `engineer-professional.md` | 专业工程师 | 严格遵循 SOLID/KISS/DRY/YAGNI，面向资深开发者 |
| `laowang-engineer.md` | 老王暴躁技术流 | 一指禅打字，键步如飞，绝不容忍报错和不规范 |
| `nekomata-engineer.md` | 猫娘工程师幽浮喵 | 严谨工程师素养 + 可爱猫娘特质 |
| `ojousama-engineer.md` | 傲娇大小姐哈雷酱 | 严谨工程师素养 + 傲娇蓝发双马尾特质 |

---

## rules/（全局规则 → `~/.claude/rules/`）

由 `installRuleFiles()` 安装，安装后自动生效于所有 Claude Code 会话。

| 文件 | 职责 |
|------|------|
| `ccg-skills.md` | 质量关卡自动触发规则：新模块 → gen-docs → verify-module → verify-security；>30 行变更 → verify-change → verify-quality |
| `ccg-skill-routing.md` | 域知识路由规则（v2.0.0 新增）：关键词触发时自动 Read 对应 `domains/` 秘典，禁止凭训练记忆捏造域知识（v2.0.0+） |

---

## 模板变量系统

`src/utils/installer-template.ts:injectConfigVariables()` 在安装时将占位符替换为用户配置，所有替换在写入 `~/.claude/` 前完成，运行时不再有占位符。

| 占位符 | 默认替换值 | 说明 |
|--------|-----------|------|
| `{{FRONTEND_PRIMARY}}` | `gemini` | 前端主模型，可配置为 `codex`/`claude` |
| `{{BACKEND_PRIMARY}}` | `codex` | 后端主模型，可配置为 `gemini`/`claude` |
| `{{FRONTEND_MODELS}}` | `["gemini"]` | 前端模型列表（JSON 数组） |
| `{{BACKEND_MODELS}}` | `["codex"]` | 后端模型列表（JSON 数组） |
| `{{REVIEW_MODELS}}` | `["codex","gemini"]` | 审查模型列表（JSON 数组） |
| `{{GEMINI_MODEL_FLAG}}` | `--gemini-model gemini-3.1-pro-preview ` | 使用 gemini 时传给 wrapper，否则为空字符串（v2.1.14 修复：安装时替换，不留到运行时） |
| `{{LITE_MODE_FLAG}}` | `""` | 轻量模式时为 `--lite `，影响 codeagent-wrapper 行为 |
| `{{MCP_SEARCH_TOOL}}` | `mcp__ace-tool__search_context` | MCP provider 注册表驱动，支持 ace-tool/contextweaver/fast-context/skip |

**MCP provider 注册表**（`installer-template.ts:50`）：

```
ace-tool      → mcp__ace-tool__search_context        (param: query)
ace-tool-rs   → mcp__ace-tool__search_context        (param: query)
contextweaver → mcp__contextweaver__codebase-retrieval (param: information_request)
fast-context  → mcp__fast-context__fast_context_search (param: query)
skip          → 移除 MCP 调用，降级为 Glob + Grep 说明
```

---

## npm 发布范围（package.json `files`）

npm publish 精确白名单，以下路径打包发布：

```
bin/ccg.mjs
dist/                              # TypeScript 编译产物
templates/commands/*.md            # 29 个命令（逐一列出，无通配）
templates/commands/agents/         # 7 个子智能体（目录整体）
templates/prompts/codex/           # 目录整体
templates/prompts/gemini/*.md      # 7 个文件（逐一列出）
templates/prompts/claude/          # 目录整体
templates/output-styles/           # 目录整体
templates/skills/                  # 目录整体（含所有域知识 + impeccable）
templates/rules/                   # 目录整体
```

**未发布**：`templates/commands-v2/`、`templates/examples/`、源码 `src/`、测试、文档。

---

## commands-v2/ 与 examples/ 说明

**`commands-v2/`**：仅含一个空的 `agents/` 子目录（2026-03-25 创建），无任何 `.md` 文件。判断：v2 命令结构重构预留目录，尚处于空壳阶段，未进入实际开发，也不纳入 npm 发布。

**`examples/parallel-execution/`**：含 `.claude/tasks/user-auth-20260117-1430` 目录结构（无文件）。这是 `team-exec` 工作流产生的 `.claude/tasks/` 目录的示例结构，用于文档展示，不安装到用户环境。

---

## 关键设计决策

1. **模板变量安装时替换**（v2.1.14）：早期版本留有 `{{GEMINI_MODEL_FLAG}}` 运行时占位符，在部分场景被误判为字符串。v2.1.14 改为安装时全量替换，用户 `~/.claude/` 目录中永远是干净的已替换内容。

2. **Skill Registry frontmatter 驱动**（v2.0.0）：新增技能只需写 SKILL.md 并设 `user-invocable: true`，无需改 TypeScript 代码即可自动生成 slash command。`scripted` 技能（有 `scripts/*.js`）和 `knowledge` 技能（纯 Markdown）生成内容不同。

3. **commands/ vs skills/impeccable/**：`commands/` 是核心开发工作流命令，手动维护在 `installer-data.ts` 注册表中。`impeccable/` 曾通过 Skill Registry 各自注册为 `/ccg:` 命令，**v3.5.1 起全部 `user-invocable: false`**——收敛为 `/ccg:frontend-design` 的 playbook，不再生成独立命令（避免 20 个平铺命令淹没命令列表）。Skill Registry 仍扫描它们，只是 `installSkillCommands()` 只为 `user-invocable: true` 者生成命令。

4. **output-styles 独立安装路径**：与其他素材不同，output-styles 不经过主 `installWorkflows()` 管线，而是由菜单的 `installOutputStyle()` 按需安装到 `~/.claude/output-styles/`，允许用户按需切换风格而不重新全量安装。

5. **domains/ 知识文件不生成 slash command**：`user-invocable: false`，通过 `rules/ccg-skill-routing.md` 定义的关键词路由规则触发 Claude 主动 Read，而非用户显式调用命令。这保持了命令列表的简洁性。
