# skills-v2 (CCG Multi-Model Collaboration System)

> [根目录](../CLAUDE.md) > **skills-v2**

**Last Updated**: 2026-08-28 (v3.6.1)

> ⚠ 本文档主体仍停留在 v2.1.16 架构描述（v3.0 引擎重构后未全量同步）。下方变更记录保留 v3.x 修复轨迹，完整历史见 [CHANGELOG.md](./CHANGELOG.md)。

---

## 变更记录 (Changelog)

> 完整变更历史请查看 [CHANGELOG.md](./CHANGELOG.md)

### 2026-08-28 (v3.6.1)
- ✨ **帮配 Gemini CLI 第三方 API**（用户反馈：没 Google 账号想用中转但不会配）：init Step 1 末尾 confirm + 菜单 API 配置新选项。新模块 `src/utils/installer-gemini-api.ts` 把 `GOOGLE_GEMINI_BASE_URL`/`GEMINI_API_KEY`（+可选 `GEMINI_MODEL`）以受管块写入 shell rc（zsh/bash/fish 按 `$SHELL` 识别，Windows `setx`），幂等可清除。gemini 见 base URL 自动 `AuthType.GATEWAY`，免登录。
- 📌 **实测硬约束**：gemini-cli 0.53.1 **已移除 .env 加载**（`~/.gemini/.env`、项目 `.env` 全不读，settings.json 无 env 字段，headless 缺配置报 "Invalid auth method selected"）——进程环境变量是唯一通路。网关必须 Gemini 原生协议（`/v1beta/`），OpenAI 中转 404。E2E：真实函数写 rc → zsh source → 真 gemini 请求命中本地假网关（path+key 全对）。
- ✅ 新增 10 例测试（`installer-gemini-api.test.ts`），总 176。

### 2026-08-28 (v3.6.0)
- ⚡ **codex / gemini 子代理免 MCP 冷启动**：wrapper 默认给 codex 注入 `-c mcp_servers={}`、给 gemini 注入 `--allowed-mcp-server-names __ccg_none__`。子代理用不上 MCP（Claude 才是编排者），但 CCG 自己的 `syncMcpToCodex/Gemini` 会把服务器镜像进两家配置——等于自己制造的每次调用连接税（9 server ≈ 25s，v3.3.0 同型实测；本机 3 server 实测 codex "hi" 9.2s → 7.5s）。`--with-mcp` 恢复，与 grok/kimi 影子 HOME 同一开关，new/resume/parallel 全生效。E2E 验证三形状（新会话/resume/逃生门）。
- 📌 **gemini 细节**：无干净禁用开关，空 allowlist 项被 PolicyEngine 拒（"mcpName cannot be empty"），故用哨兵名——名单外 server 全不启动（`--debug` 日志验证：MCP refresh 秒完、8 server 无一 spawn）。gemini 本机端到端因停服卡认证无法验证，与 MCP 无关。
- 🔄 **Binary `5.14.0` → `5.15.0`**。

### 2026-08-27 (v3.5.1)
- ✨ **原生 Claude Code 插件市场**：新增 `.claude-plugin/marketplace.json` + `plugin.json`。CCG 现可 `claude plugin marketplace add fengshao1227/ccg-workflow` → `claude plugin install ccg@ccg` 原生装入全部技能（`/ccg:<skill>`）。**关键设计**：plugin 的 `skills` 字段指向 `templates/skills`（该字段是「追加到默认扫描」语义），且**刻意不声明 `commands`**——`templates/commands` 带 `{{FRONTEND_PRIMARY}}` 占位符、依赖 npx 安装器注入，进原生 plugin 会暴露未解析的坏命令。仓库根无 `commands/`·`agents/`·`skills/` 目录，故默认扫描为空、零误载。`source: "."`（整个仓库即 plugin 根）已过 `claude plugin validate --strict`。多模型编排仍走 `npx`。
- ✨ **三个实战建站独立技能**（脱敏随包发布）：`/ccg:bt-panel`（宝塔/aaPanel API 部署运维，自带 `bt_client.py`+`bt_deploy.py`）、`/ccg:seo-page-builder`（SERP 驱动 SEO 工具页 + `onpage-audit.py`，改编自 yuzeiki 并署名）、`/ccg:adsense-site-auditor`（AdSense 达标审计）。
- 🔄 **impeccable 20 命令收敛为 1 入口**：`/ccg:polish`/`critique`/`animate` 等 20 个设计微调命令曾占可调用命令 65%，已被 `/ccg:frontend-design` 完整融合。现 impeccable 全部 `user-invocable: false`——**可调用命令 31 → 11**，20 个手法降为 frontend-design 的 playbook（文件保留、知识零丢失），frontend-design 内斜杠引用同步改 playbook 引用消除死链。
- ✅ **两组防回归测试**：`skills-hygiene.test.ts`（10 例，扫 `templates/skills/` 全量文本拦截密钥/公网 IP/绝对路径泄漏）+ `plugin-manifest.test.ts`（8 例，校验 marketplace/plugin 版本与 `package.json` 同步、impeccable 收敛不回退、frontend-design 无死链）。
- 🐛 **脱敏**：`bt-panel` 文档内真实宝塔 API 密钥、面板公网 IP、客户项目路径全部占位符化。

