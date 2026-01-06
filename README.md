# CCG - Claude + Codex + Gemini 多模型协作系统

<div align="center">

**Claude Code 编排 Codex + Gemini 双模型协作的智能开发工作流系统**

[![npm version](https://img.shields.io/npm/v/ccg-workflow.svg)](https://www.npmjs.com/package/ccg-workflow)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-Compatible-green.svg)](https://claude.ai/code)
[![Codex CLI](https://img.shields.io/badge/Codex%20CLI-Supported-orange.svg)](https://github.com/openai/openai-python)
[![Gemini CLI](https://img.shields.io/badge/Gemini%20CLI-Supported-purple.svg)](https://ai.google.dev/)

> **最新版本 v1.4.2** - Windows MCP 配置自动修复 + 诊断工具

[快速开始](#-快速开始) • [命令参考](#-命令参考) • [常见问题](#-常见问题) • [更新日志](CHANGELOG.md)

</div>

---

## 📖 目录

- [核心理念](#-核心理念)
- [架构说明](#-架构说明)
- [核心特性](#-核心特性)
- [快速开始](#-快速开始)
- [安装指南](#-安装指南)
- [命令参考](#-命令参考)
- [工作流详解](#-工作流详解)
- [专家角色系统](#-专家角色系统)
- [配置文件](#-配置文件)
- [常见问题](#-常见问题)
- [开发指南](#-开发指南)
- [致谢](#-致谢)

---

## 💡 核心理念

CCG = **Claude Code** (主导编排) + **Codex CLI** (后端原型) + **Gemini CLI** (前端原型)

### 设计哲学

让 Claude Code 专注于编排决策和代码实施，把具体的代码生成交给专业模型：
- **前端任务** → Gemini（视觉设计、组件原型）
- **后端任务** → Codex（逻辑运算、算法调试）
- **全栈整合** → Claude（工作流控制、代码主权）

### 核心优势

| 优势 | 说明 |
|-----|------|
| **智能路由** | 根据任务类型自动选择最合适的模型 |
| **交叉验证** | 双模型并行生成，相互验证减少错误 |
| **零写入权限** | 外部模型只能返回 Patch，Claude 保持代码主权 |
| **Token 优化** | ROLE_FILE 动态注入，专家提示词零 token 消耗 |

---

## 🏗️ 架构说明

```
┌─────────────────────────────────────────────────┐
│          Claude Code CLI (主导编排)              │
│        决策、编排、代码实施、质量把控             │
└──────────────┬──────────────────────────────────┘
               │
       ┌───────┴────────┐
       │                │
       ↓                ↓
┌─────────────┐  ┌─────────────┐
│  Codex CLI  │  │ Gemini CLI  │
│  后端原型   │  │  前端原型   │
│  逻辑算法   │  │  UI 组件    │
└─────────────┘  └─────────────┘
       │                │
       └────────┬───────┘
                ↓
      Unified Diff Patch
    (只读，不能直接修改文件)
```

### 安全机制

- **零写入权限**：Codex/Gemini 对文件系统无写入权限
- **Unified Diff**：所有外部模型输出必须为 Patch 格式
- **脏原型处理**：外部模型输出视为"脏原型"，需经 Claude 重构

---

## ✨ 核心特性

| 特性 | 描述 |
|------|------|
| **智能路由** | 前端任务→Gemini，后端任务→Codex，全栈整合→Claude |
| **双模型并行** | Codex ∥ Gemini 同时调用，交叉验证结果 |
| **MCP 动态选择** | 安装时可选 ace-tool（开箱即用）/ auggie（官方版本）|
| **6阶段工作流** | Prompt增强 → 代码检索 → 分析 → 原型 → 实施 → 审计 |
| **18个专家提示词** | Codex 6个 + Gemini 6个 + Claude 6个 |
| **Git 自动化** | 智能 commit、交互式回滚、分支清理、Worktree 管理 |
| **npx 一键安装** | 无需全局安装，交互式配置菜单 |
| **跨平台支持** | macOS、Linux、Windows |

---

## 🚀 快速开始

### 前置要求

1. **必需**：
   - [Claude Code CLI](https://claude.ai/code) - 主导编排
   - Node.js 18+

2. **可选**（根据需求）：
   - [Codex CLI](https://github.com/openai/openai-codeinterpreter) - 后端任务
   - [Gemini CLI](https://github.com/google/generative-ai-cli) - 前端任务

### 方式一：npx 直接运行（推荐）

```bash
# 交互式安装
npx ccg-workflow

# 选择 "初始化工作流"
# 选择语言（中文 / English）
# 选择 MCP 工具（推荐 ace-tool）
# 等待安装完成（约 1-2 分钟）
# 重启终端
```

### 方式二：全局安装

```bash
npm install -g ccg-workflow
ccg
```

### 方式三：源码安装

```bash
git clone https://github.com/fengshao1227/ccg-workflow.git
cd ccg-workflow/skills-v2
pnpm install && pnpm build
pnpm start
```

### 验证安装

```bash
# 检查 codeagent-wrapper 是否可用
codeagent-wrapper --version

# 应该显示类似：codeagent-wrapper v5.4.0

# 检查配置文件
cat ~/.claude/.ccg/config.toml

# 检查命令是否安装
ls ~/.claude/commands/ccg/
```

---

## 📦 安装指南

### 交互式菜单

运行后会显示交互式菜单：

```
  CCG - Claude + Codex + Gemini
  Multi-Model Collaboration System

? CCG 主菜单
❯ ➜ 初始化 CCG 配置
  ➜ 更新工作流
  ➜ 卸载 CCG
  ? 帮助
  ✕ 退出
```

### 首次安装

选择 **"初始化 CCG 配置"** 进行首次安装，会引导你：

1. **选择语言**（中文/English）
2. **选择 MCP 工具**：
   - **[1] ace-tool**（推荐新手）：开箱即用，自动配置 Prompt 增强 + 代码检索
   - **[2] auggie**（官方原版）：代码检索 + 可选 Prompt 增强（需额外配置，[查看教程](https://linux.do/t/topic/1280612)）
   - **[0] 跳过**：稍后手动配置
3. **自动检测旧版本并迁移**（v1.3.x → v1.4.x）
4. **安装命令模板和提示词**
5. **配置 PATH 环境变量**

### 更新到最新版

选择 **"更新工作流"**，系统将：
1. 🔍 检查 npm 最新版本
2. 📊 显示当前版本 vs 最新版本对比
3. 📥 自动更新所有命令模板和提示词
4. ✅ 保留用户配置和自定义内容
5. 🔄 自动迁移旧版本目录结构

**特性**：
- ✅ 自动检测版本，有更新时提示
- ✅ 已是最新版本时，可选择"强制重装"修复损坏文件
- ✅ 无需 sudo 权限
- ✅ 无需卸载重装

### 卸载

```bash
# 交互式卸载
npx ccg-workflow
# 选择 "卸载 CCG"
```

会删除：
- `~/.claude/commands/ccg/` 命令文件
- `~/.claude/agents/ccg/` 子智能体
- `~/.claude/bin/codeagent-wrapper` 二进制
- `~/.claude/.ccg/` 配置目录（可选保留）

---

## 📚 命令参考

### 开发工作流命令

| 命令 | 用途 | 模型路由 |
|-----|------|---------|
| `/ccg:dev` | 完整6阶段开发工作流（Prompt增强+代码检索+分析+原型+实施+审计）| MCP + Codex + Gemini |
| `/ccg:code` | 智能代码生成（自动路由前端/后端）| 前端→Gemini / 后端→Codex |
| `/ccg:frontend` | 前端/UI/样式任务 | Gemini |
| `/ccg:backend` | 后端/逻辑/算法任务 | Codex |
| `/ccg:debug` | UltraThink 多模型调试（5阶段）| Codex + Gemini 并行 |
| `/ccg:test` | 多模型测试生成 | Codex + Gemini 并行 |
| `/ccg:bugfix` | 质量门控修复（90%+ 通过才算完成）| Codex + Gemini 交叉验证 |
| `/ccg:optimize` | 性能优化 | Codex + Gemini 并行 |
| `/ccg:review` | 代码审查（无参数自动审查 git diff）| Codex + Gemini 并行 |
| `/ccg:analyze` | 技术分析 | Codex + Gemini 并行 |
| `/ccg:think` | 深度分析 | Codex + Gemini 并行 |
| `/ccg:enhance` | Prompt 增强 | ace-tool MCP |
| `/ccg:scan` | 智能仓库扫描：生成项目上下文报告 | 分析项目结构 |
| `/ccg:feat` | 智能功能开发：规划 → 实施 → 审查全流程 | 多模型协作 |

### Git 工具命令

| 命令 | 用途 |
|-----|------|
| `/ccg:commit` | 智能 commit：分析改动，生成 conventional commit 信息 |
| `/ccg:rollback` | 交互式回滚：列分支、列版本、二次确认 |
| `/ccg:clean-branches` | 分支清理：安全查找并清理已合并分支（支持 dry-run）|
| `/ccg:worktree` | Worktree 管理：在 `../.ccg/项目名/` 下创建 |

### 项目初始化

| 命令 | 用途 |
|-----|------|
| `/ccg:init` | 初始化项目 AI 上下文，生成 CLAUDE.md 索引 |

---

## 🔄 工作流详解

### /ccg:dev - 完整6阶段开发工作流

```
┌─────────────────────────────────────────┐
│   Phase 0: Prompt 增强 (MCP)            │
│   优化用户输入，补充技术细节             │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│   Phase 1: 代码检索 (MCP)               │
│   获取相关代码上下文                     │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│   Phase 2: 多模型分析                    │
│   Codex (后端) ∥ Gemini (前端) 并行     │
│   交叉验证技术方案                       │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│   Phase 3: 原型生成                      │
│   前端 → Gemini / 后端 → Codex          │
│   输出 Unified Diff Patch               │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│   Phase 4: 代码实施 (Claude 主导)       │
│   重构为生产级代码并应用                 │
└────────────────┬────────────────────────┘
                 ↓
┌─────────────────────────────────────────┐
│   Phase 5: 审计交付                      │
│   Codex ∥ Gemini 交叉验证代码质量       │
└─────────────────────────────────────────┘
```

### 使用示例

```bash
# 在 Claude Code 中执行
/ccg:dev 实现用户登录功能

# 系统会自动：
# 1. 增强 Prompt（补充技术细节、最佳实践）
# 2. 检索相关代码（认证模块、数据库模型）
# 3. 双模型分析（Codex 分析后端逻辑 ∥ Gemini 分析前端表单）
# 4. 生成原型（Codex 生成 API ∥ Gemini 生成登录表单）
# 5. Claude 重构并应用代码
# 6. 双模型审查（Codex 检查安全性 ∥ Gemini 检查 UI/UX）
```

---

## 🎭 专家角色系统

### 核心机制：ROLE_FILE 动态注入

18个专家提示词（Codex 6个 + Gemini 6个 + Claude 6个），采用 **零 token 消耗** 的 ROLE_FILE 动态注入机制：

- ✅ 每个命令自动注入对应角色提示词
- ✅ 不占用主会话 token
- ✅ 无需手动配置全局提示词

### 角色映射表

| 命令 | Codex 角色 | Gemini 角色 | Claude 角色 |
|------|-----------|------------|------------|
| `/ccg:code`, `/ccg:backend` | architect.md（后端架构师）| - | - |
| `/ccg:frontend` | - | frontend.md（前端架构师）| - |
| `/ccg:analyze`, `/ccg:think` | analyzer.md | analyzer.md | analyzer.md |
| `/ccg:debug` | debugger.md | debugger.md | debugger.md |
| `/ccg:test` | tester.md | tester.md | tester.md |
| `/ccg:review`, `/ccg:bugfix` | reviewer.md | reviewer.md | reviewer.md |
| `/ccg:optimize` | optimizer.md | optimizer.md | optimizer.md |

### 提示词文件结构

```
~/.claude/.ccg/prompts/
├── codex/         # Codex CLI 后端专家（6个）
│   ├── architect.md    # 后端架构师
│   ├── analyzer.md     # 技术分析师
│   ├── debugger.md     # 调试专家
│   ├── optimizer.md    # 性能优化师
│   ├── reviewer.md     # 代码审查员
│   └── tester.md       # 测试工程师
├── gemini/        # Gemini CLI 前端专家（6个）
│   ├── frontend.md     # 前端架构师
│   ├── analyzer.md     # UI/UX 分析师
│   ├── debugger.md     # 前端调试专家
│   ├── optimizer.md    # 前端性能优化
│   ├── reviewer.md     # 代码审查员
│   └── tester.md       # 前端测试工程师
└── claude/        # Claude CLI 全栈专家（6个）
    ├── architect.md    # 全栈架构师
    ├── analyzer.md     # 系统分析师
    ├── debugger.md     # 全栈调试专家
    ├── optimizer.md    # 系统优化师
    ├── reviewer.md     # 高级审查员
    └── tester.md       # 集成测试工程师
```

### 动态注入示例

```bash
codeagent-wrapper --backend codex - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/codex/architect.md

<TASK>
实现后端逻辑: 用户登录 API

Context:
现有代码...
</TASK>

OUTPUT: Unified Diff Patch ONLY. Strictly prohibit any actual modifications.
EOF
```

---

## ⚙️ 配置文件

配置文件位于 `~/.claude/.ccg/config.toml`：

```toml
[general]
version = "1.4.1"
language = "zh-CN"

[mcp]
provider = "ace-tool"  # ace-tool | auggie | none
setup_url = "https://linux.do/t/topic/1280612"

[mcp.tools]
# 工具名称映射（配置驱动，命令模板自动适配）
code_search_ace = "mcp__ace-tool__search_context"
code_search_auggie = "mcp__auggie-mcp__codebase-retrieval"
prompt_enhance_ace = "mcp__ace-tool__enhance_prompt"
prompt_enhance_auggie = ""  # 留空表示未配置

# 参数名映射
query_param_ace = "query"
query_param_auggie = "information_request"

[routing]
mode = "smart"  # smart | parallel | sequential

[routing.frontend]
models = ["gemini", "codex", "claude"]
primary = "gemini"
strategy = "parallel"

[routing.backend]
models = ["codex", "gemini", "claude"]
primary = "codex"
strategy = "parallel"

[routing.review]
models = ["codex", "gemini", "claude"]
strategy = "parallel"
```

### 配置说明

| 配置项 | 说明 |
|-------|------|
| `mcp.provider` | MCP 工具提供商（ace-tool / auggie / none）|
| `routing.mode` | 路由模式（smart: 智能路由 / parallel: 并行 / sequential: 顺序）|
| `routing.frontend.models` | 前端任务使用的模型列表 |
| `routing.backend.models` | 后端任务使用的模型列表 |
| `routing.*.strategy` | 执行策略（parallel: 并行 / fallback: 回退）|

---

## 🗂️ 安装目录结构

安装后的完整目录结构：

```
~/.claude/
├── commands/ccg/           # ✅ CC 读取的 slash commands
│   ├── dev.md
│   ├── code.md
│   ├── frontend.md
│   ├── backend.md
│   ├── debug.md
│   ├── test.md
│   ├── bugfix.md
│   ├── review.md
│   ├── optimize.md
│   ├── analyze.md
│   ├── think.md
│   ├── enhance.md
│   ├── scan.md
│   ├── feat.md
│   ├── commit.md
│   ├── rollback.md
│   ├── clean-branches.md
│   ├── worktree.md
│   └── init.md
├── agents/ccg/             # ✅ CC 读取的 subagents
│   ├── planner.md
│   ├── ui-ux-designer.md
│   ├── init-architect.md
│   └── get-current-datetime.md
├── bin/                    # ✅ 二进制文件
│   └── codeagent-wrapper
└── .ccg/                   # ✅ CCG 配置目录（CC 不读取）
    ├── config.toml         # 主配置文件
    ├── shared-config.md    # 共享配置
    ├── backup/             # 备份目录
    └── prompts/            # 专家提示词
        ├── codex/
        ├── gemini/
        └── claude/
```

---

## ❓ 常见问题

<details>
<summary><strong>Q1: 如何更新到最新版本？</strong></summary>

一键更新，无需卸载重装：
```bash
npx ccg-workflow
# 选择 "更新工作流"
```

更新会自动：
- 检测 npm 最新版本
- 增量更新命令模板和提示词
- 保留用户配置和 MCP 设置
- 自动迁移旧版本目录结构（v1.3.x → v1.4.x）
</details>

<details>
<summary><strong>Q2: v1.4.0 目录迁移会影响我吗？</strong></summary>

**不会影响**，系统会自动迁移：

安装/更新时会自动：
1. 检测旧版本目录（`~/.ccg/`, `~/.claude/prompts/ccg/`）
2. 迁移所有文件到新位置（`~/.claude/.ccg/`）
3. 清理旧目录（安全检查后）
4. 显示迁移报告

手动迁移（如果需要）：
```bash
# 旧版本 → 新版本
~/.ccg/ → ~/.claude/.ccg/
~/.claude/prompts/ccg/ → ~/.claude/.ccg/prompts/
~/.claude/commands/ccg/_config.md → ~/.claude/.ccg/shared-config.md
```
</details>

<details>
<summary><strong>Q3: MCP 动态选择系统是什么？</strong></summary>

v1.3.0 核心特性，安装时可以选择：
- **ace-tool**（第三方）：开箱即用，包含 Prompt 增强 + 代码检索
- **auggie**（官方）：代码检索 + 可选 Prompt 增强（需配置）

命令模板会根据配置自动适配对应的 MCP 工具调用。

切换方法：编辑 `~/.claude/.ccg/config.toml`：
```toml
[mcp]
provider = "ace-tool"  # 或 "auggie"
```
</details>

<details>
<summary><strong>Q4: codeagent-wrapper 是什么？</strong></summary>

来自 [cexll/myclaude](https://github.com/cexll/myclaude) 的 Go 工具，封装了多 CLI 调用：
- 支持 `--backend codex/gemini/claude` 切换
- 会话管理（SESSION_ID）
- ROLE_FILE 动态注入
- 自动安装到 `~/.claude/bin/`

调用语法：
```bash
codeagent-wrapper --backend <codex|gemini|claude> - [工作目录] <<'EOF'
<任务内容>
EOF
```
</details>

<details>
<summary><strong>Q5: 如何切换 MCP 工具（ace-tool ↔ auggie）？</strong></summary>

手动编辑配置文件 `~/.claude/.ccg/config.toml`：

```toml
[mcp]
provider = "ace-tool"  # 或 "auggie"
```

然后重新运行 `/ccg:dev` 等命令即可。
</details>

<details>
<summary><strong>Q6: ROLE_FILE 动态注入如何工作？</strong></summary>

`codeagent-wrapper` 会自动识别命令中的 `ROLE_FILE:` 指令：

```bash
ROLE_FILE: ~/.claude/.ccg/prompts/codex/architect.md
```

工具会读取文件内容并注入到外部 CLI（Codex/Gemini）的系统提示词中，零 token 消耗。
</details>

<details>
<summary><strong>Q7: 为什么需要 Codex CLI / Gemini CLI？</strong></summary>

**核心理念**：让 Claude 专注于编排决策，把具体代码生成交给专业模型。

- **Codex**：后端逻辑、算法、调试能力强
- **Gemini**：前端 UI、组件、样式能力强
- **Claude**：全栈整合、质量把控、编排能力强

如果只有 Claude Code，系统会降级为纯 Claude 工作流。
</details>

<details>
<summary><strong>Q8: Codex 总是思考太久超时该怎么办？</strong></summary>

**问题描述**：使用 `/ccg:dev` 等命令时，Codex 后端思考时间过长，导致超时。

**解决方案**：
- 参考社区讨论：[linux.do - Codex 超时问题](https://linux.do/t/topic/1405588/256?u=feng_li)

**常见优化方法**：
- 减少任务复杂度，拆分为更小的子任务
- 调整 Codex CLI 的超时配置
- 使用 `--backend gemini` 切换到 Gemini 后端测试
</details>

<details>
<summary><strong>Q9: 安装后提示 "codeagent-wrapper: command not found"？</strong></summary>

**原因**：PATH 未生效。

**解决方案**：

Mac/Linux：
```bash
# 重启终端或执行
source ~/.zshrc
# 或
source ~/.bashrc
```

Windows：
```powershell
# 重新打开 PowerShell
# 或手动添加到环境变量：
# %USERPROFILE%\.claude\bin
```
</details>

<details>
<summary><strong>Q10: 如何卸载 CCG 系统？</strong></summary>

```bash
npx ccg-workflow
# 选择 "卸载工作流"
```

卸载会：
- 删除 `~/.claude/commands/ccg/` 命令文件
- 删除 `~/.claude/agents/ccg/` 子智能体
- 删除 `~/.claude/bin/codeagent-wrapper` 二进制
- 删除 `~/.claude/.ccg/` 配置目录（可选保留）
</details>

<details>
<summary><strong>Q11: auggie 如何配置 Prompt 增强功能？</strong></summary>

auggie 默认只有代码检索功能，要启用 Prompt 增强需要额外配置：

参考教程：[linux.do - auggie Prompt 增强配置](https://linux.do/t/topic/1280612)

配置完成后，编辑 `~/.claude/.ccg/config.toml`：
```toml
[mcp.tools]
prompt_enhance_auggie = "mcp__auggie__enhance_prompt"  # 填入配置的工具名
```
</details>

---

## 🛠️ 开发指南

### 本地开发

```bash
# 克隆仓库
git clone https://github.com/fengshao1227/ccg-workflow.git
cd ccg-workflow/skills-v2

# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build

# 本地测试
pnpm start

# 类型检查
pnpm typecheck

# 代码检查
pnpm lint
```

### 项目结构

```
skills-v2/
├── src/                    # TypeScript 源码
│   ├── commands/          # CLI 命令
│   │   ├── init.ts       # 初始化命令
│   │   ├── menu.ts       # 主菜单
│   │   └── update.ts     # 更新命令
│   ├── utils/             # 工具函数
│   │   ├── installer.ts  # 安装器
│   │   ├── migration.ts  # 迁移脚本
│   │   ├── config.ts     # 配置管理
│   │   └── version.ts    # 版本管理
│   ├── i18n/              # 国际化
│   ├── types.ts           # TypeScript 类型
│   ├── cli.ts             # CLI 入口
│   └── index.ts           # 导出
├── templates/              # 安装模板
│   ├── commands/          # 命令模板
│   ├── config/            # 配置模板
│   └── prompts/           # 提示词模板
├── bin/                    # 预编译二进制
│   └── codeagent-wrapper-*
├── dist/                   # 构建输出
├── package.json
└── README.md
```

### 发布流程

```bash
# 1. 更新版本号（package.json）
# "version": "1.4.x" → "1.4.y"

# 2. 构建并发布
pnpm build
npm publish

# 3. 提交到 Git
git add -A
git commit -m "chore: bump version to x.y.z"
git push origin main
```

---

## 🙏 致谢

感谢以下开源项目的贡献：

- **[cexll/myclaude](https://github.com/cexll/myclaude)** - `codeagent-wrapper` 多后端调用工具的 Go 代码来源，以及 `/ccg:code`、`/ccg:debug`、`/ccg:test`、`/ccg:bugfix`、`/ccg:think`、`/ccg:optimize` 命令的设计参考
- **[UfoMiao/zcf](https://github.com/UfoMiao/zcf)** - Git 工具（commit、rollback、clean-branches、worktree）和项目初始化（init）命令来源
- **[GudaStudio/skills](https://github.com/GuDaStudio/skills)** - 智能路由（前端→Gemini、后端→Codex）的设计理念
- **[ace-tool MCP](https://linux.do/t/topic/1344562)** - [@mistripple](https://linux.do/u/mistripple) 的轻量级代码检索和 Prompt 增强方案
- **[linux.do 社区](https://linux.do/)** - 活跃的 Claude Code 中文社区

---

## 💬 支持与反馈

- **GitHub Issues**: [提交问题](https://github.com/fengshao1227/ccg-workflow/issues)
- **讨论社区**: [linux.do - CCG 讨论帖](https://linux.do/t/topic/1405588)
- **完整文档**: [README.md](https://github.com/fengshao1227/ccg-workflow/blob/main/README.md)

---

## 📄 许可证

本项目采用 [MIT License](LICENSE) 开源协议。

Copyright (c) 2025 fengshao1227

---

<div align="center">

**最后更新**: 2026-01-06 | **版本**: v1.4.1

Made with ❤️ by the CCG Community

</div>
