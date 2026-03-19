# skills-v2 (CCG Multi-Model Collaboration System)

> [根目录](../CLAUDE.md) > **skills-v2**

**Last Updated**: 2026-03-19 (v1.7.87)

---

## 变更记录 (Changelog)

> 完整变更历史请查看 [CHANGELOG.md](./CHANGELOG.md)

### 2026-03-19 (v1.7.87)
- 🐛 **Gemini 失败重试**：20 个命令模板新增 Gemini 调用失败重试规则（最多 2 次，间隔 5s），3 次全败才降级单模型
- 🐛 **Codex 结果必须等待**：20 个命令模板新增 Codex 等待规则，禁止在 Codex 未返回时跳过下一阶段
- 🐛 **team-exec Agent Teams 修正**：明确使用 TeamCreate + TaskCreate + Agent(team_name=...) 创建真正的 Agent Teams，禁止退化为普通 Agent

### 2026-03-18 (v1.7.86)
- 🐛 **Skills 路径修正**：`SKILL.md` 中 `run_skill.js` 路径从 `~/.claude/skills/` 修正为 `~/.claude/skills/ccg/`，对齐 v1.7.75 命名空间迁移

### 2026-03-17 (v1.7.85)
- ✨ **Binary 双源下载**：GitHub（8s 超时）→ Cloudflare R2 镜像（60s），国内用户友好
- 🐛 **更新跳过 binary 重复下载**：`preserveBinary` + `verifyBinary()` / `showBinaryDownloadWarning()`
- 🐛 **更新失败显示 binary 提示**：与初始化一致的红框警告 + 手动修复指引

### 2026-03-12 (v1.7.83)
- 🔄 **安装器重构**：1878 行单文件 → 5 个聚焦模块（-25%），`cmd()` 构建器 + `MCP_PROVIDERS` 注册表 + 共享管线，零功能变更

### 2026-03-12 (v1.7.82)
- ✨ **fast-context MCP 集成**：Windsurf Fast Context 作为第四个代码检索选项（推荐），支持 API Key 可选 + FC_INCLUDE_SNIPPETS
- ✨ **三端搜索提示词**：自动注入 Claude Code rules + Codex AGENTS.md + Gemini GEMINI.md，卸载自动清理
- ✨ **Gemini MCP 同步**：`syncMcpToGemini()` 镜像 MCP 到 `~/.gemini/settings.json`

### 2026-03-11 (v1.7.81)
- 🔄 **`/ccg:commit` Context 自动归档**：从 git diff 自动生成 ContextEntry，不再依赖手动 session.log
- 🔄 **`/ccg:context log` 降为可选**：init 一次 → 正常开发 → commit 全自动

### 2026-03-11 (v1.7.80)
- ✨ **`/ccg:context` 命令**：第 27 个斜杠命令，`.context/` 目录初始化 + 决策日志 + 压缩归档 + 历史查看
- ✨ **Context Compress Phase**：`/ccg:commit` 提交时自动压缩 session.log → history/commits.jsonl
- ✨ **13 个角色提示词 `.context Awareness`**：Codex/Gemini 提示词注入 `.context/prefs/` 读取指令
- ✨ **Quality Gate Rules**：`~/.claude/rules/ccg-skills.md` 定义质量关卡自动触发规则，安装时自动写入

### 2026-03-11 (v1.7.79)
- 🐛 **Binary 下载容错**：3 次重试 + 60s 超时 + 失败醒目告警（红框 + 手动修复指引）+ 不阻塞安装
- 🐛 **Update 流程加固**：binary 备份/恢复 + subprocess 超时 120s→300s

### 2026-03-11 (v1.7.78)
- 🐛 **Windows Hook exit 255 修复**：Windows 自动授权改用 `permissions.allow`，不再依赖 jq/grep

### 2026-03-10 (v1.7.77)
- 🏗 **二进制迁移至 GitHub Release**：npm 包 16.3MB→161KB，Actions CI 交叉编译，installer 按需下载

### 2026-03-10 (v1.7.76)
- 📝 **README 重构**：命令分组（7 类）、新增 Why CCG? + CONTRIBUTING.md + Issue 模板 x3、配置章节去重折叠