### 2026-08-26 (v3.5.0)
- ✨ **APIMart 赞助商集成**：中英 README 顶部 Banner（置于 Gamma Remover 之上），`init` Step 1 与菜单 API 配置新增 APIMart 选项，自动填 Base URL，用户只填 Key。
- ✨ **Codex CLI 接入 APIMart**：新增 `src/utils/installer-codex-api.ts`，把 APIMart 写成 `~/.codex/config.toml` 的 `[model_providers.apimart]`。`codex-mode install` 静默注册（保持非交互），`init` 选 APIMart 时另问是否接 Codex。**注册与启用分离，启用默认否**——翻 `model_provider` 会把用户全部 Codex 请求从订阅改道到按量计费，安装器不该替人默认决定。合并沿用 `syncMcpToCodex()` 的原子写法，用户配置无损；卸载连带摘除该表与悬空 `model_provider`。
- 🐛 **两个 Base URL 极易写反，已分处锁死**：Claude Code 的 `ANTHROPIC_BASE_URL` = `https://api.apimart.ai`（**不带** `/v1`，CC 自己拼 `/v1/messages`）；Codex 的 `base_url` = `https://api.apimart.ai/v1`（**带** `/v1`，OpenAI 协议）。写反表现为静默 404。
- 🔄 **302.AI 赞助结束**：Banner、init/菜单选项、i18n 文案、`assets/sponsors/302.ai*.jpg` 全部移除。
- ✅ **新增 9 例测试**（`installer-codex-api.test.ts`），生成的配置已过 `codex --strict-config`（codex-cli 0.149.0）实测。

### 2026-08-12 (v3.4.0)
- ✨ **OpenCode CLI 后端**：第七个模型选项。`opencode run --format json`，`-m provider/model`，`-s <sessionID>` 恢复。parser 的 opencode 分支靠 `sessionID`（大写 D，与 Gemini 的 `sessionId` 不撞）+ 嵌套 `part` 识别。
- ✨ **纯 Claude Code 模式**：前后端同选 Claude Code 时全程走 Agent Teams 子代理，零外部 CLI 依赖。model-router.md 第 1b 节为优先判定分支。
- 🐛 **嵌套 wrapper 互相误杀（#151）**：Unix 下未设 `Setpgid`，子进程与 wrapper 同组；嵌套会话挤在一个组里，任一层组级清理就会用 SIGINT/SIGTERM 打死无关 wrapper（exit 130 "execution cancelled"）。现在后端独立成组，清理用 `kill(-pgid)`，顺带回收后端自己的 shell 子进程。
- 🔄 **Binary `5.13.0` → `5.14.0`**。

### 2026-08-12 (v3.3.0)
- ⚡ **子代理调用提速 4 倍**：grok/kimi 自动发现 `~/.claude.json` 并连接其中所有 MCP server，实测一句 "hi" 墙钟 32–36 秒而 CPU 仅 6.5 秒。wrapper 现构造"影子 HOME"——真实 HOME 全项符号链接透传，只藏 `.claude.json` 和 `.claude/`，`.gitconfig`/`.npmrc` 不受影响。**32–36 秒 → 7.8 秒**。`--with-mcp` 恢复旧行为，Windows 无符号链接权限自动回退。
- ✨ **Kimi Code CLI 后端**：第六个模型选项，8 角色提示词（含 builder）。`-p` 不可与 `--yolo`/`--auto` 同用（kimi 启动即拒绝），prompt 模式本身即 auto 权限；resume 用 `-S <id>`。
- ✨ **`--kimi-model` + `{{KIMI_MODEL_FLAG}}`**：行级感知注入，留空沿用 kimi 自身 default_model。
- 🔄 **Gemini 降级**：已停服，列表移至末位并标注「不推荐」，推荐位让给 Antigravity / Codex / Grok / Kimi。
- 🐛 **每个会话都被告知 frontend=gemini**：`session-start.js` 硬编码该串且读的是不存在的项目级 config，永远走 fallback。改为读真实用户配置。
- 🐛 **skill-router 前端角色写死 gemini**：改 `{{FRONTEND_PRIMARY}}`。
- 🐛 **默认前端从未被自动放行**：权限白名单只枚举 gemini/codex，antigravity/grok/kimi 每次弹权限提示。改为单条前缀规则。
- 🐛 **`prompts/grok/frontend.md` 自称 "powered by Grok (Gemini 3.5 Flash)"**：v3.2.0 复制残留。
- 🔄 **Binary `5.12.0` → `5.13.0`**。

### 2026-07-12 (v3.2.0)
- ✨ **Grok CLI 后端**：Grok (xAI) 成为第五个模型选项，init Step 2 / 菜单可选为前端或后端；型号可选 `grok-4.5`（500k 上下文）或 `grok-composer-2.5-fast`（Cursor 编码模型）。`/ccg:go` Builder 模式可让 Grok 全权写代码，Claude token 消耗极低。
- ✨ **Grok 专家提示词**：7 角色全套（analyzer/architect/builder/debugger/optimizer/reviewer/tester）→ `~/.claude/.ccg/prompts/grok/`。
- ✨ **`--grok-model` flag + `{{GROK_MODEL_FLAG}}` 模板变量**：行级感知注入，与 gemini flag 同逻辑。
- ✨ **`ccg doctor` Grok 检查**：路由用到 grok 时检查 CLI 存在 + 登录态（auth.json 7 天过期）。
- 🐛 **`--gemini-model` spawn 时被静默丢弃**：单任务模式 executor 重建 cfg 未带模型字段，flag 只出现在显示行、从未到达 gemini 进程。经 TaskSpec 传递修复。
- 🐛 **parallel 模式裸 `--gemini-model <value>` 硬报错**：值掉进 extras 触发 "only --backend..." 中止。现消费值后警告忽略。
- 🐛 **`ccg update` 重配路由丢 `geminiModel`**：现与 `grokModel` 一并保留。
- 🔄 **Binary `5.11.1` → `5.12.0`**：grok 后端（streaming-json 解析 / `-p` 传参 / `-r` 会话恢复 / PATH + `~/.grok/bin` 回退）。

