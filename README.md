# CCG - Claude + Codex + Gemini 多模型协作系统

<div align="center">

**Claude Code 编排 Codex + Gemini 双模型协作的智能开发工作流系统**

[![npm version](https://img.shields.io/npm/v/ccg-workflow.svg)](https://www.npmjs.com/package/ccg-workflow)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-Compatible-green.svg)](https://claude.ai/code)

[快速开始](#-快速开始) • [命令参考](#-命令参考) • [常见问题](#-常见问题) • [更新日志](CHANGELOG.md)

</div>

---

## 💡 这是什么？

**CCG** = **Claude Code** (编排) + **Codex CLI** (后端) + **Gemini CLI** (前端)

一个让 Claude Code 专注于编排决策，把具体代码生成交给专业模型的多模型协作系统：

- **前端任务** → Gemini（擅长 UI/CSS/组件）
- **后端任务** → Codex（擅长逻辑/算法/调试）
- **全栈整合** → Claude（工作流控制、代码主权）

### 核心优势

- ✅ **智能路由** - 前端 → Gemini，后端 → Codex，自动选择
- ✅ **多模型并行** - Codex ∥ Gemini 同时分析，交叉验证减少错误
- ✅ **零写入权限** - 外部模型只返回 Patch，Claude 保持代码主权
- ✅ **Token 优化** - ROLE_FILE 动态注入，专家提示词零消耗
- ✅ **Web UI 实时输出** - 自动打开浏览器，流式显示思考过程、命令执行、生成结果
- ✅ **一键安装** - npx 运行，自动安装全部 15 个命令

---

## 🚀 快速开始

### 前置要求

**必需**：
- [Claude Code CLI](https://claude.ai/code)
- Node.js 18+

**可选**（根据需求安装）：
- Codex CLI - 用于后端任务
- Gemini CLI - 用于前端任务

> 💡 **只装 Claude Code 也能用！** 系统会自动降级为纯 Claude 工作流

### 一键安装

```bash
npx ccg-workflow
```

**安装流程**：
1. 选择是否配置 ace-tool MCP（可跳过）
2. 确认安装
3. 自动安装全部 15 个命令
4. 配置 PATH（如需要）

就这么简单！无需选择语言、模型、命令预设。

### 固定配置

| 项目 | 配置 |
|------|------|
| 前端模型 | **Gemini** |
| 后端模型 | **Codex** |
| 协作模式 | **smart** |
| 命令数量 | **15 个**（全部安装） |

### 第一个命令

```bash
# 在 Claude Code 中执行
/ccg:workflow 实现用户登录功能

# 自动执行 6 阶段工作流：
# 阶段 1: 研究 - Prompt 增强 + 上下文检索
# 阶段 2: 构思 - 多模型分析 (Codex ∥ Gemini)
# 阶段 3: 计划 - 多模型规划 + 用户确认
# 阶段 4: 执行 - 代码实施
# 阶段 5: 优化 - 多模型审查
# 阶段 6: 评审 - 质量检查
```

---

## 📚 命令参考

### 核心命令（记住这 3 个就够了）

```bash
/ccg:workflow   # 完整任务（6 阶段工作流）
/ccg:feat       # 新功能开发（自动规划）
/ccg:frontend   # 纯前端任务（Gemini 主导，更快）
/ccg:backend    # 纯后端任务（Codex 主导，更快）
```

### 完整命令列表（15 个）

#### 开发工作流

| 命令 | 用途 | 模型 |
|-----|------|------|
| `/ccg:workflow` | 完整 6 阶段开发工作流 | Codex ∥ Gemini |
| `/ccg:frontend` | 前端专项（快速模式） | Gemini |
| `/ccg:backend` | 后端专项（快速模式） | Codex |
| `/ccg:feat` | 智能功能开发 | 规划 → 实施 |
| `/ccg:enhance` | Prompt 增强（ace-tool） | MCP |
| `/ccg:analyze` | 技术分析（仅分析不改代码） | Codex ∥ Gemini |
| `/ccg:debug` | 问题诊断 + 修复 | Codex ∥ Gemini |
| `/ccg:optimize` | 性能优化 | Codex ∥ Gemini |
| `/ccg:test` | 测试生成 | 智能路由 |
| `/ccg:review` | 代码审查（无参数自动审查 git diff） | Codex ∥ Gemini |

#### Git 工具

| 命令 | 用途 |
|-----|------|
| `/ccg:commit` | 智能提交（自动生成 conventional commit）|
| `/ccg:rollback` | 交互式回滚 |
| `/ccg:clean-branches` | 清理已合并分支 |
| `/ccg:worktree` | Worktree 管理 |

#### 项目工具

| 命令 | 用途 |
|-----|------|
| `/ccg:init` | 初始化项目 CLAUDE.md |

---

## 🎭 专家角色系统

### ROLE_FILE 动态注入机制

12 个专家提示词（Codex 6 + Gemini 6），**零 token 消耗**：

**Codex 专家**（后端）：
- `architect.md` - 后端架构师
- `analyzer.md` - 技术分析师
- `debugger.md` - 调试专家
- `optimizer.md` - 性能优化师
- `reviewer.md` - 代码审查员
- `tester.md` - 测试工程师

**Gemini 专家**（前端）：
- `frontend.md` - 前端架构师
- `analyzer.md` - UI/UX 分析师
- `debugger.md` - 前端调试专家
- `optimizer.md` - 前端性能优化
- `reviewer.md` - 代码审查员
- `tester.md` - 前端测试工程师

**工作原理**：
1. 每个命令自动注入对应角色提示词
2. 通过 `codeagent-wrapper` 子进程读取
3. 不占用主会话 token
4. 用户可自定义修改（路径：`~/.claude/.ccg/prompts/`）

---

## 🗂️ 安装目录结构

```
~/.claude/
├── commands/ccg/          # 15 个斜杠命令
├── agents/ccg/            # 4 个子智能体
├── skills/                # 暂无
├── bin/
│   └── codeagent-wrapper  # Go 多后端调用工具
└── .ccg/
    ├── config.toml        # 主配置
    └── prompts/           # 12 个专家提示词
        ├── codex/
        └── gemini/
```

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
│  后端专家   │  │  前端专家   │
│  逻辑算法   │  │  UI 组件    │
└─────────────┘  └─────────────┘
       │                │
       └────────┬───────┘
                ↓
      Unified Diff Patch
    (零写入权限，仅返回补丁)
```

**信任规则**：
- 后端问题 → **以 Codex 意见为准**
- 前端问题 → **以 Gemini 意见为准**
- 冲突时 → Claude 综合判断，向用户说明分歧

---

## ❓ 常见问题

<details>
<summary><strong>Q1: 只装了 Claude Code，没装 Codex/Gemini 能用吗？</strong></summary>

✅ **可以！** 系统会自动降级为纯 Claude 工作流。

但会失去：
- 智能路由（前端/后端自动分配）
- 多模型并行（交叉验证）
- 专家角色系统（ROLE_FILE 注入）

建议至少安装 Codex 或 Gemini 其中一个以获得完整体验。

</details>

<details>
<summary><strong>Q2: MCP 工具如何配置？</strong></summary>

**安装时配置**（推荐）：

```bash
npx ccg-workflow
# 选择 "安装 ace-tool"
```

**ace-tool 两种方式**：

1. **官方服务**：
   - 注册地址：https://augmentcode.com/
   - 获取 Token 后填写即可

2. **中转服务**（无需注册）⭐：
   - 免费使用：https://linux.do/t/topic/1291730
   - linux.do 社区提供
   - 需填写 Base URL 和 Token

**跳过 MCP**：

跳过 MCP 后，命令中涉及 ace-tool 的步骤（代码检索、Prompt 增强）会失效，但其他功能正常工作。

</details>

<details>
<summary><strong>Q3: 如何更新到最新版本？</strong></summary>

```bash
npx ccg-workflow@latest
# 选择 "更新工作流"
```

更新会自动：
- 检测 npm 最新版本
- 增量更新命令和提示词
- 保留 MCP 配置

</details>

<details>
<summary><strong>Q4: `/ccg:workflow` 和 `/ccg:frontend`/`/ccg:backend` 有什么区别？</strong></summary>

- **`/ccg:workflow`** - 完整 6 阶段工作流
  - 每阶段都并行调用 Codex + Gemini
  - 适合全栈任务、复杂任务

- **`/ccg:frontend`** / **`/ccg:backend`** - 专项快速模式
  - 只调用对应主导模型（更快）
  - 适合明确的纯前端/纯后端任务

</details>

<details>
<summary><strong>Q5: 安装后提示 "codeagent-wrapper: command not found"？</strong></summary>

**原因**：PATH 未生效

**解决方案**：

Mac/Linux：
```bash
source ~/.zshrc
# 或
source ~/.bashrc
```

Windows：
```powershell
# 重新打开 PowerShell
```

</details>

<details>
<summary><strong>Q6: 如何卸载？</strong></summary>

```bash
npx ccg-workflow
# 选择 "卸载工作流"
```

会删除：
- `~/.claude/commands/ccg/` - 命令文件
- `~/.claude/agents/ccg/` - 子智能体
- `~/.claude/skills/` - skills
- `~/.claude/bin/codeagent-wrapper` - 二进制文件
- `~/.claude/.ccg/` - 配置目录（可选保留）

</details>

---

## 🙏 致谢

感谢以下开源项目的贡献：

- **[cexll/myclaude](https://github.com/cexll/myclaude)** - codeagent-wrapper 多后端调用工具
- **[UfoMiao/zcf](https://github.com/UfoMiao/zcf)** - Git 工具与 MCP 配置逻辑
- **[GudaStudio/skills](https://github.com/GuDaStudio/skills)** - 智能路由设计理念
- **[ace-tool MCP](https://linux.do/t/topic/1344562)** - 轻量级代码检索和 Prompt 增强
- **[linux.do 社区](https://linux.do/)** - 活跃的 Vibe Coding 技术交流社区

---

## 💬 支持与反馈

- **GitHub Issues**: [提交问题](https://github.com/fengshao1227/ccg-workflow/issues)
- **讨论社区**: [linux.do - CCG 讨论帖](https://linux.do/t/topic/1405588)

---

## 📄 许可证

本项目采用 [MIT License](LICENSE) 开源协议。

Copyright (c) 2025 fengshao1227

---

<div align="center">

**版本**: v1.7.3 | **最后更新**: 2026-01-09

Made with ❤️ by the CCG Community

</div>
