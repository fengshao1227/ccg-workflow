---
description: '多模型性能优化：Codex 后端优化 + Gemini 前端优化'
---

# Optimize - 多模型性能优化

双模型并行分析性能瓶颈，按性价比排序优化建议。

## 多模型调用语法

**必须使用 heredoc 语法调用外部模型**：

```bash
~/.claude/bin/codeagent-wrapper --backend <codex|gemini> - $PWD <<'EOF'
<任务内容>
EOF
```

> ⚠️ 禁止使用 `echo | codeagent-wrapper` 管道语法，会导致多行内容截断。

---

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

## 执行工作流

**优化目标**：$ARGUMENTS

### 🔍 阶段 0：Prompt 增强（可选）

`[模式：准备]` - 增强任务描述

**如果 ace-tool MCP 可用**，调用 `mcp__ace-tool__enhance_prompt`：
- 输入原始优化目标
- 获取增强后的详细需求
- 用增强后的需求替代原始 $ARGUMENTS

### 🔍 阶段 1：性能基线

`[模式：研究]`

1. 调用 `mcp__ace-tool__search_context` 检索目标代码（如可用）
2. 识别性能关键路径
3. 收集现有指标（如有）

### 🔬 阶段 2：并行性能分析

`[模式：分析]`

**并行调用两个模型**：

**执行步骤**：
1. 使用 **Bash 工具的 `run_in_background: true` 参数**启动两个后台进程：

**Codex 性能分析进程**：
```
Bash({
  command: "~/.claude/bin/codeagent-wrapper --backend codex - \"$PWD\" <<'EOF_CODEX'
[角色] 你是后端性能优化专家

[任务] 分析以下代码的后端性能问题：
$ARGUMENTS

[输出格式]
1. 性能瓶颈列表（按严重程度排序）
2. 每个问题的优化方案（含代码 Diff）
3. 预期收益评估
EOF_CODEX",
  run_in_background: true,
  timeout: 3600000,
  description: "Codex 后端性能分析"
})
```

**Gemini 性能分析进程**：
```
Bash({
  command: "~/.claude/bin/codeagent-wrapper --backend gemini - \"$PWD\" <<'EOF_GEMINI'
[角色] 你是前端性能优化专家

[任务] 分析以下代码的前端性能问题：
$ARGUMENTS

[输出格式]
1. Core Web Vitals 问题列表
2. 每个问题的优化方案（含代码 Diff）
3. 预期收益评估
EOF_GEMINI",
  run_in_background: true,
  timeout: 3600000,
  description: "Gemini 前端性能分析"
})
```

2. 使用 `TaskOutput` 监控并获取 2 个模型的分析结果。

**⚠️ 强制规则：必须等待 TaskOutput 返回两个模型的完整结果后才能进入下一阶段，禁止跳过或提前继续！**

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
5. **使用 Bash 工具的 `run_in_background: true` 参数 + `TaskOutput` 获取结果**
6. **必须等待所有模型返回** – 禁止提前进入下一步