### 2026-07-09 (v3.1.11)
- ✨ **`ccg doctor` 命令**：一键环境健康检查（Node 版本、配置、命令、Hooks、Binary、Skills、Rules、MCP、Codex 模式），有问题标红。
- ✨ **`ccg status` 命令**：安装概况（版本+更新检查、模型路由、MCP 列表、活跃任务数）。
- ✨ **Codecov 集成**：CI 上传覆盖率到 Codecov，README 展示覆盖率 badge。
- ✨ **项目健康文件**：新增 SECURITY.md、CODE_OF_CONDUCT.md、.node-version，package.json 补全 repository/homepage/bugs/engines。
- ✨ **Codex 模式版本标记**：`codex-mode install` 写入 `~/.codex/.ccg-version`。

### 2026-07-04 (v3.1.9)
- ✨ **非交互 CLI 命令**：新增 `ccg codex-mode install`/`uninstall` 和 `ccg uninstall`，支持脚本/CI 无交互调用。
- 🐛 **质量关卡 rule 用了错误的 skill 名（#148）**：`ccg-skills.md` 指示 AI 调用不带 `ccg:` 前缀的命令名，但实际注册的命令是 `/ccg:verify-security` 等。AI 按 rule 调用失败后跳过质量关卡。修复：所有引用改为带 `/ccg:` 前缀。

### 2026-06-18 (v3.1.6)
- ✨ **CodeGraph MCP 可选安装（#145）**：init Step 3 新增 `codegraph` 选项，本地代码知识图谱（调用链/影响范围/架构查询）。安装 MCP（`npx @colbymchenry/codegraph serve --mcp`）+ 写入 `ccg-codegraph.md` 使用规则。规则指示 AI 在无 `.codegraph/` 时自动 `codegraph init` 建索引，优先 `codegraph_explore` 查结构、`fast_context_search` 查语义、grep 查精确文本。
- 🐛 **Codex 模式 AGENTS.md 缺少 `.exe` 路径替换（#147）**：`installCodexMode()` 对 AGENTS.md 只调了 `injectConfigVariables()` 没调 `replaceHomePathsInTemplate()`，Windows 上 `~/.claude/bin/codeagent-wrapper` 未替换为绝对路径 + `.exe`，Codex app 找不到 binary。
- 🐛 **Antigravity 后端 Windows 静默无输出（#146）**：Windows 上 wrapper 把 antigravity 的 prompt 走 stdin pipe（与 gemini 相同，为避免 cmd.exe 多行截断）。但 `agy` 不读 stdin、只认 `-p` 参数，收到 `-p ""` 后直接 exit 0 无输出。修复：antigravity 在所有平台统一走 `-p` 传参；仅 gemini 在 Windows 保留 stdin pipe。

### 2026-06-10 (v3.1.5)
- 🐛 **完成的任务被误判为活跃 → 无限注入面包屑**：hooks 只认 `completed`/`archived` 为终态，但任务 `status` 是模型自由文本写入，常漂移成 `done`/`finished` 等近义词。以 `status: "done"` 收尾的任务被判为未完成，`workflow-state.js`（及 Codex 模式 `ccg-workflow.py`）持续注入面包屑。修复：判定端容错——`task-utils.js` 新增 `isTerminalStatus()`、`ccg-workflow.py` 新增 `_is_terminal_status()`，匹配一组近义终态词（completed/complete/done/finished/archived/cancelled/closed/resolved/... 大小写+空格归一）。写入端规范仍用 `completed`，读端宽容。已验证：`done` → 无活跃任务；`in_progress` → 面包屑正常。
- 🐛 **Claude 审核后端可能卡在工具权限上（#143）**：`codeagent-wrapper` 的 claude 后端只在 `cfg.SkipPermissions` 时才加 `--dangerously-skip-permissions`，但无任何调用方传它（死代码）。gemini 后端永远带 `-y` 自主运行，claude 是唯一异类。鉴于 wrapper 只用于自主编排（审核/分析/实施），claude 后端现改为像 gemini 一样恒定绕过权限，headless 审核读 diff/文件时不再卡在权限门。binary `5.11.0` → `5.11.1`。
- 🐛 **live output 浏览器抢占前台焦点（#139）**：macOS 用 `open <url>` 打开 SSE Web UI 会把浏览器拉到最前、打断用户当前操作。改用 `open -g` 后台打开、不抢焦点。Linux/Windows 行为不变（无可移植的后台标志）。

### 2026-06-07 (v3.1.4)
- ✨ **SubAgent 直接上下文注入**：`subagent-context.js` 的 Agent/Team spawn 分支改用 PreToolUse `updatedInput` 改写子 agent 的 `prompt`，将 `<ccg-injected-context>`（spec + task + research）直接注入子 agent。之前用 `additionalContext` 仅注入主控上下文，子 agent 读不到。好处：子 agent 出生即带 spec；角色过滤真正到达正确 agent；主控上下文更干净（减少编排幻觉）。Bash/codeagent-wrapper 分支保留 `additionalContext`（主控构造 HEREDOC，路径本就正确）。
- ✨ **`outputHook()` 扩展**：`task-utils.js` 的 `outputHook()` 新增可选第三参数 `extra`，合并进 `hookSpecificOutput`，支持传递 `updatedInput`/`permissionDecision`。向后兼容，现有双参数调用行为不变。

