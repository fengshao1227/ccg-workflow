---
description: '多模型调试：{{BACKEND_PRIMARY}} 后端诊断 + {{FRONTEND_PRIMARY}} 前端诊断，交叉验证定位问题'
---

# Debug - 多模型调试

双模型并行诊断，交叉验证快速定位问题根因。

## 使用方法

```bash
/debug <问题描述>
```

## 你的角色

你是**调试协调者**，编排多模型诊断流程：
- **{{BACKEND_PRIMARY}}** – 后端诊断（**后端问题权威**）
- **{{FRONTEND_PRIMARY}}** – 前端诊断（**前端问题权威**）
- **Claude (自己)** – 综合诊断、执行修复

---

## 多模型调用规范

**工作目录**：
- 如果用户通过 `/add-dir` 添加了多个工作区，先用 Glob/Grep 确定任务相关的工作区
- 如果无法确定，用 `AskUserQuestion` 询问用户选择目标工作区
- **必须通过 Bash 执行 `pwd`（Unix）或 `cd`（Windows CMD）获取当前工作目录的绝对路径**，禁止从 `$HOME` 或环境变量推断

**调用示例**：

**{{BACKEND_PRIMARY}} 后端诊断**：
```bash
~/.claude/bin/codeagent-wrapper --progress --backend {{BACKEND_PRIMARY}} {{GEMINI_MODEL_FLAG}}{{GROK_MODEL_FLAG}}{{KIMI_MODEL_FLAG}}{{OPENCODE_MODEL_FLAG}}- "$(pwd)" <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/{{BACKEND_PRIMARY}}/debugger.md
<TASK>
需求：<增强后的需求>
上下文：<错误日志、堆栈信息、复现步骤>
</TASK>
OUTPUT: 诊断假设（按可能性排序）
EOF
```

**{{FRONTEND_PRIMARY}} 前端诊断**：
```bash
~/.claude/bin/codeagent-wrapper --progress --backend {{FRONTEND_PRIMARY}} {{GEMINI_MODEL_FLAG}}{{GROK_MODEL_FLAG}}{{KIMI_MODEL_FLAG}}{{OPENCODE_MODEL_FLAG}}- "$(pwd)" <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/{{FRONTEND_PRIMARY}}/debugger.md
<TASK>
需求：<增强后的需求>
上下文：<错误日志、堆栈信息、复现步骤>
</TASK>
OUTPUT: 诊断假设（按可能性排序）
EOF
```

**角色提示词**：

| 模型 | 提示词 |
|------|--------|
| 后端 | `~/.claude/.ccg/prompts/{{BACKEND_PRIMARY}}/debugger.md` |
| 前端 | `~/.claude/.ccg/prompts/{{FRONTEND_PRIMARY}}/debugger.md` |

**并行调用**：
1. 使用 `Bash` 工具，设置 `run_in_background: true` 和 `timeout: 600000`（10 分钟）
2. 同时发起两个后台任务（{{BACKEND_PRIMARY}} + {{FRONTEND_PRIMARY}}）
3. 使用 `TaskOutput` 等待结果：`TaskOutput({ task_id: "<task_id>", block: true, timeout: 600000 })`

**重要**：
- 必须指定 `timeout: 600000`，否则默认 30 秒会超时
- 如果 10 分钟后仍未完成，继续用 `TaskOutput` 轮询，**绝对不要 Kill 进程**
- 若等待时间过长，**必须用 `AskUserQuestion` 询问用户是否继续等待，禁止直接 Kill**
- ⛔ **前端模型失败必须重试**：若前端模型调用失败（非零退出码或输出包含错误信息），最多重试 2 次（间隔 5 秒）。仅当 3 次全部失败时才跳过前端模型结果并使用单模型结果继续。
- ⛔ **后端模型结果必须等待**：后端模型执行时间较长（5-15 分钟）属于正常。TaskOutput 超时后必须继续用 TaskOutput 轮询，**绝对禁止在后端模型未返回结果时直接跳过或继续下一阶段**。已启动的后端任务若被跳过 = 浪费 token + 丢失结果。

---

## 执行工作流

**问题描述**：$ARGUMENTS

### 🔍 阶段 0：Prompt 增强（可选）

`[模式：准备]` - **Prompt 增强**（按 `/ccg:enhance` 的逻辑执行）：分析 $ARGUMENTS 的意图、缺失信息、隐含假设，补全为结构化需求（明确目标、技术约束、范围边界、验收标准），**用增强结果替代原始 $ARGUMENTS，后续调用后端/前端模型 时传入增强后的需求**

### 🔍 阶段 1：上下文收集

`[模式：研究]`

1. 调用 `{{MCP_SEARCH_TOOL}}` 检索相关代码（如可用）
2. 收集错误日志、堆栈信息、复现步骤
3. 识别问题类型：[后端/前端/全栈]

### 🔬 阶段 2：并行诊断

`[模式：诊断]`

**⚠️ 必须发起两个并行 Bash 调用**（参照上方调用规范）：

1. **{{BACKEND_PRIMARY}} 后端诊断**：`Bash({ command: "...--backend {{BACKEND_PRIMARY}}...", run_in_background: true })`
   - ROLE_FILE: `~/.claude/.ccg/prompts/{{BACKEND_PRIMARY}}/debugger.md`
   - OUTPUT：诊断假设（按可能性排序），每个假设包含原因、证据、修复建议

2. **{{FRONTEND_PRIMARY}} 前端诊断**：`Bash({ command: "...--backend {{FRONTEND_PRIMARY}}...", run_in_background: true })`
   - ROLE_FILE: `~/.claude/.ccg/prompts/{{FRONTEND_PRIMARY}}/debugger.md`
   - OUTPUT：诊断假设（按可能性排序），每个假设包含原因、证据、修复建议

用 `TaskOutput` 等待两个模型的诊断结果。**必须等所有模型返回后才能进入下一阶段**。

**务必遵循上方 `多模型调用规范` 的 `重要` 指示**

### 🔀 阶段 3：假设整合

`[模式：验证]`

1. 交叉验证双方诊断结果
2. 筛选 **Top 1-2 最可能原因**
3. 设计验证策略

### ⛔ 阶段 4：用户确认（Hard Stop）

`[模式：确认]`

```markdown
## 🔍 诊断结果

### {{BACKEND_PRIMARY}} 分析（后端视角）
<诊断摘要>

### {{FRONTEND_PRIMARY}} 分析（前端视角）
<诊断摘要>

### 综合诊断
**最可能原因**：<具体诊断>
**验证方案**：<如何确认>

---
**确认后我将执行修复。是否继续？(Y/N)**
```

**⚠️ 必须等待用户确认后才能进入阶段 5**

### 🔧 阶段 5：修复与验证

`[模式：执行]`

用户确认后：
1. 根据诊断实施修复
2. 运行测试验证修复

---

## 关键规则

1. **用户确认** – 修复前必须获得确认
2. **信任规则** – 后端问题以 {{BACKEND_PRIMARY}} 为准，前端问题以 {{FRONTEND_PRIMARY}} 为准
3. 外部模型对文件系统**零写入权限**
