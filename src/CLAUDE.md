# src (CCG TypeScript CLI)

> [根目录](../CLAUDE.md) > **src**

**Last Updated**: 2026-04-10

---

## 模块职责

`src/` 是 CCG Workflow CLI 工具的全部 TypeScript 实现。负责：一键安装/更新 CCG 工作流到用户环境 (`~/.claude/`)，从 `templates/` 读取素材并经过模板变量替换后写入目标位置，管理 MCP 服务配置（Claude/Codex/Gemini 三端同步），提供中英双语交互界面，以及通过 Skill Registry 从 SKILL.md frontmatter 自动生成 slash commands。

打包产物由 `unbuild` 输出到 `dist/`，由 `bin/ccg.mjs` 加载，通过 `npx ccg-workflow` 或 `npx ccg-workflow menu` 调用。

---

## 入口与启动

| 文件 | 角色 |
|------|------|
| `src/cli.ts` | CLI 主入口，创建 `cac('ccg')` 实例，调用 `setupCommands()` 注册命令，然后 `cli.parse()` |
| `src/cli-setup.ts` | 命令注册层，读取 `~/.claude/.ccg/config.toml` 初始化语言，为每个命令绑定 action |
| `src/index.ts` | 库导出入口，聚合所有公开 API 供外部程序调用 |
| `dist/` | `unbuild` 产物，`cli.mjs` + `index.mjs` 各一份 |
| `bin/ccg.mjs` | npm bin 脚本，加载 `dist/cli.mjs` |

**启动链**：`npx ccg-workflow` → `bin/ccg.mjs` → `dist/cli.mjs` → `cli.ts:main()` → `setupCommands()` → `cli.parse()`

---

## 对外接口

### CLI 命令（`src/cli-setup.ts`）

| 命令 | 别名 | 说明 | 实现文件 |
|------|------|------|----------|
| `ccg` (默认) | — | 显示交互式菜单 | `commands/menu.ts:showMainMenu()` |
| `ccg init` | `ccg i` | 4 步交互安装向导 | `commands/init.ts:init()` |
| `ccg diagnose-mcp` | — | 诊断 MCP 配置问题 | `commands/diagnose-mcp.ts:diagnoseMcp()` |
| `ccg fix-mcp` | — | 修复 Windows MCP 配置 | `commands/diagnose-mcp.ts:fixMcp()` |
| `ccg config mcp` | — | 配置 MCP Token | `commands/config-mcp.ts:configMcp()` |

**全局选项**：`--lang/-l`（覆盖语言）、`--force/-f`（强制覆盖）、`--skip-prompt/-s`（非交互模式）、`--frontend/-F`、`--backend/-B`、`--mode/-m`、`--install-dir/-d`

### 库导出 API（`src/index.ts`）

```typescript
// 类型
export * from './types'

// 命令
export { init } from './commands/init'
export { showMainMenu } from './commands/menu'
export { update } from './commands/update'

// 国际化
export { i18n, initI18n, changeLanguage } from './i18n'

// 配置管理
export { readCcgConfig, writeCcgConfig, createDefaultConfig, ... } from './utils/config'

// 安装器
export { getWorkflowConfigs, installWorkflows, installAceTool, ... } from './utils/installer'

// 迁移 + 版本
export { migrateToV1_4_0, needsMigration } from './utils/migration'
export { getCurrentVersion, checkForUpdates, compareVersions } from './utils/version'
```

---

## 源码结构

### commands/（5 文件）

| 文件 | 核心函数 | 职责 |
|------|----------|------|
| `init.ts` | `init(options)` | 4 步安装向导（API 提供方→模型路由→MCP 工具→性能模式），orchestrate installWorkflows |
| `menu.ts` | `showMainMenu()` | ASCII Art 主菜单，CJK 宽度感知对齐，6 功能选项循环 |
| `update.ts` | `update()` | 检查 npm 版本，触发 `npx ccg-workflow@latest init --skip-prompt --skip-mcp` |
| `config-mcp.ts` | `configMcp()` | 独立 MCP Token 配置交互 |
| `diagnose-mcp.ts` | `diagnoseMcp()`, `fixMcp()` | 诊断 `~/.claude.json` MCP 配置，Windows 修复 |