### 2026-06-01 (v3.1.3)
- 🐛 **卸载残留 hooks 与 settings**：`uninstallWorkflows` 是 v3.0 引擎重构前写的，从未删除 `~/.claude/hooks/ccg/`（5 个脚本）和 `settings.json` 的 CCG hook 注册（`UserPromptSubmit`/`SessionStart`/`PreToolUse`）。现补删 hooks/ccg 目录 + 精确清理 CCG hook 注册（按 `hooks/ccg/` 命令路径识别，保留用户自有 hooks），新增 `removedHooks` 字段，装→卸载闭环测试验证。impeccable skip 经实测正常（v3 模式 `impeccable found: []`），用户本机残留 impeccable 系历次卸载不净累积。

### 2026-05-30 (v3.1.2)
- 🐛 **Codex 模式 hook 加载错目录**：`hooks.json` 用相对路径 `python3 .codex/hooks/ccg-workflow.py`，Codex 从项目目录而非用户 home 找脚本。`installCodexMode` 安装时将 `~/` 替换为绝对 home 路径写入。
- 🐛 **Codex 模式仍调 `--backend gemini`**：`hooks/ccg-workflow.py` 硬编码 "Gemini"/`--backend gemini` 且未走 `injectConfigVariables`，叠加 antigravity 默认 + Gemini CLI 日落导致外部模型空响应。改用 `{{FRONTEND_PRIMARY}}` 占位符 + 安装时注入，AGENTS.md 描述文字同步去硬编码。

### 2026-04-10 (v2.1.16)
- ✨ **Init 交互状态机**：`init` 重构为状态机，每步首个 list 内嵌 `← 返回上一步` 和 `× 取消` 哨兵；Step 3 MCP 因首 prompt 是 checkbox，加前导 list 守门；解决"填错要 Ctrl+C 全部重来"痛点
- ✨ **摘要页跳回菜单**：最终确认页改 list 菜单，支持"改 API / 改模型 / 改 MCP / 改性能"任意跳回，跑完自动回摘要
- ✨ **API 跳过选项**（用户反馈）：Step 1/4 新增"跳过 — 我已通过 cc-switch / 其他工具自行配置"选项，不写 `settings.json` 的 `ANTHROPIC_*`
- 🔄 **`src/commands/init.ts`**：Step 1-4 抽取闭包函数 + 主循环状态机，net +200 行；i18n 新增 `nav`/`summaryMenu`/`api.skipOption` 等 key

### 2026-04-10 (v2.1.15)
- 🐛 **`--gemini-model` 泄漏到纯 codex 调用行修复**（#130）：`injectConfigVariables()` 改为行级感知替换，纯 `--backend codex/claude` 行清除 flag，`--backend gemini` 和条件行 `<codex|gemini>` 保留。新增 11 个单元测试。

### 2026-04-10 (v2.1.14)
- 📝 **CLAUDE.md 全量同步**：命令 29、提示词 19（claude/6+codex/6+gemini/7）、Agent 7、子模块文档建立（src/CLAUDE.md、templates/CLAUDE.md、codeagent-wrapper/CLAUDE.md 三个子索引）

### 2026-04-07 (v2.1.14)
- 🐛 **模型路由硬编码修复**：21 个模板 ROLE_FILE 路径 + 表头 + 执行指令全部动态化，`{{BACKEND_PRIMARY}}/{{FRONTEND_PRIMARY}}` 替代硬编码 `codex/gemini`

### 2026-04-05 (v2.1.13)
- 🐛 **Windows Gemini 多行参数截断**（#129）：Windows 上 cmd.exe 截断多行 `-p` 参数，改用 stdin pipe；binary `5.9.0` → `5.10.0`

### 2026-04-03 (v2.1.12)
- ✨ **302.AI 赞助商集成**（#126）：init + 菜单 API 配置新增 302.AI 选项，自动填入 baseUrl，CLI 显示返现链接
- ✨ **README 赞助商 Banner**：中英文 README 顶部新增 302.AI 可点击 Banner + 产品介绍

### 2026-03-31 (v2.1.11)
- 🐛 **更新后 MCP 提示词显示未配置**（#124）：`update` 无条件传 `--skip-mcp` 导致 `mcpProvider` 被覆盖，修复为从已有配置恢复
- ✨ **Impeccable 命令可选安装**（#125）：init 新增 confirm 提示，20 个前端设计命令默认不安装
- ✨ **X (Twitter) 社区入口**：README 加 `@CCG_Workflow` 徽章 + demo 推文 + Contact 区

### 2026-03-31 (v2.1.1)
- 🐛 **Skill Registry 命令 frontmatter 修复**：`generateCommandContent()` 生成的 27 个 command 文件补上 YAML frontmatter，修复 CC 命令索引级联失败

### 2026-03-31 (v2.1.0)
- ✨ **模型路由可配置**（Issue #121）：init Step 2/4 选前端/后端模型（gemini/codex/claude），Gemini 型号可选
- ✨ **菜单模型路由配置**：`6. 配置模型路由`，切换后自动重装模板
- 🔄 **20+ 模板去硬编码**：`--backend gemini`/`--backend codex` 替换为 `{{FRONTEND_PRIMARY}}`/`{{BACKEND_PRIMARY}}`
- 🔄 **`{{GEMINI_MODEL_FLAG}}` 安装时替换**：不再留给运行时解释

### 2026-03-31 (v2.0.0)
- ✨ **Skill Registry 机制**：SKILL.md frontmatter 驱动自动命令生成，新增技能只需写一个 SKILL.md
- ✨ **域知识秘典全量导入**：10 大领域 61 个知识文件（安全/架构/DevOps/AI/开发/前端设计/基础设施/移动端/数据工程/编排）
- ✨ **Impeccable 工具集**：20 个 UI/UX 精打磨技能（polish/audit/harden/clarify/critique 等）
- ✨ **Override-Refusal**：`/hi` 命令，会话级反拒绝覆写器
- ✨ **Scrapling 技能**：网页抓取，支持 Cloudflare/WAF 绕过
- ✨ **3 个新输出风格**：冷刃简报 + 铁律军令 + 祭仪长卷，总数 8 种
- 🏗 **`skill-registry.ts`**：新模块，frontmatter 解析 + 技能发现 + 命令生成