### 2026-03-10 (v1.7.75)
- 🐛 **Skills 命名空间隔离**：`skills/` → `skills/ccg/`，卸载不再误删用户自建 skill + 旧版自动迁移

### 2026-03-09 (v1.7.74)
- 🔄 **spec 模板 guardrail**：`spec-research`/`spec-plan`/`spec-impl` 添加 USER GUIDANCE RULE + TASKS FORMAT RULE，内部 `/opsx:*` 调用标注 internal，失败引导至 `/ccg:spec-*`
- 🐛 **Gemini CLI `.env` 隔离**：`cmd.Dir=$HOME` + `--include-directories` 避免项目 `.env` 覆盖全局 API Key
- 🐛 **Codex 测试修正**：环境变量名 `CODEX_BYPASS_SANDBOX` → `CODEX_REQUIRE_APPROVAL`

### 2026-03-09 (v1.7.73)
- ✨ **`/ccg:codex-exec` 命令**：第 26 个斜杠命令，Codex 全权执行 + 多模型审核，Claude token 极低消耗
- ✨ **Skills 体系**：6 个原生 skill（verify-security/quality/change/module + gen-docs + multi-agent）
- ✨ **context7 MCP 自动安装**：免费库文档查询，无需 API Key
- ✨ **Codex MCP 同步**：`syncMcpToCodex()` 镜像同步到 `~/.codex/config.toml`
- 🐛 **修复 `--skip-mcp` / 安装卸载路径 / 模板替换 / 计数 / 失败反馈**

### 2026-03-09 (v1.7.70)
- ✨ **菜单 UI 大改版**：ASCII Art Logo + 双线边框 + 编号快捷键 + CJK 宽度感知对齐
- 🔄 **MCP 推荐调整**：ace-tool 恢复为默认推荐（`enhance_prompt` 已不可用），中转推荐 https://acemcp.heroman.wtf/
- 🗑️ **仓库清理**：移除 11 个临时/缓存文件，更新 `.gitignore`

### 2026-03-09 (v1.7.69)
- ✨ **国际化 (i18n)**：首次安装语言选择，CLI 全路径 i18n 化，README 英文版
- ✨ **codeagent-wrapper Hook 自动授权**：解决 `permissions.allow` 不生效问题，需 `jq`

### 2026-03-09 (v1.7.68)
- 🐛 **修复 update 命令全局安装死循环**：npm 全局安装用户本地工作流过旧时不再错误推荐 `npm install -g`
- ✅ **测试覆盖率 38 → 130**：新增 version/config/platform/installer 四组测试，模板变量完整性检查

### 2026-03-07 (v1.7.67)
- 🐛 **修复 spec 工作流完全对齐 OPSX**：修复状态持久化问题，确保用户切换上下文后可以正确恢复
- 🔄 **多模型协作成果采纳**：在调用 OPSX 前输出结构化总结，确保 Codex/Gemini 的分析结果被正确传递
- 🗑️ **移除 spec-init ace-tool 检查**：ace-tool MCP 为可选项，不作为必需检查

### 2026-03-06 (v1.7.66)
- 🐛 **修复 `spec-research` 并行调用缺失**：补全 Step 4 多模型并行探索模板，添加 `run_in_background: true` 和完整 Bash 并行调用示例

### 2026-03-01 (v1.7.63)
- 🔄 **适配 OpenSpec 1.2**：`spec-init` 支持 Profile 系统 + 自动检测，`spec-review` 修复过时引用，保持 CCG 封装纯粹性

### 2026-02-27 (v1.7.62)
- 🔄 **Gemini 模型升级**：`gemini-3-pro-preview` → `gemini-3.1-pro-preview`（PR #65 by @23q3）

### 2026-02-10 (v1.7.60)
- ✨ **Agent Teams 系列**：新增 4 个独立命令（`team-research`/`team-plan`/`team-exec`/`team-review`）
- 🏗️ **并行实施**：利用 Claude Code Agent Teams spawn Builder teammates 并行写代码
- 📋 **完整链路**：需求→约束 → 消除歧义→计划 → 并行实施 → 双模型审查
- 🔒 **完全独立**：Team 系列不依赖现有 ccg 命令，自成体系

