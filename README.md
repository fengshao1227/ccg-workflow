# 【开源缝合】CCG: Claude Code 编排三 CLI 协作

<div align="center">

**Claude Code 主导 + Codex CLI + Gemini CLI + Claude CLI 协作工作流系统**

[![npm version](https://img.shields.io/npm/v/ccg-workflow.svg)](https://www.npmjs.com/package/ccg-workflow) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT) [![Claude Code](https://img.shields.io/badge/Claude%20Code-Compatible-green.svg)](https://claude.ai/code) [![Codex CLI](https://img.shields.io/badge/Codex%20CLI-Supported-orange.svg)](https://github.com/openai/openai-python) [![Gemini CLI](https://img.shields.io/badge/Gemini%20CLI-Supported-purple.svg)](https://ai.google.dev/)

> **最新版本 v1.3.6**：修复 Codex API 客户端认证问题

</div>

---

## 🎉 最新更新

### v1.3.6 - Codex API 认证修复 🔧
- ✅ **环境变量开关**：新增 `CODEX_DISABLE_SKIP_GIT_CHECK` 环境变量
- ✅ **认证兼容**：修复部分用户 Codex API 返回 403 "Client not allowed" 错误
- ✅ **灵活配置**：保持默认行为，允许用户按需禁用 `--skip-git-repo-check`
- ✅ **故障排除**：README 添加完整的 Codex 认证问题解决方案

### v1.3.5 - MCP 工具选择功能 🎯
- ✅ **交互式选择**：新增 MCP 工具选择菜单（ace-tool / auggie / 跳过）
- ✅ **ace-tool**：推荐选项，开箱即用含 Prompt 增强 + 代码检索
- ✅ **auggie**：官方版本，代码检索 + 可选 Prompt 增强（提示配置教程）
- ✅ **灵活配置**：允许跳过 MCP 配置，稍后手动配置
- ✅ **智能保存**：用户选择自动保存到 `~/.ccg/config.toml`

### v1.3.4 - 默认语言修复 🌏
- ✅ **中文界面**：修复 `npx ccg-workflow` 默认显示英文的问题
- ✅ **默认设置**：将默认语言改为中文（zh-CN）
- ✅ **用户体验**：国内用户无需手动选择语言

<details>
<summary>v1.3.3 - Windows PATH 配置安全修复 (2026-01-05)</summary>

- ✅ **安全修复**：Windows PATH 配置改用安全追加方法，避免 `setx` 1024 字符限制
- ✅ **新方法**：使用 PowerShell `[System.Environment]::GetEnvironmentVariable` 先读取后追加
- ✅ **重复检测**：自动检查路径是否已存在，避免重复添加
- ✅ **无字符限制**：支持超长 PATH（最大 32767 字符）
- ✅ **向下兼容**：不影响现有用户配置
</details>

<details>
<summary>v1.3.2 - MCP 配置缺失修复 (2026-01-05)</summary>

- ✅ **关键修复**：安装后 `~/.ccg/config.toml` 现在包含完整的 `[mcp]` 配置部分
- ✅ **类型安全**：添加 `CcgConfig.mcp` TypeScript 接口定义
- ✅ **默认配置**：`createDefaultConfig` 自动生成完整 MCP 配置
- ✅ **配置版本**：配置文件版本号从 1.0.0 升级到 1.3.2
</details>

<details>
<summary>v1.3.1 - 命令模板修正 (2026-01-05)</summary>

- ✅ **说明修正**：澄清 auggie 也支持 Prompt 增强功能（需按教程配置）
- ✅ **模板更新**：修正 `/ccg:dev` 和 `/ccg:enhance` 命令的提示信息
- ✅ **配置说明**：`prompt_enhance_auggie = ""` 改为"留空表示未配置，按教程配置后填入工具名"
- ✅ **用户体验**：提供配置教程链接，不再误导用户认为 auggie 不支持 Prompt 增强
</details>

<details>
<summary>v1.3.0 - MCP 动态选择系统 (2026-01-05)</summary>

- ✅ **多 MCP 支持**：安装时可选 ace-tool（开箱即用Prompt增强+代码检索）或 auggie（官方原版，代码检索+可选Prompt增强）
- ✅ **交互式选择**：友好的 MCP 选择界面，对比功能差异，支持跳过安装
- ✅ **配置驱动**：生成 `~/.ccg/config.toml`，记录工具映射和参数名
- ✅ **自包含模板**：命令模板减少 50% 提示词长度，直接读取配置无需外部文档
- ✅ **完全兼容**：12个命令模板（dev, code, frontend, backend, review, analyze, enhance 等）支持动态 MCP 工具调用
- ✅ **灵活配置**：auggie 可通过配置支持 Prompt 增强（参考 [配置教程](https://linux.do/t/topic/1280612)）
</details>

<details>
<summary>查看历史版本 (v1.0.0 - v1.2.3)</summary>

### v1.2.3 - 安装体验优化
- 安装后自动验证 `codeagent-wrapper` 可用性
- 安装失败时显示详细错误信息和解决方案

### v1.2.0 - ROLE_FILE 动态注入
- `codeagent-wrapper` 自动识别 `ROLE_FILE:` 指令
- 专家提示词零 token 消耗，不占用主会话

### v1.1.3 - PATH 自动配置
- Mac/Linux 自动添加到 shell 配置文件
- Windows 提供 PowerShell 一键命令

### v1.1.0 - 智能更新系统
- 一键更新，无需卸载重装
- 保留用户配置和 MCP 设置

### v1.0.0 - npm 首次发布
- `npx ccg-workflow` 一键安装
- 三模型协作（Claude + Codex + Gemini）
- 18 个专家提示词

**完整变更记录**: [CHANGELOG.md](https://github.com/fengshao1227/ccg-workflow/blob/main/CHANGELOG.md)

</details>

---

## 架构说明

### Claude Code 主导的三 CLI 协作模式

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Code CLI (主导)                    │
│                  编排、决策、代码实施                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │  Codex CLI  │  │ Gemini CLI  │  │ Claude CLI  │        │
│  │  (后端原型) │  │  (前端原型) │  │  (全栈整合) │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                             │
│  通过 codeagent-wrapper 调用，返回 Unified Diff Patch      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**关键特性**：
- **Claude Code** 是主对话，负责编排整个工作流、做最终决策、实施代码
- **Codex/Gemini/Claude 子进程** 通过 `codeagent-wrapper` 调用，生成原型代码
- **零写入权限**：子进程只能返回 Unified Diff Patch，不能直接修改文件
- **脏原型处理**：子进程输出视为"脏原型"，需经 Claude Code 重构为生产级代码

---

## 核心特性

| 特性 | 描述 |
|------|------|
| **Claude Code 主导** | Claude Code CLI 作为编排者，Codex/Gemini/Claude 子进程协作 |
| **三 CLI 协作** | 同时调用 Codex CLI + Gemini CLI + Claude CLI 进行交叉验证 |
| **智能路由** | 前端任务 → Gemini，后端任务 → Codex，全栈整合 → Claude |
| **MCP 动态选择** | 安装时可选 ace-tool / auggie，命令模板自动适配，支持 Prompt 增强（ace-tool）或纯代码检索（auggie） |
| **6阶段工作流** | Prompt增强 → 上下文检索 → 三 CLI 分析 → 原型生成 → 代码实施 → 审计交付 |
| **18个专家提示词** | Codex 6个 + Gemini 6个 + Claude 6个角色 |
| **交互式安装** | npx 一键运行，图形化配置界面 |
| **跨平台** | 支持 macOS、Linux、Windows |

---

## 快速开始

### 方式一：npx 直接运行（推荐）

```bash
# 交互式配置安装
npx ccg-workflow

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

### 前置要求

- Node.js 18+
- Claude Code CLI
- Codex CLI / Gemini CLI（可选，用于多模型协作）

---

## 交互式菜单

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
1. 选择语言（中文/English）
2. **选择 MCP 代码检索工具**：✨ NEW
   - **[1] ace-tool**（推荐新手）：开箱即用，自动配置 Prompt 增强 + 代码检索
   - **[2] auggie**（官方原版）：代码检索 + 可选 Prompt 增强（需额外配置，[查看教程](https://linux.do/t/topic/1280612)）
   - **[0] 跳过**：稍后手动配置
3. 配置前端模型（Gemini/Codex/Claude）
4. 配置后端模型（Codex/Gemini/Claude）
5. 选择协作模式（并行/智能/顺序）
6. 选择要安装的工作流

### 更新到最新版

选择 **"更新工作流"**，系统将：
1. 🔍 检查 npm 最新版本
2. 📊 显示当前版本 vs 最新版本对比
3. 📥 自动更新所有命令模板和提示词
4. ✅ 保留用户配置和自定义内容

**特性**：
- ✅ 自动检测版本，有更新时提示
- ✅ 已是最新版本时，可选择"强制重装"修复损坏文件
- ✅ 无需 sudo 权限
- ✅ 无需卸载重装

---

## 使用

```bash
# 完整的多模型开发工作流（含 Prompt 增强）
/ccg:dev "实现用户认证功能"

# 智能路由代码生成
/ccg:code "添加用户注册表单"

# UltraThink 调试
/ccg:debug "登录接口返回 500 错误"

# 多模型测试生成
/ccg:test "为用户服务添加单元测试"

# 质量门控修复（90%+ 通过）
/ccg:bugfix "密码重置邮件发送失败"

# 深度分析
/ccg:think "评估微服务拆分方案"

# 性能优化
/ccg:optimize "优化首页加载速度"

# 前端任务 → Gemini
/ccg:frontend "创建登录表单组件"

# 后端任务 → Codex
/ccg:backend "实现 JWT 认证中间件"

# 双模型代码审查（无参数自动审查 git diff）
/ccg:review

# 双模型分析
/ccg:analyze "这个架构有什么问题？"

# 单独使用 Prompt 增强
/ccg:enhance "实现用户认证功能"

# Git 智能提交
/ccg:commit --emoji

# 交互式回滚
/ccg:rollback --branch main --target v1.0.0

# 清理已合并分支
/ccg:clean-branches --dry-run

# 创建 Worktree 并用 IDE 打开
/ccg:worktree add feature-ui -o

# 初始化项目 AI 上下文
/ccg:init "我的项目"
```

---

## 命令列表

### 开发工作流

| 命令 | 用途 | CLI 路由 |
|------|------|----------|
| `/ccg:dev` | 完整6阶段开发工作流（含Prompt增强） | ace-tool + Codex + Gemini + Claude |
| `/ccg:code` | 三 CLI 代码生成（智能路由） | 前端→Gemini / 后端→Codex / 整合→Claude |
| `/ccg:debug` | UltraThink 三 CLI 调试 | Codex + Gemini + Claude 并行诊断 |
| `/ccg:test` | 三 CLI 测试生成 | Codex 后端 + Gemini 前端 + Claude 集成 |
| `/ccg:bugfix` | 质量门控修复（90%+ 通过） | 三 CLI 交叉验证 |
| `/ccg:think` | 深度分析 | 三 CLI 并行分析 |
| `/ccg:optimize` | 性能优化 | Codex 后端 + Gemini 前端 + Claude 全栈 |
| `/ccg:frontend` | 前端/UI/样式任务 | Gemini + Claude 整合 |
| `/ccg:backend` | 后端/逻辑/算法任务 | Codex + Claude 整合 |
| `/ccg:review` | 代码审查（无参数自动审查 git diff） | Codex + Gemini + Claude |
| `/ccg:analyze` | 技术分析 | Codex + Gemini + Claude |
| `/ccg:enhance` | Prompt 增强 | ace-tool MCP |

### Git 工具

| 命令 | 用途 |
|------|------|
| `/ccg:commit` | 智能 commit：分析改动、生成 conventional commit 信息、支持 emoji |
| `/ccg:rollback` | 交互式回滚：列分支、列版本、二次确认后执行 reset/revert |
| `/ccg:clean-branches` | 清理分支：安全查找并清理已合并或过期的分支 |
| `/ccg:worktree` | Worktree 管理：在 `../.ccg/项目名/` 下创建，支持 IDE 集成 |

### 项目初始化

| 命令 | 用途 |
|------|------|
| `/ccg:init` | 初始化项目 AI 上下文，生成根级与模块级 CLAUDE.md 索引 |

---

## 工作流程

```
┌─────────────────────────────────────────────────────────────┐
│                      /ccg:dev 工作流                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Phase 0: Prompt 增强 (ace-tool prompt-enhancer)            │
│      ↓                                                      │
│  Phase 1: 上下文检索 (ace-tool codebase-retrieval)          │
│      ↓                                                      │
│  Phase 2: 三 CLI 分析 (Codex ∥ Gemini ∥ Claude) ← 并行     │
│      ↓                                                      │
│  Phase 3: 三 CLI 原型生成                                    │
│      ├── 前端任务 → Gemini CLI                              │
│      ├── 后端任务 → Codex CLI                               │
│      └── 全栈整合 → Claude CLI                              │
│      ↓                                                      │
│  Phase 4: 代码实施 (Claude Code 交叉验证后重构)             │
│      ↓                                                      │
│  Phase 5: 审计交付 (Codex ∥ Gemini ∥ Claude) ← 并行审查    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 安装目录结构

安装后会在 `~/.claude/` 和 `~/.ccg/` 下创建：

```
~/.claude/
├── commands/ccg/           # 斜杠命令
│   ├── _config.md          # 共享配置
│   ├── dev.md              # /ccg:dev 完整工作流
│   ├── code.md             # /ccg:code 多模型代码生成
│   ├── frontend.md         # /ccg:frontend 前端任务
│   ├── backend.md          # /ccg:backend 后端任务
│   └── ...                 # 其他命令
└── prompts/ccg/            # 角色提示词
    ├── codex/
    │   ├── architect.md    # 后端架构师
    │   ├── analyzer.md     # 技术分析师
    │   ├── debugger.md     # 调试专家
    │   ├── tester.md       # 测试工程师
    │   ├── reviewer.md     # 代码审查员
    │   └── optimizer.md    # 性能优化专家
    ├── gemini/
    │   ├── frontend.md     # 前端开发专家
    │   └── ...
    └── claude/
        └── ...

~/.ccg/
└── config.toml             # CCG 配置文件
```

---

## 配置文件

配置文件位于 `~/.ccg/config.toml`：

```toml
[general]
version = "1.3.1"
language = "zh-CN"

[mcp]
provider = "ace-tool"  # ace-tool | auggie | none
setup_url = "https://linux.do/t/topic/1280612"

[mcp.tools]
# 工具名称映射（配置驱动，命令模板自动适配）
code_search_ace = "mcp__ace-tool__search_context"
code_search_auggie = "mcp__auggie-mcp__codebase-retrieval"
prompt_enhance_ace = "mcp__ace-tool__enhance_prompt"
prompt_enhance_auggie = ""  # 留空表示未配置，按教程配置后填入工具名

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

---

## 更新

### 更新到最新版本

```bash
# 运行 CCG 菜单
npx ccg-workflow

# 选择 "更新工作流"
```

系统会自动：
1. 检查 npm 最新版本
2. 对比当前版本与最新版本
3. 更新所有命令模板（`~/.claude/commands/ccg/`）
4. 更新所有角色提示词（`~/.claude/prompts/ccg/`）
5. 保留用户配置（`~/.ccg/config.toml`）

### 强制修复损坏文件

如果已是最新版本但文件损坏，可选择"强制重新安装"：

```bash
npx ccg-workflow
# 选择 "更新工作流"
# 当提示"已是最新版本"时
# 选择 Yes 进行强制重装
```

---

## 卸载

```bash
# 交互式卸载
npx ccg-workflow
# 选择 "卸载 CCG"
```

或手动删除：

```bash
rm -rf ~/.claude/commands/ccg
rm -rf ~/.claude/prompts/ccg
rm -rf ~/.ccg
```

---

## 开发

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

---

## 调用语法

**HEREDOC 语法（推荐）**：
```bash
codeagent-wrapper --backend <codex|gemini|claude> - [工作目录] <<'EOF'
<任务内容>
EOF
```

**简单任务**：
```bash
codeagent-wrapper --backend codex "简单任务" [工作目录]
```

**恢复会话**：
```bash
codeagent-wrapper --backend codex resume <session_id> - <<'EOF'
<后续任务>
EOF
```

---

## 并行执行

使用 Claude Code 的 `run_in_background: true` 参数实现非阻塞并行：

```
# 启动后台任务（非阻塞）
Bash(run_in_background=true): codeagent-wrapper --backend codex ...
Bash(run_in_background=true): codeagent-wrapper --backend gemini ...

# 获取结果
TaskOutput: task_id=<task_id>
```

---

## 安全机制

- **零写入权限**：Codex/Gemini 对文件系统无写入权限
- **Unified Diff**：所有外部模型输出必须为 Unified Diff Patch 格式
- **脏原型处理**：外部模型输出视为"脏原型"，需经 Claude 重构
- **自动备份**：Patch Auggie MCP 时自动备份原文件

---

## CLI 分工

| CLI | 擅长领域 | 使用场景 |
|------|----------|----------|
| **Claude Code** | 编排、决策、代码实施 | 工作流控制、最终代码重构、交付 |
| **Gemini CLI** | 前端、UI/UX、视觉设计 | CSS、React、Vue 组件原型 |
| **Codex CLI** | 后端、算法、调试 | API、业务逻辑、性能优化原型 |
| **Claude CLI** | 全栈整合、交叉验证 | 契约设计、原型整合 |
| **ace-tool** | 代码检索、Prompt 增强 | 上下文获取、需求优化 |

---

## 专家系统提示词

调用外部 CLI 时动态注入相应的角色设定，确保输出质量和一致性。

### 18个角色文件

**Codex CLI 角色**（6个）：
- `prompts/codex/architect.md` - 后端架构师
- `prompts/codex/analyzer.md` - 技术分析师
- `prompts/codex/debugger.md` - 调试专家
- `prompts/codex/tester.md` - 测试工程师
- `prompts/codex/reviewer.md` - 代码审查员
- `prompts/codex/optimizer.md` - 性能优化专家

**Gemini CLI 角色**（6个）：
- `prompts/gemini/frontend.md` - 前端开发专家
- `prompts/gemini/analyzer.md` - 设计分析师
- `prompts/gemini/debugger.md` - UI调试专家
- `prompts/gemini/tester.md` - 前端测试工程师
- `prompts/gemini/reviewer.md` - UI审查员
- `prompts/gemini/optimizer.md` - 前端性能优化专家

**Claude CLI 角色**（6个）：
- `prompts/claude/architect.md` - 全栈架构师
- `prompts/claude/analyzer.md` - 综合分析师
- `prompts/claude/debugger.md` - 全栈调试专家
- `prompts/claude/tester.md` - 集成测试工程师
- `prompts/claude/reviewer.md` - 代码质量审查员
- `prompts/claude/optimizer.md` - 全栈性能优化专家

### 角色文件结构

每个命令根据任务类型注入不同的角色提示词：

| 命令 | Codex 角色 | Gemini 角色 | Claude 角色 |
|------|-----------|-------------|-------------|
| `/ccg:code`, `/ccg:backend` | `architect.md` | - | `architect.md` |
| `/ccg:frontend` | - | `frontend.md` | `architect.md` |
| `/ccg:analyze`, `/ccg:think`, `/ccg:dev` | `analyzer.md` | `analyzer.md` | `analyzer.md` |
| `/ccg:debug` | `debugger.md` | `debugger.md` | `debugger.md` |
| `/ccg:test` | `tester.md` | `tester.md` | `tester.md` |
| `/ccg:review`, `/ccg:bugfix` | `reviewer.md` | `reviewer.md` | `reviewer.md` |
| `/ccg:optimize` | `optimizer.md` | `optimizer.md` | `optimizer.md` |

### 动态角色注入

命令执行时，将角色文件内容注入到 `<ROLE>` 标签中：

```bash
codeagent-wrapper --backend codex - $PROJECT_DIR <<'EOF'
<ROLE>
# 读取 prompts/codex/architect.md 的内容并注入
</ROLE>

<TASK>
实现后端逻辑: <任务描述>

Context:
<相关代码>
</TASK>

OUTPUT: Unified Diff Patch ONLY.
EOF
```

### 完整提示词文件

- **Codex CLI 角色**: `prompts/codex/` 目录下的 6 个文件
- **Gemini CLI 角色**: `prompts/gemini/` 目录下的 6 个文件
- **Claude CLI 角色**: `prompts/claude/` 目录下的 6 个文件

---

## 常见问题

<details>
<summary><strong>Q: Codex API 返回 403 "Client not allowed" 错误</strong></summary>

**问题描述**：
```json
{
  "error": "Client not allowed",
  "message": "Your client is not authorized to use this API key"
}
```

**原因**：Codex API 对客户端验证有严格限制，`--skip-git-repo-check` 参数可能触发不同的认证逻辑。

**解决方案 1：禁用 git-repo-check（推荐）**

设置环境变量来禁用该参数：
```bash
# 临时禁用
export CODEX_DISABLE_SKIP_GIT_CHECK=true
/ccg:dev "your task"

# 永久禁用（添加到 ~/.zshrc 或 ~/.bashrc）
echo 'export CODEX_DISABLE_SKIP_GIT_CHECK=true' >> ~/.zshrc
source ~/.zshrc
```

**解决方案 2：检查 Codex 配置**

如果方案 1 无效，检查 Codex CLI 配置：
```bash
# 重新登录 Codex
codex logout
codex login

# 验证直接调用是否正常
codex e "test task"
```

**解决方案 3：更新 Codex CLI**

```bash
# 更新到最新版本
pip install --upgrade codex-cli
# 或
npm install -g @codex/cli
```
</details>

<details>
<summary><strong>Q: codex 总是思考太久超时该怎么办？</strong></summary>

**问题描述**：在使用 `/ccg:dev` 等命令时，Codex 后端思考时间过长，导致超时。

**解决方案**：
- 参考社区讨论：[linux.do - Codex 超时问题解决方案](https://linux.do/t/topic/1405588/256?u=feng_li)

**常见优化方法**：
- 减少任务复杂度，拆分为更小的子任务
- 调整 Codex CLI 的超时配置
- 使用 `--backend gemini` 切换到 Gemini 后端测试
</details>

<details>
<summary><strong>Q: 如何更新到最新版本？</strong></summary>

**一键更新，无需卸载重装**：
```bash
npx ccg-workflow
# 选择 "更新工作流"
```

更新会自动：
- 检测 npm 最新版本
- 增量更新命令模板和提示词
- 保留用户配置和 MCP 设置
</details>

<details>
<summary><strong>Q: MCP 动态选择系统是什么？</strong></summary>

**v1.3.0 核心特性**：安装时可以选择：
- **ace-tool**（第三方）：开箱即用，包含 Prompt 增强 + 代码检索
- **auggie**（官方）：代码检索 + 可选 Prompt 增强（需配置）

命令模板会根据配置自动适配对应的 MCP 工具调用。
</details>

<details>
<summary><strong>Q: codeagent-wrapper 是什么？</strong></summary>

来自 [cexll/myclaude](https://github.com/cexll/myclaude) 的 Go 工具，封装了多 CLI 调用：
- 支持 `--backend codex/gemini/claude` 切换
- 会话管理（SESSION_ID）
- ROLE_FILE 动态注入
- 自动安装到 `~/.claude/bin/`
</details>

<details>
<summary><strong>更多问题？</strong></summary>

查看完整讨论和 Q&A：
- [linux.do 社区讨论帖](https://linux.do/t/topic/1405588) - 包含 11 个常见问题的详细解答
- [GitHub Issues](https://github.com/fengshao1227/ccg-workflow/issues) - 提交问题和建议
</details>

---

## 📄 许可证

本项目采用 [MIT License](LICENSE) 开源协议。

Copyright (c) 2025 fengshao1227

---

## 致谢

- **[cexll/myclaude](https://github.com/cexll/myclaude)** - codeagent-wrapper 多后端调用工具的 Go 代码来源，以及 `/ccg:code`、`/ccg:debug`、`/ccg:test`、`/ccg:bugfix`、`/ccg:think`、`/ccg:optimize` 命令的设计参考
- **[UfoMiao/zcf](https://github.com/UfoMiao/zcf)** - Git 工具（commit、rollback、clean-branches、worktree）和项目初始化（init）命令来源
- **[GudaStudio/skills](https://github.com/GuDaStudio/skills)** - 智能路由（前端→Gemini、后端→Codex）的设计理念
- **[ace-tool MCP](https://linux.do/t/topic/1344562)** - [@mistripple](https://linux.do/u/mistripple) 的 ace-tool 轻量级代码检索和 Prompt 增强方案