### 2026-03-30 (v1.8.3)
- ✨ **`/ccg:team` 统一工作流**：第 28 个斜杠命令，8 阶段企业级工作流（需求→架构→规划→开发→测试→审查→修复→集成），7 角色 Agent Teams 自动编排
- ✨ **3 个新 Agent**：`team-architect`（架构师）、`team-qa`（QA 工程师）、`team-reviewer`（代码审查员）
- ✨ **Evaluator-Optimizer 反馈环**：最多 2 轮自动修复 Critical 问题
- ✨ **多模型交叉**：架构阶段 Codex∥Gemini 并行分析，审查阶段双模型交叉验证

### 2026-03-27 (v1.8.2)
- 🐛 **Windows ccline 状态栏修复**：路径从 `%USERPROFILE%` 改为 `~`，Claude Code 统一支持

### 2026-03-27 (v1.8.1)
- 🐛 **WORKDIR 路径推断修复**：20 个命令模板强制 `pwd`/`cd` 获取工作目录，禁止从 `$HOME` 推断，修复沙箱/云端环境路径错误
- 🐛 **spec-init 目录防御**：Step 3 禁止 `cd` 到其他路径
- 🐛 **Windows 兼容**：WORKDIR 获取支持 `pwd`（Unix）+ `cd`（Windows CMD）

### 2026-03-26 (v1.8.0)
- 🐛 **Gemini session_id 解析修复**：修复 Gemini CLI init 事件前 MCP 文本导致 JSON 解析失败，恢复 session_id 捕获
- 🐛 **Gemini 会话复用恢复**：所有模板恢复 `resume <SESSION_ID>`，支持并行多会话
- ✨ **spec-impl 跨阶段会话复用**：原型→审查复用 `CODEX_PROTO_SESSION` / `GEMINI_PROTO_SESSION`

### 2026-03-26 (v1.7.97)
- 🐛 **Gemini `-p -` 显示修正**：`Command:` 行显示真实任务文本而非 `-p -`，消除误导
- 🐛 **Session-ID 早期输出**：wrapper 在 `session_started` 时立即输出 `Session-ID:` 到 stderr，防止超时后 Claude 误用 PID resume
- 🔄 **Binary 版本升级**：`5.8.0` → `5.9.0`

### 2026-03-25 (v1.7.92)
- ✨ **初始化交互重构**：3 步流程（API 提供方 → MCP 多选 → 性能模式），赞助商预留位，MCP 多选共存
- 🐛 **第三方 API 修复**：`ANTHROPIC_API_KEY` → `ANTHROPIC_AUTH_TOKEN`，修复 `/login` 问题
- 🐛 **Gemini CLI stdin 修复**：`-p -` → `-p "任务文本"`，修复 Gemini 无法调用

### 2026-03-25 (v1.7.91)
- 🐛 **Gemini CLI stdin 兼容性修复**：`-p -` 改为 `-p "任务文本"` 直接传递，修复 Gemini 无法调用的问题

### 2026-03-23 (v1.7.90)
- ✨ **`--progress` 进度输出**：codeagent-wrapper 新增 `--progress` 参数，后台任务 stderr 输出精简进度行，告别黑箱等待（PR #112）
- 🐛 **全模板 `--progress` 覆盖**：补漏 `debug.md`、`spec-review.md`、`codex-exec.md` review 调用

### 2026-03-20 (v1.7.89)
- 🐛 **权限规则匹配修复**：`Bash(*codeagent-wrapper*)` 加前导通配符，修复 Windows/macOS 完整路径不匹配
- 🐛 **spec-init `<<<` 拦截修复**：改用管道替代 here-string
- 🔄 **全平台 permissions.allow**：macOS/Linux 不再依赖 Hook + jq，升级自动迁移清理

### 2026-03-19 (v1.7.88)
- 🐛 **TS 类型错误修复**：`installer-mcp.ts` 参数类型收紧为 `McpServerConfig`，修复 `tsc --noEmit` 报错
- 🔄 **发版流程加固**：`pnpm typecheck` + `pnpm test` 列为发版必检项

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

1. **多模型协作编排**：可配置路由 Gemini（前端）+ Codex（后端）+ Claude（编排），v2.1.0+ 支持切换
2. **29 个斜杠命令**：开发工作流 + Git 工具 + 项目管理 + OPSX + Agent Teams + Codex 执行 + Prompt 增强 + Skill Registry 自动生成
3. **19 个专家提示词**：Claude 6 个 + Codex 6 个 + Gemini 7 个
4. **7 个子智能体**：planner / ui-ux-designer / init-architect / get-current-datetime / team-architect / team-qa / team-reviewer
5. **Skill Registry**：SKILL.md frontmatter 驱动，user-invocable 技能自动生成 slash commands
6. **100+ 技能文件**：6 质量关卡 + 10 域知识秘典（61 文件）+ 20 impeccable 工具 + scrapling + override-refusal
7. **跨平台 CLI 工具**：一键安装（支持 macOS、Linux、Windows）
8. **MCP 集成**：fast-context（推荐）/ ace-tool / ContextWeaver + context7（自动安装）+ Codex & Gemini MCP 同步
9. **Agent Teams 并行实施**：Team 系列 5 个命令（含统一工作流），spawn Builder teammates 并行写代码
10. **8 种输出风格**：默认 + 专业工程师 + 猫娘 + 老王 + 大小姐 + 邪修 + 冷刃简报 + 铁律军令 + 祭仪长卷