### 2026-02-08 (v1.7.57)
- ✨ **MCP 工具扩展**：新增 ContextWeaver（推荐）+ 辅助工具（Context7/Playwright/DeepWiki/Exa）
- ✨ **API 配置**：初始化和菜单新增 API 配置，自动添加优化配置和权限白名单
- ✨ **实用工具**：新增 ccusage（用量分析）+ CCometixLine（状态栏）
- ✨ **Claude Code 安装**：支持 npm/homebrew/curl/powershell/cmd 多种方式

### 2026-01-26 (v1.7.52)
- 🚀 **OpenSpec 升级**：迁移到 OPSX 架构，废弃 `/openspec:xxx`，启用 `/opsx:xxx`
- 🔄 **命令更新**：更新 `spec-*` 系列命令以支持新的 `/opsx` 命令
- 🗑️ **清理**：移除过时的 OpenSpec 指导块和旧命令

### 2026-01-25 (v1.7.51)
- 🌏 **修复默认语言为英文的问题**：将 CLI 所有命令描述从硬编码英文改为中文

### 2026-01-21 (v1.7.47)
- 🐛 **修复 `gemini/architect.md` 缺失**：新增前端架构师角色提示词
- ✅ **专家提示词数量**：12 → 13 个（Codex 6 + Gemini 7）

---

## 模块职责

**CCG (Claude + Codex + Gemini)** - 多模型协作系统的核心实现，提供：

1. **多模型协作编排**：固定路由 Gemini（前端）+ Codex（后端）+ Claude（编排）
2. **27 个斜杠命令**：开发工作流 + Git 工具 + 项目管理 + OPSX + Agent Teams + Codex 执行
3. **13 个专家提示词**：Codex 6 个 + Gemini 7 个
4. **6 个原生 Skills**：质量关卡（verify-security/quality/change/module + gen-docs）+ 多 Agent 协同
5. **跨平台 CLI 工具**：一键安装（支持 macOS、Linux、Windows）
6. **MCP 集成**：fast-context（推荐）/ ace-tool / ContextWeaver + context7（自动安装）+ Codex & Gemini MCP 同步
7. **Agent Teams 并行实施**：Team 系列 4 个独立命令，spawn Builder teammates 并行写代码

---

## 入口与启动

### 用户安装入口

```bash
# 一键安装（推荐）
npx ccg-workflow

# 交互式菜单
npx ccg-workflow menu
```

### CLI 入口点

- **主入口**：`bin/ccg.mjs` → `src/cli.ts`
- **核心命令**：
  - `init` - 初始化工作流（`src/commands/init.ts`）
  - `update` - 更新工作流（`src/commands/update.ts`）
  - `menu` - 交互式菜单（`src/commands/menu.ts`）
  - `diagnose-mcp` - MCP 诊断（`src/commands/diagnose-mcp.ts`）
  - `config` - 配置管理（`src/commands/config-mcp.ts`）

### codeagent-wrapper 入口

- **主入口**：`codeagent-wrapper/main.go`
- **调用语法**：
  ```bash
  codeagent-wrapper --backend <codex|gemini|claude> - [工作目录] <<'EOF'
  <任务内容>
  EOF
  ```

---

## 对外接口

### CLI 命令接口

| 命令 | 用途 |
|------|------|
| `npx ccg-workflow` | 一键安装/菜单 |
| `npx ccg-workflow menu` | 交互式菜单 |
| `npx ccg-workflow update` | 更新到最新版本 |
| `npx ccg-workflow diagnose-mcp` | 诊断 MCP 配置 |

### Slash Commands 接口（17 个）