**`init.ts` 安装流程**（`src/commands/init.ts:152`）：

```
Step 0: 语言选择（首次/已保存跳过）
Step 1/4: API 提供方（官方 / 第三方 / APIMart 赞助商 / 跳过）
Step 2/4: 模型路由（Frontend: Gemini|Codex, Backend: Codex|Gemini, Gemini 型号）
Step 3/4: MCP 工具多选（ace-tool ✓, context7 ✓, fast-context, grok-search, contextweaver）
Step 4/4: 性能模式（standard|lite）+ Impeccable 可选安装
→ 安装摘要确认 → installWorkflows() → MCP 安装 → permissions.allow → context7 → MCP 三端同步
```

**`menu.ts` CJK 对齐**（`src/commands/menu.ts:29`）：`visWidth()` 函数对 CJK 字符计宽 2，emoji 和全角符号同理，`pad()` 基于此对齐菜单列。

---

### utils/installer.* 重构后架构（v1.7.83）

v1.7.83 将原 1878 行单文件拆分为 5 个聚焦模块，各自边界清晰：

| 文件 | 职责 | 核心导出 |
|------|------|----------|
| `installer.ts` | 主入口 + binary 管理，re-export 子模块所有公共 API | `installWorkflows()`, `uninstallWorkflows()`, `verifyBinary()`, `EXPECTED_BINARY_VERSION` |
| `installer-data.ts` | 命令注册表（唯一真相源），`cmd()` builder | `getAllCommandIds()`, `getWorkflowById()`, `WORKFLOW_CONFIGS` |
| `installer-template.ts` | 模板变量替换，PACKAGE_ROOT 解析，MCP provider 注册表 | `injectConfigVariables()`, `replaceHomePathsInTemplate()`, `PACKAGE_ROOT` |
| `installer-mcp.ts` | MCP 服务安装（ace-tool / fast-context / contextweaver / 通用） | `installAceTool()`, `installFastContext()`, `syncMcpToCodex()`, `syncMcpToGemini()` |
| `installer-prompt.ts` | fast-context 搜索引导 Prompt 管理 | `writeFastContextPrompt()`, `removeFastContextPrompt()` |
| `installer-codex-api.ts` | APIMart 作为 Codex 模型供应商写入 `~/.codex/config.toml` | `configureApiMartForCodex()`, `removeApiMartFromCodex()` |

**`installWorkflows()` 执行链**（`src/utils/installer.ts:659`）：

```
验证 templateDir 存在
→ ensureDir (commands/ccg, .ccg, .ccg/prompts)
→ installCommandFiles()      # templates/commands/*.md → ~/.claude/commands/ccg/
→ installAgentFiles()        # templates/commands/agents/*.md → ~/.claude/agents/ccg/
→ installPromptFiles()       # templates/prompts/{codex,gemini,claude}/ → ~/.claude/.ccg/prompts/
→ installSkillFiles()        # templates/skills/ → ~/.claude/skills/ccg/（递归拷贝 + 路径替换）
→ installSkillGeneratedCommands()  # Skill Registry → 生成额外 slash commands
→ installRuleFiles()         # templates/rules/*.md → ~/.claude/rules/
→ installBinaryFile()        # 下载 codeagent-wrapper（双源）
→ 后置校验: installedCommands.length > 0
```

#### Binary 管理（`src/utils/installer.ts:61`）

```typescript
const EXPECTED_BINARY_VERSION = '5.10.0'  // 必须与 codeagent-wrapper/main.go 中 version 常量保持一致

// 双源下载策略（优先国内 CDN）：
const BINARY_SOURCES = [
  { name: 'Cloudflare CDN', url: 'https://github.20031227.xyz/preset', timeoutMs: 30_000 },
  { name: 'GitHub Release',  url: 'https://github.com/.../releases/download/preset', timeoutMs: 120_000 },
]
```