---

## 模块索引

| 子模块 | 文档 | 职责 |
|--------|------|------|
| TypeScript CLI 源码 | [src/CLAUDE.md](./src/CLAUDE.md) | CLI 主入口、命令实现、安装器、i18n、工具链 |
| 模板文件 | [templates/CLAUDE.md](./templates/CLAUDE.md) | 斜杠命令、提示词、子智能体、技能、规则模板 |
| codeagent-wrapper | [codeagent-wrapper/CLAUDE.md](./codeagent-wrapper/CLAUDE.md) | Go 二进制包装器，多模型调用桥接，v5.10.0 |

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
  - `config` - MCP 配置管理（`src/commands/config-mcp.ts`）
  - `diagnose-mcp` - MCP 诊断（`src/commands/diagnose-mcp.ts`）

### codeagent-wrapper 入口

- **主入口**：`codeagent-wrapper/main.go`
- **当前版本**：v5.10.0
- **调用语法**：
  ```bash
  codeagent-wrapper --backend <codex|gemini|claude> - [工作目录] <<'EOF'
  <任务内容>
  EOF
  ```
- 详见 [codeagent-wrapper/CLAUDE.md](./codeagent-wrapper/CLAUDE.md)

---

## 对外接口

### CLI 命令接口

| 命令 | 用途 |
|------|------|
| `npx ccg-workflow` | 一键安装/菜单 |
| `npx ccg-workflow menu` | 交互式菜单 |
| `npx ccg-workflow update` | 更新到最新版本 |
| `npx ccg-workflow diagnose-mcp` | 诊断 MCP 配置 |

### Slash Commands 接口（29 个）

**开发工作流**：
| 命令 | 用途 | 模型 |
|------|------|------|
| `/ccg:workflow` | 完整 6 阶段工作流 | Codex ∥ Gemini |
| `/ccg:plan` | 多模型协作规划（Phase 1-2） | Codex ∥ Gemini |
| `/ccg:execute` | 多模型协作执行（Phase 3-5） | Codex ∥ Gemini + Claude |
| `/ccg:codex-exec` | Codex 全权执行计划（MCP + 代码 + 测试） | Codex + 多模型审核 |
| `/ccg:context` | 项目上下文管理（.context 初始化/日志/压缩/历史） | Claude |
| `/ccg:enhance` | 内置 Prompt 增强，将模糊需求转化为结构化任务描述 | Claude |
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

**OpenSpec (OPSX) 封装**：
| 命令 | 用途 |
|------|------|
| `/ccg:spec-init` | 初始化 OpenSpec 环境 + 验证多模型 MCP |
| `/ccg:spec-research` | 需求 → 约束集（并行探索 + OPSX 提案） |
| `/ccg:spec-plan` | 多模型分析 → 消除歧义 → 零决策可执行计划 |
| `/ccg:spec-impl` | 按规范执行 + 多模型协作 + 归档 |
| `/ccg:spec-review` | 双模型交叉审查（独立工具，随时可用） |

**Agent Teams 并行实施**（v1.7.60+，需启用 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`）：
| 命令 | 用途 | 说明 |
|------|------|------|
| `/ccg:team` | **统一工作流（推荐）** | 8 阶段全流程：需求→架构→规划→开发→测试→审查→修复→集成，7 角色自动编排 |
| `/ccg:team-research` | 需求 → 约束集 | 并行探索代码库，Codex + Gemini 双模型分析 |
| `/ccg:team-plan` | 约束 → 并行计划 | 消除歧义，拆分为文件范围隔离的独立子任务 |
| `/ccg:team-exec` | 并行实施 | spawn Builder teammates（Sonnet）并行写代码 |
| `/ccg:team-review` | 双模型审查 | Codex + Gemini 交叉审查，分级处理 Critical/Warning/Info |

---

## 固定 / 可配置项

| 项目 | 默认值 | 可配置 | 说明 |
|------|--------|--------|------|
| 语言 | 中文 | ✗ | 所有模板为中文 |
| 前端模型 | Antigravity | ✓ (v2.1.0+) | init Step 2/4 / 菜单 6，可选 gemini/codex/grok |
| 后端模型 | Codex | ✓ (v2.1.0+) | init Step 2/4 / 菜单 6，可选 gemini/antigravity/grok |
| Gemini 型号 | gemini-3.1-pro-preview | ✓ (v2.1.0+) | 选 gemini 时可配 |
| Grok 型号 | grok-4.5 | ✓ (v3.2.0+) | 选 grok 时可配，代码任务可选 grok-composer-2.5-fast |
| Kimi 型号 | 空（用 kimi 默认） | ✓ (v3.3.0+) | 选 kimi 时可配 |
| OpenCode 型号 | 空（用 opencode 默认） | ✓ (v3.4.0+) | 选 opencode 时可配，格式 provider/model |
| 协作模式 | smart | ✗ | 最佳实践 |
| 命令数量 | 29 个 | ✗ | 全部安装 |

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
├── cli.ts                       # CLI 入口
├── cli-setup.ts                 # 命令注册
├── index.ts                     # 模块导出
├── commands/
│   ├── init.ts                  # 初始化命令
│   ├── update.ts                # 更新命令
│   ├── menu.ts                  # 交互式菜单
│   ├── config-mcp.ts            # MCP 配置管理
│   └── diagnose-mcp.ts          # MCP 诊断
├── i18n/
│   └── index.ts                 # 国际化（v1.7.69+）
├── types/
│   ├── cli.ts                   # CLI 类型定义
│   └── index.ts                 # 类型导出
└── utils/
    ├── installer.ts             # 安装器主入口（v1.7.83 重构后）
    ├── installer-data.ts        # 安装数据流
    ├── installer-mcp.ts         # MCP 安装子模块
    ├── installer-prompt.ts      # 提示词安装子模块
    ├── installer-template.ts    # 模板安装子模块
    ├── skill-registry.ts        # Skill Registry（v2.0.0 frontmatter 驱动）
    ├── migration.ts             # 版本迁移
    ├── version.ts               # 版本检查/下载
    ├── config.ts                # 配置管理
    ├── mcp.ts                   # MCP 工具集成
    ├── platform.ts              # 平台检测
    └── __tests__/               # 单元测试
        ├── installer.test.ts
        ├── installWorkflows.test.ts
        ├── injectConfigVariables.test.ts
        ├── version.test.ts
        ├── config.test.ts
        └── platform.test.ts
```