**开发工作流**：
| 命令 | 用途 | 模型 |
|------|------|------|
| `/ccg:workflow` | 完整 6 阶段工作流 | Codex ∥ Gemini |
| `/ccg:plan` | 多模型协作规划（Phase 1-2） | Codex ∥ Gemini |
| `/ccg:execute` | 多模型协作执行（Phase 3-5） | Codex ∥ Gemini + Claude |
| `/ccg:codex-exec` | Codex 全权执行计划（MCP + 代码 + 测试） | Codex + 多模型审核 |
| `/ccg:context` | 项目上下文管理（.context 初始化/日志/压缩/历史） | Claude |
| `/ccg:frontend` | 前端专项（快速模式） | Gemini |
| `/ccg:backend` | 后端专项（快速模式） | Codex |
| `/ccg:feat` | 智能功能开发 | 规划 → 实施 |
| `/ccg:analyze` | 技术分析（仅分析） | Codex ∥ Gemini |
| `/ccg:debug` | 问题诊断 + 修复 | Codex ∥ Gemini |
| `/ccg:optimize` | 性能优化 | Codex ∥ Gemini |
| `/ccg:test` | 测试生成 | 智能路由 |
| `/ccg:review` | 代码审查（自动 git diff） | Codex ∥ Gemini |

**项目管理**：
| 命令 | 用途 |
|------|------|
| `/ccg:init` | 初始化项目 CLAUDE.md |

**Git 工具**：
| 命令 | 用途 |
|------|------|
| `/ccg:commit` | 智能提交（conventional commit） |
| `/ccg:rollback` | 交互式回滚 |
| `/ccg:clean-branches` | 清理已合并分支 |
| `/ccg:worktree` | Worktree 管理 |

**Agent Teams 并行实施**（v1.7.60+，需启用 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`）：
| 命令 | 用途 | 说明 |
|------|------|------|
| `/ccg:team-research` | 需求 → 约束集 | 并行探索代码库，Codex + Gemini 双模型分析 |
| `/ccg:team-plan` | 约束 → 并行计划 | 消除歧义，拆分为文件范围隔离的独立子任务 |
| `/ccg:team-exec` | 并行实施 | spawn Builder teammates（Sonnet）并行写代码 |
| `/ccg:team-review` | 双模型审查 | Codex + Gemini 交叉审查，分级处理 Critical/Warning/Info |

---

## 固定配置

v1.7.0 起，以下配置不再支持自定义：

| 项目 | 固定值 | 原因 |
|------|--------|------|
| 语言 | 中文 | 所有模板为中文 |
| 前端模型 | Gemini | 擅长 UI/CSS/组件 |
| 后端模型 | Codex | 擅长逻辑/算法/调试 |
| 协作模式 | smart | 最佳实践 |
| 命令数量 | 27 个 | 全部安装 |

---

## 关键依赖与配置

### TypeScript 依赖

**运行时依赖**：
- `cac@^6.7.14` - CLI 框架
- `inquirer@^12.9.6` - 交互式提示
- `ora@^9.0.0` - 加载动画
- `ansis@^4.1.0` - 终端颜色
- `fs-extra@^11.3.2` - 文件系统工具
- `smol-toml@^1.4.2` - TOML 解析

**开发依赖**：
- `typescript@^5.9.2`
- `unbuild@^3.6.1` - 构建工具
- `tsx@^4.20.5` - TypeScript 执行器

### Go 依赖

- Go 标准库（无外部第三方依赖）

### 配置文件

**用户配置**：
- `~/.claude/.ccg/config.toml` - CCG 主配置

**MCP 配置**：
- `~/.claude.json` - Claude Code MCP 服务配置

---

## 相关文件清单

### 核心源码

```
src/
├── cli.ts                     # CLI 入口
├── cli-setup.ts               # 命令注册
├── commands/
│   ├── init.ts                # 初始化命令
│   ├── update.ts              # 更新命令
│   ├── menu.ts                # 交互式菜单
│   └── ...
├── utils/
│   ├── installer.ts           # 安装逻辑（核心）
│   ├── config.ts              # 配置管理
│   ├── mcp.ts                 # MCP 工具集成
│   └── ...
```

### 模板文件

```
templates/
├── commands/                  # 27 个斜杠命令
│   ├── workflow.md
│   ├── plan.md                # 多模型协作规划
│   ├── execute.md             # 多模型协作执行
│   ├── codex-exec.md          # Codex 全权执行计划
│   ├── context.md             # 项目上下文管理（.context）
│   ├── frontend.md
│   ├── backend.md
│   ├── feat.md
│   ├── analyze.md
│   ├── debug.md
│   ├── optimize.md
│   ├── test.md
│   ├── review.md
│   ├── init.md
│   ├── commit.md
│   ├── rollback.md
│   ├── clean-branches.md
│   ├── worktree.md
│   ├── team-research.md       # Agent Teams 需求→约束
│   ├── team-plan.md           # Agent Teams 规划
│   ├── team-exec.md           # Agent Teams 并行实施
│   ├── team-review.md         # Agent Teams 审查
│   └── agents/               # 4 个子智能体
│       ├── planner.md
│       ├── ui-ux-designer.md
│       ├── init-architect.md
│       └── get-current-datetime.md
├── prompts/                  # 13 个专家提示词
│   ├── codex/
│   └── gemini/
└── skills/                   # 6 个 skill（质量关卡 + 多 Agent 协同）
    ├── tools/
    │   ├── verify-security/
    │   ├── verify-quality/
    │   ├── verify-change/
    │   ├── verify-module/
    │   ├── gen-docs/
    │   └── lib/
    └── orchestration/
        └── multi-agent/