- 下载前检查：`binary --version` 输出与 `EXPECTED_BINARY_VERSION` 对比，版本一致则跳过下载
- 优先用 `curl`（自动读取系统代理 `HTTPS_PROXY`），失败后降级 Node.js `fetch`
- 下载失败显示红框警告 + 手动修复指引，**不阻塞**安装流程（非致命错误）

⚠️ **版本同步铁律**：修改 Go 代码时必须同步更新 `EXPECTED_BINARY_VERSION` 和 `codeagent-wrapper/main.go` 中的 `version`，两值必须一致，否则 `update` 不会触发 binary 重新下载。

---

### utils/skill-registry.ts（v2.0.0 核心创新）

**设计理念**：新增技能 = 只写一个 SKILL.md，零代码改动，自动生成 slash command。

**工作流程**（`src/utils/skill-registry.ts`）：

```
1. parseFrontmatter(content)          # 解析 SKILL.md 中 ---...--- YAML 块
      ↓ name, description, user-invocable, allowed-tools, argument-hint, aliases
2. collectSkills(skillsDir)           # 递归扫描 templates/skills/，每 SKILL.md → SkillMeta
3. collectInvocableSkills()           # 过滤 userInvocable=true
4. generateCommandContent(skill)      # 生成 ~/.claude/commands/ccg/{name}.md
5. installSkillCommands()             # 跳过 installer-data.ts 已有的命令名，避免冲突
```

**SkillMeta 关键字段**（`src/utils/skill-registry.ts:21`）：