详见 [src/CLAUDE.md](./src/CLAUDE.md)

### 模板文件

```
templates/
├── commands/                    # 29 个斜杠命令
│   ├── workflow.md              # 完整 6 阶段工作流
│   ├── plan.md                  # 多模型协作规划
│   ├── execute.md               # 多模型协作执行
│   ├── codex-exec.md            # Codex 全权执行计划
│   ├── context.md               # 项目上下文管理（.context）
│   ├── enhance.md               # 内置 Prompt 增强
│   ├── frontend.md              # 前端专项
│   ├── backend.md               # 后端专项
│   ├── feat.md                  # 智能功能开发
│   ├── analyze.md               # 技术分析
│   ├── debug.md                 # 问题诊断 + 修复
│   ├── optimize.md              # 性能优化
│   ├── test.md                  # 测试生成
│   ├── review.md                # 代码审查
│   ├── init.md                  # 初始化项目 CLAUDE.md
│   ├── commit.md                # 智能 Git 提交
│   ├── rollback.md              # 交互式回滚
│   ├── clean-branches.md        # 清理已合并分支
│   ├── worktree.md              # Worktree 管理
│   ├── spec-init.md             # 初始化 OpenSpec 环境
│   ├── spec-research.md         # 需求 → 约束集
│   ├── spec-plan.md             # 多模型分析 → 执行计划
│   ├── spec-impl.md             # 按规范执行 + 归档
│   ├── spec-review.md           # 双模型交叉审查
│   ├── team.md                  # Agent Teams 统一工作流
│   ├── team-research.md         # Agent Teams 需求→约束
│   ├── team-plan.md             # Agent Teams 规划
│   ├── team-exec.md             # Agent Teams 并行实施
│   ├── team-review.md           # Agent Teams 审查
│   └── agents/                  # 7 个子智能体
│       ├── planner.md           # 任务规划师
│       ├── ui-ux-designer.md    # UI/UX 设计师
│       ├── init-architect.md    # 初始化架构师
│       ├── get-current-datetime.md  # 日期时间获取
│       ├── team-architect.md    # 团队架构师（v1.8.3+）
│       ├── team-qa.md           # QA 工程师（v1.8.3+）
│       └── team-reviewer.md     # 代码审查员（v1.8.3+）
├── prompts/                     # 19 个专家提示词
│   ├── claude/                  # 6 个 Claude 提示词
│   │   ├── analyzer.md
│   │   ├── architect.md
│   │   ├── debugger.md
│   │   ├── optimizer.md
│   │   ├── reviewer.md
│   │   └── tester.md
│   ├── codex/                   # 6 个 Codex 提示词
│   │   ├── analyzer.md
│   │   ├── architect.md
│   │   ├── debugger.md
│   │   ├── optimizer.md
│   │   ├── reviewer.md
│   │   └── tester.md
│   └── gemini/                  # 7 个 Gemini 提示词
│       ├── analyzer.md
│       ├── architect.md
│       ├── debugger.md
│       ├── frontend.md
│       ├── optimizer.md
│       ├── reviewer.md
│       └── tester.md
├── output-styles/               # 8 种输出风格
│   ├── engineer-professional.md
│   ├── nekomata-engineer.md
│   ├── laowang-engineer.md
│   ├── ojousama-engineer.md
│   ├── abyss-cultivator.md
│   ├── abyss-concise.md
│   ├── abyss-command.md
│   └── abyss-ritual.md
├── rules/                       # 全局规则（→ ~/.claude/rules/）
│   ├── ccg-skills.md            # 质量关卡自动触发规则
│   └── ccg-skill-routing.md     # 域知识自动路由规则
└── skills/                      # 100+ 技能文件（质量关卡 + 域知识 + impeccable + 工具）
    ├── run_skill.js
    ├── SKILL.md
    ├── tools/
    │   ├── verify-security/     # 安全漏洞扫描
    │   ├── verify-quality/      # 代码质量检测
    │   ├── verify-change/       # 变更影响分析
    │   ├── verify-module/       # 模块完整性校验
    │   ├── gen-docs/            # 文档自动生成
    │   ├── override-refusal/    # /hi 反拒绝覆写器
    │   └── lib/                 # 共享工具库
    ├── domains/                 # 10 大领域知识秘典（61 文件）
    │   ├── security/            # 红队/蓝队/渗透/审计/逆向/威胁情报
    │   ├── architecture/        # API/缓存/云原生/消息队列/安全架构
    │   ├── devops/              # Git/测试/数据库/性能/可观测性/成本优化
    │   ├── ai/                  # Agent/RAG/LLM安全/Prompt工程
    │   ├── development/         # Go/Python/Rust/TS/Java/C++/Shell
    │   ├── frontend-design/     # UI美学/组件/UX + 4种设计风格
    │   ├── infrastructure/
    │   ├── mobile/
    │   ├── data-engineering/
    │   └── orchestration/
    ├── impeccable/              # 20 个 UI/UX 精打磨技能
    ├── scrapling/               # 网页抓取技能（Cloudflare/WAF 绕过）
    └── orchestration/
        └── multi-agent/
```

