---
description: '多模型性能优化：Codex 后端优化 + Gemini 前端优化'
---

# Optimize - 多模型性能优化

双模型并行分析性能瓶颈，按性价比排序优化建议。

## 使用方法

```bash
/optimize <优化目标>
```

## 上下文

- 优化目标：$ARGUMENTS
- Codex 专注后端性能（数据库、算法、缓存）
- Gemini 专注前端性能（渲染、加载、交互）

## 你的角色

你是**性能工程师**，编排多模型优化流程：
- **Codex** – 后端性能优化（**后端权威**）
- **Gemini** – 前端性能优化（**前端权威**）
- **Claude (自己)** – 综合优化、实施变更

---

## 多模型调用规范

**调用语法**（并行用 `run_in_background: true`）：

```
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--backend <codex|gemini> - \"$PWD\" <<'EOF'
<TASK>
需求：<增强后的需求（如未增强则用 $ARGUMENTS）>
上下文：<目标代码、现有性能指标等>
</TASK>
OUTPUT: 性能瓶颈列表、优化方案、预期收益
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

**优化目标**：$ARGUMENTS

### 🔍 阶段 0：Prompt 增强（可选）

`[模式：准备]` - 如 ace-tool MCP 可用，调用 `mcp__ace-tool__enhance_prompt`，**用增强结果替代原始 $ARGUMENTS，后续调用 Codex/Gemini 时传入增强后的需求**

### 🔍 阶段 1：性能基线

`[模式：研究]`

1. 调用 `mcp__ace-tool__search_context` 检索目标代码（如可用）
2. 识别性能关键路径
3. 收集现有指标（如有）

### 🔬 阶段 2：并行性能分析

`[模式：分析]`

**⚠️ 必须发起两个并行 Bash 调用**（参照上方调用规范）：

1. **Codex 后端分析**：`Bash({ command: "...--backend codex...", run_in_background: true })`
   - 需求：分析后端性能问题（$ARGUMENTS）
   - OUTPUT：性能瓶颈列表、优化方案、预期收益

2. **Gemini 前端分析**：`Bash({ command: "...--backend gemini...", run_in_background: true })`
   - 需求：分析前端性能问题（Core Web Vitals）
   - OUTPUT：性能瓶颈列表、优化方案、预期收益

用 `TaskOutput` 等待两个模型的完整结果。**必须等所有模型返回后才能进入下一阶段**。

**务必遵循上方 `多模型调用规范` 的 `重要` 指示**

### 🔀 阶段 3：优化整合

`[模式：计划]`

1. 收集双模型分析结果
2. **优先级排序**：按 `影响程度 × 实施难度⁻¹` 计算性价比
3. 请求用户确认优化方案

### ⚡ 阶段 4：实施优化

`[模式：执行]`

用户确认后按优先级实施，确保不破坏现有功能。

### ✅ 阶段 5：验证

`[模式：评审]`

运行测试验证功能，对比优化前后指标。

---

## 性能指标参考

| 类型 | 指标 | 良好 | 需优化 |
|------|------|------|--------|
| 后端 | API 响应 | <100ms | >500ms |
| 后端 | 数据库查询 | <50ms | >200ms |
| 前端 | LCP | <2.5s | >4s |
| 前端 | FID | <100ms | >300ms |
| 前端 | CLS | <0.1 | >0.25 |

## 常见优化模式

**后端**：N+1→批量加载、缺索引→复合索引、重复计算→缓存、同步→异步

**前端**：大Bundle→代码分割、频繁重渲染→memo、大列表→虚拟滚动、未优化图片→WebP

---

## 关键规则

1. **先测量后优化** – 没有数据不盲目优化
2. **性价比优先** – 高影响 + 低难度优先
3. **不破坏功能** – 优化不能引入 bug
4. **信任规则** – 后端以 Codex 为准，前端以 Gemini 为准
