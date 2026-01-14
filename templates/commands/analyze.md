---
description: '多模型技术分析（并行执行）：Codex 后端视角 + Gemini 前端视角，交叉验证后综合见解'
---

# Analyze - 多模型技术分析

使用双模型并行分析，交叉验证得出综合技术见解。**仅分析，不修改代码。**

## 使用方法

```bash
/analyze <分析问题或任务>
```

## 你的角色

你是**分析协调者**，编排多模型分析流程：
- **ace-tool** – 代码上下文检索
- **Codex** – 后端/系统视角（**后端权威**）
- **Gemini** – 前端/用户视角（**前端权威**）
- **Claude (自己)** – 综合见解

---

## 多模型调用规范

**调用语法**（并行用 `run_in_background: true`）：

```
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--backend <codex|gemini> - \"$PWD\" <<'EOF'
ROLE_FILE: <角色提示词路径>
<TASK>
需求：<增强后的需求（如未增强则用 $ARGUMENTS）>
上下文：<前序阶段检索到的代码上下文>
</TASK>
OUTPUT: 期望输出格式
EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "简短描述"
})
```

**角色提示词**：

| 模型 | 提示词 |
|------|--------|
| Codex | `~/.claude/.ccg/prompts/codex/analyzer.md` |
| Gemini | `~/.claude/.ccg/prompts/gemini/analyzer.md` |

**并行调用**：使用 `run_in_background: true` 启动，用 `TaskOutput` 等待结果。**必须等所有模型返回后才能进入下一阶段**。

**等待后台任务**（使用最大超时 600000ms = 10分钟）：

```
TaskOutput({ task_id: "<task_id>", block: true, timeout: 600000 })
```

**重要**：必须指定 `timeout: 600000`，否则默认只有 30 秒会导致提前超时。
如果 10 分钟后仍未完成，继续用 `TaskOutput` 轮询，**绝对不要 Kill 进程**。

---

## 执行工作流

**分析任务**：$ARGUMENTS

### 🔍 阶段 0：Prompt 增强（可选）

`[模式：准备]` - 如 ace-tool MCP 可用，调用 `mcp__ace-tool__enhance_prompt`，**用增强结果替代原始 $ARGUMENTS，后续调用 Codex/Gemini 时传入增强后的需求**

### 🔍 阶段 1：上下文检索

`[模式：研究]`

1. 调用 `mcp__ace-tool__search_context` 检索相关代码
2. 识别分析范围和关键组件
3. 列出已知约束和假设

### 💡 阶段 2：并行分析

`[模式：分析]`

**⚠️ 必须发起两个并行 Bash 调用**（参照上方调用规范）：

1. **Codex 后端分析**：`Bash({ command: "...--backend codex...", run_in_background: true })`
   - ROLE_FILE: `~/.claude/.ccg/prompts/codex/analyzer.md`
   - OUTPUT：技术可行性、架构影响、性能考量

2. **Gemini 前端分析**：`Bash({ command: "...--backend gemini...", run_in_background: true })`
   - ROLE_FILE: `~/.claude/.ccg/prompts/gemini/analyzer.md`
   - OUTPUT：UI/UX 影响、用户体验、视觉设计考量

用 `TaskOutput` 等待两个模型的完整结果。**必须等所有模型返回后才能进入下一阶段**。

### 🔀 阶段 3：交叉验证

`[模式：验证]`

1. 对比双方分析结果
2. 识别：
   - **一致观点**（强信号）
   - **分歧点**（需权衡）
   - **互补见解**（各自领域洞察）
3. 按信任规则权衡：后端以 Codex 为准，前端以 Gemini 为准

### 📊 阶段 4：综合输出

`[模式：总结]`

```markdown
## 🔬 技术分析：<主题>

### 一致观点（强信号）
1. <双方都认同的点>

### 分歧点（需权衡）
| 议题 | Codex 观点 | Gemini 观点 | 建议 |
|------|------------|-------------|------|

### 核心结论
<1-2 句话总结>

### 推荐方案
**首选**：<方案>
- 理由 / 风险 / 缓解措施

### 后续行动
1. [ ] <具体步骤>
```

---

## 适用场景

| 场景 | 示例 |
|------|------|
| 技术选型 | "比较 Redux vs Zustand" |
| 架构评估 | "评估微服务拆分方案" |
| 性能分析 | "分析 API 响应慢的原因" |
| 安全审计 | "评估认证模块安全性" |

## 关键规则

1. **仅分析不修改** – 本命令不执行任何代码变更
2. **信任规则** – 后端以 Codex 为准，前端以 Gemini 为准
3. 外部模型对文件系统**零写入权限**