详见 [templates/CLAUDE.md](./templates/CLAUDE.md)

### 预编译产物

```
bin/
├── ccg.mjs                              # CLI 入口脚本
├── codeagent-wrapper-darwin-amd64       # macOS Intel
├── codeagent-wrapper-darwin-arm64       # macOS Apple Silicon
├── codeagent-wrapper-linux-amd64        # Linux x64
├── codeagent-wrapper-linux-arm64        # Linux ARM64
├── codeagent-wrapper-windows-amd64.exe  # Windows x64
└── codeagent-wrapper-windows-arm64.exe  # Windows ARM64
```

---

## 架构图

```mermaid
graph TD
    User["用户"] --> CLI["npx ccg-workflow"]
    CLI --> Init["一键安装"]

    Init --> Commands["~/.claude/commands/ccg/<br/>29 个命令"]
    Init --> Agents["~/.claude/agents/ccg/<br/>7 个子智能体"]
    Init --> Skills["~/.claude/skills/ccg/<br/>100+ 技能文件"]
    Init --> Prompts["~/.claude/.ccg/prompts/<br/>19 个专家提示词"]
    Init --> Binary["~/.claude/bin/<br/>codeagent-wrapper v5.10.0"]
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

### 5. 本地验证

```bash
pnpm typecheck   # tsc --noEmit，必须在 build 前通过
pnpm build
pnpm test
```

### 6. 提交 + 打 tag 发布

**⛔ 不要在本地跑 `npm publish`。** 自 v3.5.0 起，npm 发布由 GitHub Actions 通过
**Trusted Publishing (OIDC)** 完成，本地和 CI 都不存任何 npm token（[publish.yml](.github/workflows/publish.yml)）。

```bash
git add -A
git commit -m "chore: bump version to x.y.z"
git push origin main

# 推 tag 触发发布（tag 名必须是 v 前缀 + package.json 里的版本号）
git tag -a vx.y.z -m "vx.y.z — 一句话说明"
git push origin vx.y.z
```

CI 会自动跑 typecheck → test → build → 校验 tag 与 `package.json` 一致 → 校验该版本未发布过 →
`npm publish --provenance`。查看结果：

```bash
gh run list --workflow=publish.yml --limit 1
npm view ccg-workflow version          # 确认线上版本
```

需要重跑而不想动 tag 时用 `gh workflow run publish.yml --ref main`。

#### 发布失败排查（OIDC 的坑很隐蔽，报错全是误导）

先用 `--loglevel verbose` 重跑，然后只看这一行：

```
npm http fetch POST <码> https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/ccg-workflow
```

| 现象 | 真实含义 | 处理 |
|------|---------|------|
| **没有这一行** | npm 压根没发起 OIDC 交换 | 查是否有残留凭据。**`actions/setup-node` 的 `registry-url` 是元凶**——它会写 `_authToken=${NODE_AUTH_TOKEN}`，无 secret 时展开成空 token，npm 便跳过 OIDC。workflow 里已刻意不设该参数，勿加回 |
| `404` + `package not found` | npm 侧没有该**包**的 Trusted Publisher 记录 | 去 npmjs.com/package/ccg-workflow/access 配（注意是**包**的设置，不是账号设置） |
| `201` | 交换成功 | 正常 |

⚠ 普通日志级别看不到这行，这是区分「workflow 配错」和「npm 后台没配」的唯一依据。
⚠ **provenance 签名成功 ≠ npm 认证成功** —— 那走 Sigstore，与 npm 认证是两条独立路径，极易误判。
⚠ Node 22 自带 npm 10.x 无 OIDC 支持，workflow 里的 `npm install -g npm@latest`（需 ≥ 11.5.1）不可删。

npm 网页的 README 有服务端渲染缓存，发布后要等一会儿才更新（无痕也绕不过）；
想立刻确认内容用 `npm view ccg-workflow readme | head -20` 直接读 registry。

### 检查清单
- [ ] package.json 版本号已更新
- [ ] CHANGELOG.md 已添加新版本条目
- [ ] README.md **和 README.zh-CN.md** 已更新（命令表 + 使用说明 + 底部版本号，两份都要）
- [ ] CLAUDE.md 已更新（Last Updated + 变更记录 + 受影响章节）
- [ ] **⚠ 若修改了 `codeagent-wrapper/` 下的 Go 代码，必须同步 bump 两处版本号：**
  - [ ] `codeagent-wrapper/main.go` → `version = "x.y.z"`
  - [ ] `src/utils/installer.ts` → `EXPECTED_BINARY_VERSION = 'x.y.z'`
  - 两边版本必须一致，否则用户 update 时无法触发 binary 重新下载
  - **⛔ 禁止手动 `gh release upload`！** 推送 Go 代码后 CI（`.github/workflows/build-binaries.yml`）会自动编译 + 上传 GitHub Release + 同步 Cloudflare R2 镜像。手动上传会覆盖 CI 产物且 R2 不会同步
- [ ] `pnpm typecheck` 通过（tsc --noEmit，不可跳过）
- [ ] `pnpm build` 通过
- [ ] `pnpm test` 通过
- [ ] `git push origin main` 成功
- [ ] `git push origin vx.y.z` 成功，且 publish.yml 跑绿
- [ ] `npm view ccg-workflow version` 已是新版本

---

**扫描覆盖率**: 95%+
**最后更新**: 2026-04-10
