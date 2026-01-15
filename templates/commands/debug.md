---
description: '多模型调试：Codex 后端诊断 + Gemini 前端诊断，交叉验证定位问题'
---

# Debug - 多模型调试

双模型并行诊断，交叉验证快速定位问题根因。

## 使用方法

```bash
/debug <问题描述>
```

## 你的角色

你是**调试协调者**，编排多模型诊断流程：
- **Codex** – 后端诊断（**后端问题权威**）
- **Gemini** – 前端诊断（**前端问题权威**）
- **Claude (自己)** – 综合诊断、执行修复

---

## 多模型调用规范

**调用语法**（并行用 `run_in_background: true`）：

```
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--backend <codex|gemini> - \"$PWD\" <<'EOF'
<TASK>
需求：<增强后的需求（如未增强则用 $ARGUMENTS）>
上下文：<错误日志、堆栈信息、复现步骤等>
</TASK>
OUTPUT: 诊断假设（按可能性排序）
EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "简短描述"
})
```

**并行调用**：使用 `run_in_background: true` 启动，用 `TaskOutput` 等待结果。**必须等所有模型返回后才能进入下一阶段**。

**等待后台任务**（使用最大超时 600000ms = 10 分钟）：

```
TaskOutput({ task_id: "<task_id>", block: true, timeout: 600000 })
```

**重要**：
- 必须指定 `timeout: 600000`，否则默认只有 30 秒会导致提前超时。
如果 10 分钟后仍未完成，继续用 `TaskOutput` 轮询，**绝对不要 Kill 进程**。
- 若因等待时间过长跳过了等待 TaskOutput 结果，则**必须调用 `AskUserQuestion` 工具询问用户选择继续等待还是 Kill Task。禁止直接 Kill Task。**

---

## 执行工作流

**问题描述**：$ARGUMENTS

### 🔍 阶段 0：Prompt 增强（可选）

`[模式：准备]` - 如 ace-tool MCP 可用，调用 `mcp__ace-tool__enhance_prompt`，**用增强结果替代原始 $ARGUMENTS，后续调用 Codex/Gemini 时传入增强后的需求**

### 🔍 阶段 1：上下文收集

`[模式：研究]`

1. 调用 `mcp__ace-tool__search_context` 检索相关代码（如可用）
2. 收集错误日志、堆栈信息、复现步骤
3. 识别问题类型：[后端/前端/全栈]

### 🔬 阶段 2：并行诊断

`[模式：诊断]`

**⚠️ 必须发起两个并行 Bash 调用**（参照上方调用规范）：

1. **Codex 后端诊断**：`Bash({ command: "...--backend codex...", run_in_background: true })`
2. **Gemini 前端诊断**：`Bash({ command: "...--backend gemini...", run_in_background: true })`

两个调用的 OUTPUT 都是：诊断假设（按可能性排序），每个假设包含原因、证据、修复建议

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

### Codex 分析（后端视角）
<诊断摘要>

### Gemini 分析（前端视角）
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
2. **信任规则** – 后端问题以 Codex 为准，前端问题以 Gemini 为准
3. 外部模型对文件系统**零写入权限**
