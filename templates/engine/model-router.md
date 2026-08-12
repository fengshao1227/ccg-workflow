# CCG 模型路由器 — 运行时模型选择框架

> 本文件由策略文件通过 Read 加载，提供动态模型选择和 codeagent-wrapper 调用模板。

## 1. 获取模型配置

读取用户配置确定可用模型：

```
Read ~/.claude/.ccg/config.toml
```

从 `[routing]` 区块提取：
- `frontend.primary` — 前端模型（默认 `antigravity`，可选 `grok` / `kimi` / `codex` / `opencode` / `claude`；`gemini` 已停服不推荐）
- `backend.primary` — 后端模型（默认 `codex`，可选 `grok` / `kimi` / `opencode` / `antigravity` / `claude`；`gemini` 已停服不推荐）
- `geminiModel` — Gemini 型号（默认 `gemini-3.1-pro-preview`）
- `grokModel` — Grok 型号（默认 `grok-4.5`，代码实施可选 `grok-composer-2.5-fast`）
- `kimiModel` — Kimi 模型别名（留空 = 用 kimi 自身配置的 default_model）
- `opencodeModel` — Opencode 模型 `provider/model`（留空 = 用 opencode 默认）

如果配置文件不存在或不可读，使用默认值直接继续。

## 1b. ⚡ 纯 Claude Code 模式（优先判定）

**如果 `frontend.primary` 和 `backend.primary` 都是 `claude`**，则本项目运行在纯 CC 模式：

- **⛔ 不调用 codeagent-wrapper，不启动任何外部模型 CLI。** 本文件后续所有 `--backend` 调用模板一律不适用。
- 所有原本交给外部模型的阶段，改用 **Agent Teams 子代理**（`TeamCreate` + `Agent`）完成：

| 原外部模型角色 | 纯 CC 模式替代 |
|---------------|---------------|
| backend 模型分析 | `Agent(subagent_type: "general-purpose")`，prompt 内联 `~/.claude/.ccg/prompts/claude/analyzer.md` 的角色要求 |
| frontend 模型分析 | 同上，但用不同视角（前端/UX）——**两个 Agent 必须在同一条消息中 spawn 才是真并行** |
| 双模型交叉审查 | spawn 两个 reviewer Agent，各自独立审查后由主控综合 |
| Builder 模式实施 | `team-*` Agent 或 `general-purpose` Agent 并行写代码，按文件范围隔离 |

- 交叉验证的价值来自**独立上下文 + 不同视角**，而不是不同厂商的模型。每个 Agent 都在干净上下文中启动，因此纯 CC 模式仍保留多视角交叉验证的核心收益。
- 优点：零外部依赖、无 CLI 冷启动开销、无需登录任何第三方账号。
- 代价：全部 token 计在 Claude 账号上。若要省 Claude 额度，请把 backend 换成 `codex` / `grok` / `kimi` / `opencode`。

判定为纯 CC 模式后，**跳过本文件第 3 节的 codeagent-wrapper 调用模板**，直接按上表用 Agent 工具执行。

## 2. 按阶段选择模型

### 分析/研究阶段
| 任务领域 | 推荐模型 | 角色提示词 |
|---------|---------|-----------|
| 后端/架构 | backend 模型 | `$BACKEND/analyzer.md` |
| 前端/UI | frontend 模型 | `$FRONTEND/analyzer.md` |
| 全栈 | 双模型并行 | 各用对应 analyzer |
| 安全 | backend 模型 | `$BACKEND/analyzer.md` |

### 规划阶段
| 任务领域 | 推荐模型 | 角色提示词 |
|---------|---------|-----------|
| 架构设计 | backend 模型 | `$BACKEND/architect.md` |
| UI/UX 设计 | frontend 模型 | `$FRONTEND/architect.md` |
| 全栈 | 双模型并行 | 各用对应 architect |

### 审查阶段（始终双模型交叉验证）
- backend 模型 + `$BACKEND/reviewer.md`
- frontend 模型 + `$FRONTEND/reviewer.md`

