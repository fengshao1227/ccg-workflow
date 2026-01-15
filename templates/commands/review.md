---
description: '多模型代码审查：无参数时自动审查 git diff，双模型交叉验证'
---

# Review - 多模型代码审查

双模型并行审查，交叉验证综合反馈。无参数时自动审查当前 git 变更。

## 使用方法

```bash
/review [代码或描述]
```

- **无参数**：自动审查 `git diff HEAD`
- **有参数**：审查指定代码或描述

---

## 多模型调用规范

**调用语法**（并行用 `run_in_background: true`）：

```
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--backend <codex|gemini> - \"$PWD\" <<'EOF'
<TASK>
审查以下代码变更：
<git diff 内容>
</TASK>
OUTPUT: 按 Critical/Major/Minor/Suggestion 分类列出问题
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

### 🔍 阶段 1：获取待审查代码

`[模式：研究]`

**无参数时**：执行 `git diff HEAD` 和 `git status --short`

**有参数时**：使用指定的代码/描述

调用 `mcp__ace-tool__search_context` 获取相关上下文。

### 🔬 阶段 2：并行审查

`[模式：审查]`

**⚠️ 必须发起两个并行 Bash 调用**（参照上方调用规范）：

1. **Codex 后端审查**：`Bash({ command: "...--backend codex...", run_in_background: true })`
   - 需求：审查代码变更（git diff 内容）
   - OUTPUT：按 Critical/Major/Minor/Suggestion 分类列出安全性、性能、错误处理问题

2. **Gemini 前端审查**：`Bash({ command: "...--backend gemini...", run_in_background: true })`
   - 需求：审查代码变更（git diff 内容）
   - OUTPUT：按 Critical/Major/Minor/Suggestion 分类列出可访问性、响应式、设计一致性问题

用 `TaskOutput` 等待两个模型的审查结果。**必须等所有模型返回后才能进入下一阶段**。

**务必遵循上方 `多模型调用规范` 的 `重要` 指示**

### 🔀 阶段 3：综合反馈

`[模式：综合]`

1. 收集双方审查结果
2. 按严重程度分类：Critical / Major / Minor / Suggestion
3. 去重合并 + 交叉验证

### 📊 阶段 4：呈现审查结果

`[模式：总结]`

```markdown
## 📋 代码审查报告

### 审查范围
- 变更文件：<数量> | 代码行数：+X / -Y

### 关键问题 (Critical)
> 必须修复才能合并
1. <问题描述> - [Codex/Gemini]

### 主要问题 (Major) / 次要问题 (Minor) / 建议 (Suggestions)
...

### 总体评价
- 代码质量：[优秀/良好/需改进]
- 是否可合并：[是/否/需修复后]
```

---

## 关键规则

1. **无参数 = 审查 git diff** – 自动获取当前变更
2. **双模型交叉验证** – 后端问题以 Codex 为准，前端问题以 Gemini 为准
3. 外部模型对文件系统**零写入权限**