├── rules/                    # 全局规则（→ ~/.claude/rules/）
│   └── ccg-skills.md         # 质量关卡自动触发规则
```

### 预编译产物

```
bin/
├── ccg.mjs                           # CLI 入口脚本
├── codeagent-wrapper-darwin-amd64    # macOS Intel
├── codeagent-wrapper-darwin-arm64    # macOS Apple Silicon
├── codeagent-wrapper-linux-amd64     # Linux x64
├── codeagent-wrapper-linux-arm64     # Linux ARM64
├── codeagent-wrapper-windows-amd64.exe  # Windows x64
└── codeagent-wrapper-windows-arm64.exe  # Windows ARM64
```

---

## 架构图

```mermaid
graph TD
    User["用户"] --> CLI["npx ccg-workflow"]
    CLI --> Init["一键安装"]
    
    Init --> Commands["~/.claude/commands/ccg/<br/>16 个命令"]
    Init --> Agents["~/.claude/agents/ccg/<br/>4 个子智能体"]
    Init --> Skills["~/.claude/skills/<br/>1 个 skill"]
    Init --> Prompts["~/.claude/.ccg/prompts/<br/>13 个专家提示词"]
    Init --> Binary["~/.claude/bin/<br/>codeagent-wrapper"]
    Init --> MCP["~/.claude.json<br/>MCP 配置（可选）"]

    User2["Claude Code 用户"] --> SlashCmd["/ccg:workflow<br/>/ccg:frontend<br/>..."]
    SlashCmd --> Commands

    Commands --> Wrapper["codeagent-wrapper"]
    Wrapper --> Codex["Codex CLI<br/>(后端)"]
    Wrapper --> Gemini["Gemini CLI<br/>(前端)"]

    style CLI fill:#90EE90
    style Wrapper fill:#87CEEB
```

---

## 发版规则（必须严格遵守）

每次发版必须完成以下所有步骤，缺一不可：

### 1. 更新版本号
- 编辑 `package.json` 中的 `version` 字段

### 2. 更新 CHANGELOG.md
- 在顶部添加新版本条目
- 格式：`## [x.y.z] - YYYY-MM-DD`
- 按类别分组：`✨ 新功能` / `🐛 修复` / `🔄 变更` / `🗑️ 移除`

### 3. 更新 README.md
- 更新命令表（如有新增命令）
- 更新使用说明（如有新功能）
- 更新底部版本号

### 4. 更新 CLAUDE.md
- 更新顶部 `Last Updated` 日期和版本号
- 添加变更记录条目
- 更新命令数量、接口表等受影响的章节

### 5. 构建 + 发布 + 推送

```bash
# 构建
pnpm build

# 发布 npm 包
npm publish

# 提交到 Git
git add -A
git commit -m "chore: bump version to x.y.z"
git push origin main
```

### 检查清单
- [ ] package.json 版本号已更新
- [ ] CHANGELOG.md 已添加新版本条目
- [ ] README.md 已更新（命令表 + 使用说明 + 底部版本号）
- [ ] CLAUDE.md 已更新（Last Updated + 变更记录 + 受影响章节）
- [ ] `pnpm build` 通过
- [ ] `npm publish` 成功
- [ ] `git push origin main` 成功

---

**扫描覆盖率**: 95%+
**最后更新**: 2026-02-10