### 调试阶段
| 任务领域 | 推荐模型 | 角色提示词 |
|---------|---------|-----------|
| 后端问题 | backend 模型优先 | `$BACKEND/debugger.md` |
| 前端问题 | frontend 模型优先 | `$FRONTEND/debugger.md` |
| 不确定 | 双模型并行 | 各用对应 debugger |

### 实施阶段

**默认模式**（Claude 执行）：
- 外部模型仅提供建议，Claude 执行所有文件修改

**Builder 模式**（用户选择时，backend 模型全权写代码）：
- backend 模型 + `$BACKEND/builder.md` — **有完整写权限**，直接写代码到文件系统
- 支持任意已配置的 backend 模型（`codex` / `grok` / `kimi` / `opencode` / `antigravity`），Claude token 消耗极低
- backend 为 `claude` 时改用 Agent Teams（见第 1b 节）
- Claude 监控进度，审查产出，必要时接管
- 适用于 M-L 复杂度、低中风险的明确实施任务

## 3. 调用模板

### 获取工作目录

先确定当前工作目录（不可从 $HOME 推断）：
```
WORKDIR=$(pwd)
```

### 新会话调用

```
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--progress --backend $MODEL {{GEMINI_MODEL_FLAG}}{{GROK_MODEL_FLAG}}{{KIMI_MODEL_FLAG}}{{OPENCODE_MODEL_FLAG}}- \"$WORKDIR\" <<'CODEAGENT_EOF'\nROLE_FILE: ~/.claude/.ccg/prompts/$MODEL/$ROLE.md\n<TASK>\n$TASK_CONTENT\n</TASK>\nOUTPUT: $OUTPUT_FORMAT\nCODEAGENT_EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "$SHORT_DESCRIPTION"
})
```

变量说明：
- `$MODEL` — 选定的模型名（`codex` / `grok` / `kimi` / `opencode` / `antigravity` / `gemini`）
  > 若 $MODEL 为 `claude`，见第 1b 节——应改用 Agent Teams，不走 wrapper。
- `$ROLE` — 角色文件名（`analyzer` / `architect` / `reviewer` / `debugger` / `optimizer` / `tester` / `builder`）
- `$TASK_CONTENT` — 任务内容（需求 + 上下文）
- `$OUTPUT_FORMAT` — 期望输出格式
- `$SHORT_DESCRIPTION` — 简短描述（用于进度显示）

### 复用会话调用

```
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--progress --backend $MODEL {{GEMINI_MODEL_FLAG}}{{GROK_MODEL_FLAG}}{{KIMI_MODEL_FLAG}}{{OPENCODE_MODEL_FLAG}}resume $SESSION_ID - \"$WORKDIR\" <<'CODEAGENT_EOF'\nROLE_FILE: ~/.claude/.ccg/prompts/$MODEL/$ROLE.md\n<TASK>\n$TASK_CONTENT\n</TASK>\nOUTPUT: $OUTPUT_FORMAT\nCODEAGENT_EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "$SHORT_DESCRIPTION"
})
```

### 并行双模型调用模式

同时启动两个模型，各自独立分析：

1. 启动 backend 模型（`run_in_background: true`）
2. 启动 frontend 模型（`run_in_background: true`）
3. 等待两者完成：
   ```
   TaskOutput({ task_id: "$BACKEND_TASK_ID", block: true, timeout: 600000 })
   TaskOutput({ task_id: "$FRONTEND_TASK_ID", block: true, timeout: 600000 })
   ```
4. 综合双方结果

## 4. 等待与重试规则

| 场景 | 策略 |
|------|------|
| frontend 模型失败 | 重试最多 2 次，间隔 5s |
| backend 模型运行中 | 可能需要 5-15 分钟，保持轮询，永不终止 |
| 3 次全败 | 降级为单模型模式，告知用户 |
| 超时 | 600s 等待上限，超时后报告并询问用户 |

## 5. SESSION_ID 管理

- 每次 codeagent-wrapper 调用返回 `Session-ID: xxx`
- 捕获并保存：`BACKEND_SESSION`、`FRONTEND_SESSION`
- 后续阶段通过 `resume $SESSION_ID` 复用上下文
- 复用会话可减少重复分析，提升效率