| 字段 | 类型 | 含义 |
|------|------|------|
| `name` | `string` | kebab-case slug，即 slash command 名 |
| `userInvocable` | `boolean` | 是否自动生成 slash command（默认 false）|
| `category` | `SkillCategory` | `tool` / `domain` / `orchestration` / `impeccable` / `root` |
| `runtimeType` | `SkillRuntimeType` | `scripted`（有 scripts/*.js）或 `knowledge`（纯 Markdown）|
| `relPath` | `string` | 相对 skills 根目录的路径，决定 category 推断 |

**生成规则**：
- `knowledge` 技能 → 生成 "读取 SKILL.md 按指导完成任务" 的命令内容
- `scripted` 技能 → 生成 `node run_skill.js {name} $ARGUMENTS` 的命令内容
- 每个生成的 command 文件**必须含 YAML frontmatter**，缺失会导致 CC 命令索引级联失败（v2.1.1 修复）
- `skipCategories` 参数支持跳过 `impeccable` 分类（用户可选不安装）

---

### utils/mcp.ts 三端同步

MCP 配置需要在三个工具链同步：

| 工具 | 配置文件 | 同步函数 |
|------|----------|----------|
| Claude Code | `~/.claude.json` | `writeClaudeCodeConfig()` / `mergeMcpServers()` |
| Codex | `~/.codex/config.toml` | `syncMcpToCodex()`（`installer-mcp.ts`）|
| Gemini | `~/.gemini/settings.json` | `syncMcpToGemini()`（`installer-mcp.ts`）|

**`installer-mcp.ts:configureMcpInClaude()` 管线**（`src/utils/installer-mcp.ts:21`）：
```
readClaudeCodeConfig() → backupClaudeCodeConfig() → mergeMcpServers() → fixWindowsMcpConfig() → writeClaudeCodeConfig()
```

**Windows 兼容层**（`src/utils/mcp.ts:87`）：`applyPlatformCommand()` 将 `npx`/`uvx` 命令包装为 `cmd /c npx/uvx`；`repairCorruptedMcpArgs()` 检测并修复 `cmd` 重复、`npx npx` 重复等损坏格式（幂等操作）。

---

### utils/version.ts binary 管理

| 函数 | 说明 |
|------|------|
| `getCurrentVersion()` | 读取 `../../package.json`（相对 dist/src 路径），fallback PACKAGE_ROOT 和 `npm_package_version` |
| `getLatestVersion(pkg)` | 执行 `npm view ccg-workflow version` 获取 npm 最新版 |
| `compareVersions(v1, v2)` | semver 比较，返回 1/-1/0 |
| `checkForUpdates()` | 组合上两者，返回 `{ hasUpdate, currentVersion, latestVersion }` |

---

### i18n/（`src/i18n/index.ts`）

基于 `i18next`，支持 `zh-CN`（默认）和 `en` 双语。

```typescript
export const i18n = i18next

export async function initI18n(lang: SupportedLang): Promise<void>  // 初始化/切换语言
export async function changeLanguage(lang: SupportedLang): Promise<void>
```

**运行时语言选择**：`cli-setup.ts` 在命令注册前先读 `config.toml` 中的 `general.language`，首次安装无配置时 `init.ts` 通过 `inquirer` 让用户选择，之后持久化到 `~/.claude/.ccg/config.toml`。

---

### types/（`src/types/index.ts`）

| 类型 | 用途 |
|------|------|
| `SupportedLang` | `'zh-CN' \| 'en'` |
| `ModelType` | `'codex' \| 'gemini' \| 'claude'` |
| `CollaborationMode` | `'parallel' \| 'smart' \| 'sequential'` |
| `RoutingStrategy` | `'parallel' \| 'fallback' \| 'round-robin'` |
| `ModelRouting` | 前端/后端/review 的模型列表 + 策略 + Gemini 型号 |
| `CcgConfig` | 完整配置结构（general + routing + workflows + paths + mcp + performance）|
| `WorkflowConfig` | 单个工作流定义（id, name, commands[], category, order）|
| `InitOptions` | `init()` 函数参数（lang, skipPrompt, skipMcp, force, frontend, backend, ...）|
| `InstallResult` | 安装结果（installedCommands[], installedPrompts[], installedSkills, errors[]）|
| `AceToolConfig` | `{ baseUrl, token }` |
| `FastContextConfig` | `{ apiKey?, includeSnippets? }` |

---

### utils/installer-template.ts — 模板变量系统

`injectConfigVariables()` 在安装时将模板占位符替换为用户配置值（`src/utils/installer-template.ts:64`）：

| 占位符 | 替换为 | 说明 |
|--------|--------|------|
| `{{FRONTEND_PRIMARY}}` | `gemini` / `codex` | 前端主模型 |
| `{{BACKEND_PRIMARY}}` | `codex` / `gemini` | 后端主模型 |
| `{{FRONTEND_MODELS}}` | JSON 数组 | 前端模型列表 |
| `{{BACKEND_MODELS}}` | JSON 数组 | 后端模型列表 |
| `{{REVIEW_MODELS}}` | JSON 数组 | 审查模型列表 |
| `{{GEMINI_MODEL_FLAG}}` | `--gemini-model xxx ` 或 `""` | v2.1.14 修复：安装时替换，不留到运行时 |
| `{{LITE_MODE_FLAG}}` | `--lite ` 或 `""` | 轻量模式标志 |
| `{{MCP_SEARCH_TOOL}}` | `mcp__ace-tool__search_context` 等 | MCP provider 注册表驱动 |

**PACKAGE_ROOT 解析**（`src/utils/installer-template.ts:17`）：从 `__dirname` 向上最多遍历 10 层，找到包含 `package.json` **且** `templates/` 目录的路径。深度从 5 扩展到 10 是为了兼容 Windows npm 缓存深层路径（`AppData\Local\npm-cache\_npx\<hash>\node_modules\...`）。

---

## 构建管线

```bash
# 类型检查（发版必过，tsc --noEmit）
pnpm typecheck

# 构建（unbuild → dist/cli.mjs + dist/index.mjs，inline 所有依赖）
pnpm build

# 测试（148 用例）
pnpm test

# 发布 —— 不要本地 npm publish；推 tag 由 GitHub Actions 经 OIDC 发布
git tag -a vx.y.z -m "..." && git push origin vx.y.z
```

发版完整规则与 OIDC 排查表见[根目录 CLAUDE.md 的「发版规则」](../CLAUDE.md#发版规则必须严格遵守)。

**build.config.ts**：
```typescript
defineBuildConfig({
  entries: ['src/cli', 'src/index'],  // 双入口：CLI + 库
  declaration: true,                   // 生成 .d.mts 类型文件
  clean: true,
  rollup: {
    emitCJS: false,          // 纯 ESM 输出（package.json "type": "module"）
    inlineDependencies: true, // 打包所有依赖为单文件，无需 node_modules 即可运行
  },
})
```

**为什么选 unbuild**：零配置，自动处理 ESM 输出；`inlineDependencies: true` 使 `bin/ccg.mjs` 在 `npx` 调用时无需额外安装依赖，减少 npx 首次运行等待时间，也避免 Windows 上 node_modules 路径过长问题。

**package.json `files` 白名单**：精确列出所有 `templates/commands/*.md`、`templates/prompts/`、`templates/skills/`、`dist/`、`bin/ccg.mjs`，npm 包从 16.3MB 压缩到 161KB（binary 单独通过 GitHub Release 下载，不打入 npm 包）。

---

## 依赖关系

| 包 | 版本 | 用途 |
|----|------|------|
| `cac` | `^6.7.14` | CLI 框架，`cli-setup.ts` 命令注册 |
| `inquirer` | `^12.9.6` | 交互式提示（list/checkbox/password/confirm） |
| `ora` | `^9.0.0` | 终端 spinner，安装过程进度展示 |
| `ansis` | `^4.1.0` | 终端颜色，零依赖替代 chalk |
| `fs-extra` | `^11.3.2` | `ensureDir`, `pathExists`, `copy` 等便捷 fs 操作 |
| `smol-toml` | `^1.4.2` | 解析 `~/.codex/config.toml`（Codex MCP 同步） |
| `i18next` | — | 国际化框架 |
| `pathe` | — | 跨平台路径操作（统一用 `/` 分隔符，避免 Windows `\` 问题）|

---

## 测试覆盖

`src/utils/__tests__/` 下 6 个测试文件，130+ 用例：

| 测试文件 | 覆盖内容 |
|----------|----------|
| `version.test.ts` | `getCurrentVersion`, `compareVersions`, `checkForUpdates` |
| `config.test.ts` | `readCcgConfig`, `writeCcgConfig`, `createDefaultConfig` |
| `platform.test.ts` | `isWindows`, `getMcpCommand` 跨平台行为 |
| `installer.test.ts` | `installWorkflows` 主流程，template 变量完整性检查 |
| `installWorkflows.test.ts` | 安装结果验证，error 处理路径 |
| `injectConfigVariables.test.ts` | 所有模板占位符替换正确性 |

---

## 关键设计决策

1. **installer 拆 5 模块**（v1.7.83）：单文件 1878 行超出可维护阈值。拆分边界按职责：数据（命令表）/ 模板（变量替换）/ MCP（网络操作）/ prompt（规则文件）/ 主入口（binary + 组合调用）。所有公共 API 统一从 `installer.ts` re-export，调用方无需感知拆分。

2. **Skill Registry frontmatter 驱动**（v2.0.0）：新增技能不需要改 TypeScript 代码，只需写 SKILL.md 并设 `user-invocable: true`。降低贡献门槛，保持命令生成逻辑集中在一处。

3. **binary 不打入 npm 包**（v1.7.77）：npm 包从 16.3MB 降至 161KB，CI 交叉编译后上传 GitHub Release，安装时按需下载。双源（Cloudflare CDN 优先）解决中国用户网络问题。

4. **permissions.allow 替代 Hook**（v1.7.89+）：早期用 PreToolUse Hook + jq 实现 codeagent-wrapper 自动授权，依赖 jq 可用性。改为 `permissions.allow: ["Bash(*codeagent-wrapper*)"]` 后跨平台统一，无外部依赖，且可幂等写入。

5. **`pathe` 替代 Node `path`**：统一路径分隔符为 `/`，避免 Windows `\` 导致的路径字符串比较/替换 bug，对模板路径注入尤为重要。
