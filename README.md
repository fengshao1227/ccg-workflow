# CCG - Claude + Codex + Gemini 多模型协作系统

<div align="center">

**Claude Code 编排 Codex + Gemini 双模型协作的智能开发工作流系统**

[![npm version](https://img.shields.io/npm/v/ccg-workflow.svg)](https://www.npmjs.com/package/ccg-workflow)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-Compatible-green.svg)](https://claude.ai/code)
[![Codex CLI](https://img.shields.io/badge/Codex%20CLI-Supported-orange.svg)](https://github.com/openai/openai-python)
[![Gemini CLI](https://img.shields.io/badge/Gemini%20CLI-Supported-purple.svg)](https://ai.google.dev/)

> 🎉 **Windows MCP 自动修复** - 彻底解决 Windows 用户 MCP 安装问题！

[快速开始](#-快速开始) • [命令参考](#-命令参考) • [常见问题](#-常见问题) • [更新日志](CHANGELOG.md)

</div>

---

## 🎯 v1.6.0 重大改进

### ✨ 多模型并行增强

**backend/frontend 命令现已支持多模型并行分析和审计**

- ✅ `/ccg:backend` - 后端专家也能享受多模型交叉验证（Codex + Gemini 并行）
- ✅ `/ccg:frontend` - 前端专家也能享受多模型交叉验证（Gemini + Claude 并行）
- ✅ **5阶段工作流** - 上下文检索 → 多模型分析 → 原型生成 → 重构实施 → 多模型审计

### 配置简化

**MCP 安装流程优化**

- ✅ **只保留 ace-tool** - 移除 auggie 安装选项，简化选择流程
- ✅ **中转服务支持** - 添加 linux.do 社区中转服务（无需注册）
- ✅ **Workflow 预设** - 新增最小化/标准/完整三种安装模式
- ✅ **Token 跳过** - 支持跳过 Token 配置，稍后再设置

### 代码清理

**移除冗余配置**

- ✅ 删除所有命令模板中的 `_config.md` 死链接引用
- ✅ 删除 `shared-config.md` 及相关逻辑（减少 128 行代码）
- ✅ 构建大小优化（94.2 kB → 92.6 kB）

---

## 📖 目录

- [核心理念](#-核心理念)
- [架构说明](#-架构说明)
- [核心特性](#-核心特性)
- [快速开始](#-快速开始)
- [命令参考](#-命令参考)
- [专家角色系统](#-专家角色系统)
- [配置文件](#-配置文件)
- [常见问题](#-常见问题)
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
| **跨平台支持** | macOS、Linux、**Windows 自动修复** ✨ |
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
| **多模型并行** | Codex ∥ Gemini 同时调用，交叉验证结果（支持 dev/backend/frontend） |
| **MCP 自动配置** | **Windows 自动修复** + ace-tool 一键安装（支持官方/中转服务）|
| **6阶段工作流** | Prompt增强 → 代码检索 → 分析 → 原型 → 实施 → 审计（/ccg:dev）|
| **12个专家提示词** | Codex 6个 + Gemini 6个，ROLE_FILE 零 token 动态注入 |
| **17个斜杠命令** | 开发工作流 14个 + Git 工具 3个 |
| **Workflow 预设** | 最小化（3命令）/ 标准（12命令）/ 完整（17命令）|
| **Git 自动化** | 智能 commit、交互式回滚、分支清理、Worktree 管理 |
| **npx 一键安装** | 无需全局安装，交互式配置菜单 |

---

## 🚀 快速开始

### 前置要求

1. **必需**：
   - [Claude Code CLI](https://claude.ai/code) - 主导编排
   - Node.js 18+

2. **可选**（根据需求）：
   - [Codex CLI](https://github.com/openai/openai-codeinterpreter) - 后端任务
   - [Gemini CLI](https://github.com/google/generative-ai-cli) - 前端任务

### 一键安装

```bash
# 交互式安装
npx ccg-workflow

# 安装流程：
# 1. 选择 "初始化工作流"
# 2. 选择语言（中文 / English）
# 3. 选择命令安装模式：
#    - 最小化（3命令）：dev, code, commit - 推荐新手
#    - 标准（12命令）：常用开发 + Git 工具 - 推荐
#    - 完整（17命令）：全部功能
#    - 自定义：手动勾选
# 4. 选择 MCP 工具：
#    - 安装 ace-tool（推荐）- 支持官方服务和中转服务
#    - 跳过 MCP 安装 - 稍后配置
# 5. 等待安装完成（约 1-2 分钟）
# 6. 重启终端
```

**Workflow 预设说明**：

| 预设 | 命令数 | 包含命令 | 适用场景 |
|------|--------|---------|---------|
| **最小化** | 3 | dev, code, commit | 新手入门，快速体验 |
| **标准** | 12 | dev, code, frontend, backend, review, analyze, debug, test, commit, rollback, clean-branches, feat | 日常开发，覆盖 90% 需求 |
| **完整** | 17 | 全部命令 | 高级用户，全功能使用 |
| **自定义** | 按需 | 手动勾选 | 定制化需求 |

### 验证安装

```bash
# 检查 codeagent-wrapper
codeagent-wrapper --version

# 检查配置文件
cat ~/.claude/.ccg/config.toml

# 诊断 MCP 配置（v1.4.2 新增）
npx ccg diagnose-mcp
```

### 第一个命令

```bash
# 在 Claude Code 中执行
/ccg:dev 实现用户登录功能

# 系统会自动执行 6 阶段工作流：
# Phase 0: Prompt 增强 (MCP)
# Phase 1: 代码检索 (MCP)
# Phase 2: 多模型分析 (Codex ∥ Gemini 并行)
# Phase 3: 原型生成 (前端→Gemini / 后端→Codex)
# Phase 4: 代码实施 (Claude 重构为生产级)
# Phase 5: 审计交付 (Codex ∥ Gemini 交叉验证)
```

---

## 📚 命令参考

### 开发工作流命令

| 命令 | 用途 | 模型路由 | 工作流 |
|-----|------|---------|--------|
| `/ccg:dev` | 完整6阶段开发工作流 | MCP + Codex + Gemini | Prompt增强 → 检索 → 分析 → 原型 → 实施 → 审计 |
| `/ccg:code` | 智能代码生成（自动路由）| 前端→Gemini / 后端→Codex | 检索 → 原型 → 实施 |
| `/ccg:frontend` | 前端/UI/样式任务 | **多模型并行**（Gemini + Claude）| 检索 → 分析 → 原型 → 实施 → 审计 |
| `/ccg:backend` | 后端/逻辑/算法任务 | **多模型并行**（Codex + Gemini）| 检索 → 分析 → 原型 → 实施 → 审计 |
| `/ccg:debug` | UltraThink 多模型调试 | Codex + Gemini 并行 | 分析 → 诊断 |
| `/ccg:test` | 多模型测试生成 | Codex + Gemini 并行 | 分析 → 生成 |
| `/ccg:bugfix` | 质量门控修复（90%+ 通过）| Codex + Gemini 交叉验证 | 分析 → 修复 → 验证 |
| `/ccg:optimize` | 性能优化 | Codex + Gemini 并行 | 分析 → 优化 |
| `/ccg:review` | 代码审查（无参数自动审查 git diff）| Codex + Gemini 并行 | 审查 → 反馈 |
| `/ccg:analyze` | 技术分析 | Codex + Gemini 并行 | 深度分析 |
| `/ccg:think` | 深度分析 | Codex + Gemini 并行 | UltraThink 分析 |
| `/ccg:scan` | 智能仓库扫描 | 分析项目结构 | 扫描报告 |
| `/ccg:feat` | 智能功能开发（规划→实施→审查）| 多模型协作 | 规划 → 实施 → 审查 |

### Git 工具命令

| 命令 | 用途 |
|-----|------|
| `/ccg:commit` | 智能 commit：分析改动，生成 conventional commit 信息 |
| `/ccg:rollback` | 交互式回滚：列分支、列版本、二次确认 |
| `/ccg:clean-branches` | 分支清理：安全查找并清理已合并分支 |
| `/ccg:worktree` | Worktree 管理：在 `../.ccg/项目名/` 下创建 |

### CLI 诊断工具（v1.4.2 新增）

| 命令 | 用途 |
|-----|------|
| `npx ccg diagnose-mcp` | 诊断 MCP 配置问题 |
| `npx ccg fix-mcp` | 修复 Windows MCP 配置（Windows 用户）|

---

## 🎭 专家角色系统

### 核心机制：ROLE_FILE 动态注入

12个专家提示词（Codex 6个 + Gemini 6个），采用 **零 token 消耗** 的 ROLE_FILE 动态注入机制：

- ✅ 每个命令自动注入对应角色提示词
- ✅ 不占用主会话 token（通过 `codeagent-wrapper` 子进程读取）
- ✅ 无需手动配置全局提示词
- ✅ 支持用户自定义修改提示词内容

### 角色映射表

| 命令 | Codex 角色 | Gemini 角色 |
|------|-----------|------------|
| `/ccg:code`, `/ccg:backend` | architect.md（后端架构师）| - |
| `/ccg:frontend` | - | frontend.md（前端架构师）|
| `/ccg:analyze`, `/ccg:think` | analyzer.md | analyzer.md |
| `/ccg:debug` | debugger.md | debugger.md |
| `/ccg:test` | tester.md | tester.md |
| `/ccg:review`, `/ccg:bugfix` | reviewer.md | reviewer.md |
| `/ccg:optimize` | optimizer.md | optimizer.md |

### 提示词文件结构

```
~/.claude/.ccg/prompts/          # v1.4.0+ 新位置
├── codex/         # Codex CLI 后端专家（6个）
│   ├── architect.md    # 后端架构师（API、数据库、逻辑）
│   ├── analyzer.md     # 后端分析师（性能、安全、架构）
│   ├── debugger.md     # 后端调试专家（逻辑错误、算法问题）
│   ├── optimizer.md    # 后端优化专家（算法、查询、缓存）
│   ├── reviewer.md     # 后端审查专家（代码质量、安全审计）
│   └── tester.md       # 后端测试专家（单元测试、集成测试）
└── gemini/        # Gemini CLI 前端专家（6个）
    ├── frontend.md     # 前端架构师（组件、UI、交互）
    ├── analyzer.md     # 前端分析师（UX、可访问性、性能）
    ├── debugger.md     # 前端调试专家（UI 问题、渲染错误）
    ├── optimizer.md    # 前端优化专家（渲染、懒加载、打包）
    ├── reviewer.md     # 前端审查专家（代码规范、设计一致性）
    └── tester.md       # 前端测试专家（E2E、组件测试）
```

**注意**：Claude Code 本身作为主控编排，不需要额外的提示词文件。

---

## ⚙️ 配置文件

配置文件位于 `~/.claude/.ccg/config.toml`：

```toml
[general]
version = "1.6.0"
language = "zh-CN"
createdAt = "2026-01-07T12:00:00.000Z"

[mcp]
provider = "ace-tool"  # ace-tool | skip (v1.6.0 移除 auggie 安装选项)

[routing]
mode = "smart"  # smart | parallel | sequential

[routing.frontend]
models = ["gemini"]
primary = "gemini"
strategy = "fallback"

[routing.backend]
models = ["codex"]
primary = "codex"
strategy = "fallback"
```

---

## 🗂️ 安装目录结构

```
~/.claude/
├── commands/ccg/           # ✅ Claude Code 读取的 slash commands
│   ├── dev.md, code.md, frontend.md, backend.md
│   ├── debug.md, test.md, bugfix.md, review.md
│   ├── optimize.md, analyze.md, think.md, enhance.md
│   ├── scan.md, feat.md, commit.md, rollback.md
│   ├── clean-branches.md, worktree.md, init.md
├── agents/ccg/             # ✅ Claude Code 读取的 subagents
│   ├── planner.md, ui-ux-designer.md
│   ├── init-architect.md, get-current-datetime.md
├── bin/                    # ✅ 二进制文件
│   └── codeagent-wrapper   # (Windows 自动包装 MCP 命令)
└── .ccg/                   # ✅ CCG 配置目录（v1.4.0+）
    ├── config.toml         # 主配置文件
    ├── backup/             # ✨ v1.4.2 新增：自动备份
    └── prompts/            # 专家提示词
        ├── codex/, gemini/, claude/
```

---

## ❓ 常见问题

<details>
<summary><strong>Q1: v1.6.0 有哪些重要更新？</strong></summary>

**多模型并行增强**：
- ✅ `/ccg:backend` 和 `/ccg:frontend` 现支持多模型并行工作流
- ✅ 后端专家/前端专家也能享受交叉验证能力
- ✅ 5阶段完整工作流：检索 → 分析 → 原型 → 实施 → 审计

**配置简化**：
- ✅ MCP 安装简化为 2 个选项（ace-tool / 跳过）
- ✅ 添加 linux.do 中转服务支持（无需注册）
- ✅ Workflow 预设：最小化(3) / 标准(12) / 完整(17)
- ✅ Token 配置支持跳过，稍后再设置

**代码清理**：
- ✅ 删除 `_config.md` 死链接引用（11 个文件）
- ✅ 删除 `shared-config.md` 冗余配置（128 行代码）
- ✅ 构建大小优化：94.2 kB → 92.6 kB

**升级方法**：
```bash
npx ccg-workflow@latest
# 选择 "更新工作流"
# 自动应用所有改进
```

</details>

<details>
<summary><strong>Q2: Windows 用户 MCP 安装后不工作怎么办？</strong></summary>

**v1.4.2 已自动修复！**

新用户：
```bash
npx ccg-workflow@latest init
# 安装时自动应用 Windows 修复
```

现有用户：
```bash
# 诊断问题
npx ccg diagnose-mcp

# 一键修复
npx ccg fix-mcp
```

手动验证：
```bash
# 检查配置是否正确
cat ~/.claude.json

# 应该看到 "command": "cmd", "args": ["/c", "npx", ...]
```

</details>

<details>
<summary><strong>Q3: 如何更新到最新版本？</strong></summary>

一键更新，无需卸载：
```bash
npx ccg-workflow@latest
# 选择 "更新工作流"
```

更新会自动：
- 检测 npm 最新版本
- 增量更新命令模板和提示词
- 保留用户配置和 MCP 设置
- 自动迁移旧版本目录结构（v1.3.x → v1.4.x → v1.6.0）
- **v1.6.0 新增**：应用多模型并行工作流（backend/frontend）

</details>

<details>
<summary><strong>Q4: v1.4.0 目录迁移会影响我吗？</strong></summary>

**不会影响**，系统会自动迁移：

旧位置 → 新位置：
```
~/.ccg/                    → ~/.claude/.ccg/
~/.claude/prompts/ccg/     → ~/.claude/.ccg/prompts/
~/.claude/commands/ccg/    → 保持不变
```

安装/更新时会自动：
1. 检测旧版本目录
2. 迁移所有文件到新位置
3. 清理旧目录（安全检查后）
4. 显示迁移报告

</details>

<details>
<summary><strong>Q5: MCP 工具如何配置？</strong></summary>

**v1.6.0 简化配置流程**：

安装时提供两个选项：
1. **安装 ace-tool** - 一键配置代码检索和 Prompt 增强
2. **跳过 MCP 安装** - 稍后手动配置任何 MCP 服务

**ace-tool 访问方式**：

1. **官方服务**（推荐）：
   - 注册地址: https://augmentcode.com/
   - 注册后获取 Token
   - 安装时填写 Token 即可（Base URL 留空）

2. **中转服务**（无需注册）⭐：
   - 免费使用: https://linux.do/t/topic/1291730
   - linux.do 社区提供的免费中转服务
   - 安装时需填写 Base URL 和 Token

**安装时 Token 配置**：

```bash
npx ccg-workflow
# 选择 "初始化工作流"
# 选择 "安装 ace-tool"

# 提示：是否跳过 Token 配置？（默认：是）
# - 选择"否"，立即配置 Token
# - 选择"是"，稍后运行 `npx ccg config mcp` 配置
```

**其他 MCP 选项**（手动配置）：

安装时选择"跳过 MCP"，稍后可手动配置任何 MCP 服务：

1. **auggie**（Augment 官方 MCP）：
   - 配置教程: https://linux.do/t/topic/1280612
   - 注意：auggie 不包含 Prompt 增强功能

2. **更多 MCP 服务**：
   - Claude Code MCP 列表: https://github.com/anthropics/claude-code#mcp-servers

**手动配置 ace-tool**：
```bash
# 稍后配置
npx ccg config mcp

# 或编辑 ~/.claude.json 手动添加配置
```

</details>

<details>
<summary><strong>Q6: codeagent-wrapper 是什么？</strong></summary>

来自 [cexll/myclaude](https://github.com/cexll/myclaude) 的 Go 工具，封装了多 CLI 调用：
- 支持 `--backend codex/gemini/claude` 切换
- 会话管理（SESSION_ID）
- ROLE_FILE 动态注入
- **v1.4.2 新增**：Windows 命令自动包装

调用语法：
```bash
codeagent-wrapper --backend <codex|gemini|claude> - [工作目录] <<'EOF'
<任务内容>
EOF
```

</details>

<details>
<summary><strong>Q7: 安装后提示 "codeagent-wrapper: command not found"？</strong></summary>

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
# 或手动验证环境变量：
# %USERPROFILE%\.claude\bin
```

</details>

<details>
<summary><strong>Q8: 如何卸载 CCG 系统？</strong></summary>

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

---

## 🙏 致谢

感谢以下开源项目的贡献：

- **[cexll/myclaude](https://github.com/cexll/myclaude)** - `codeagent-wrapper` 多后端调用工具
- **[UfoMiao/zcf](https://github.com/UfoMiao/zcf)** - Git 工具 + **MCP 跨平台配置逻辑**（v1.4.2）
- **[GudaStudio/skills](https://github.com/GuDaStudio/skills)** - 智能路由设计理念
- **[ace-tool MCP](https://linux.do/t/topic/1344562)** - 轻量级代码检索和 Prompt 增强方案
- **[linux.do 社区](https://linux.do/)** - 活跃的 Vibe Coding 大型技术交流社区

---

## 💬 支持与反馈

- **GitHub Issues**: [提交问题](https://github.com/fengshao1227/ccg-workflow/issues)
- **讨论社区**: [linux.do - CCG 讨论帖](https://linux.do/t/topic/1405588)
- **完整文档**: [README.md](https://github.com/fengshao1227/ccg-workflow)

---

## 📄 许可证

本项目采用 [MIT License](LICENSE) 开源协议。

Copyright (c) 2025 fengshao1227

---

<div align="center">

**最后更新**: 2026-01-07 | **版本**: v1.6.0

Made with ❤️ by the CCG Community

</div>
