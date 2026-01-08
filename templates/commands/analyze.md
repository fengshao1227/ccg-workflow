---
description: '多模型技术分析（并行执行）：Codex 后端视角 + Gemini 前端视角，交叉验证后综合见解'
---

# Analyze - 多模型技术分析

使用双模型并行分析，交叉验证得出综合技术见解。**仅分析，不修改代码。**

## 使用方法

```bash
/analyze <分析问题或任务>
```

## 多模型调用语法

**必须使用 heredoc 语法调用外部模型**：

```bash
codeagent-wrapper --backend <codex|gemini> - $PWD <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/<model>/<role>.md
<TASK>
任务描述
</TASK>
OUTPUT: 期望输出格式
EOF
```

## 你的角色

你是**分析协调者**，编排多模型分析流程：
- **ace-tool** – 代码上下文检索
- **Codex** – 后端/系统视角（**后端权威**）
- **Gemini** – 前端/用户视角（**前端权威**）
- **Claude (自己)** – 综合见解

---

## 执行工作流

**分析任务**：$ARGUMENTS

### 🔍 阶段 1：上下文检索

`[模式：研究]`

1. 调用 `mcp__ace-tool__search_context` 检索相关代码
2. 识别分析范围和关键组件
3. 列出已知约束和假设

### 💡 阶段 2：并行分析

`[模式：分析]`

**并行调用两个模型**：

**执行步骤**：
1. 使用 **Bash 工具的 `run_in_background: true` 参数**启动两个后台进程：

**Codex 分析进程**：
```
Bash({
  command: "~/.claude/bin/codeagent-wrapper --backend codex - \"$PWD\" <<'EOF_CODEX'
ROLE_FILE: ~/.claude/.ccg/prompts/codex/analyzer.md
<TASK>
分析需求: $ARGUMENTS
Context: <阶段1检索到的上下文>
</TASK>
OUTPUT: 技术可行性、架构影响、性能考量
EOF_CODEX",
  run_in_background: true,
  timeout: 3600000,
  description: "Codex 技术分析"
})
```

**Gemini 分析进程**：
```
Bash({
  command: "~/.claude/bin/codeagent-wrapper --backend gemini - \"$PWD\" <<'EOF_GEMINI'
ROLE_FILE: ~/.claude/.ccg/prompts/gemini/analyzer.md
<TASK>
分析需求: $ARGUMENTS
Context: <阶段1检索到的上下文>
</TASK>
OUTPUT: UI/UX 影响、用户体验、视觉设计考量
EOF_GEMINI",
  run_in_background: true,
  timeout: 3600000,
  description: "Gemini UI 分析"
})
```

2. 使用 `TaskOutput` 监控并获取 2 个模型的分析结果。

**⚠️ 强制规则：必须等待 TaskOutput 返回两个模型的完整结果后才能进入下一阶段，禁止跳过或提前继续！**

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
2. **使用 Bash 工具的 `run_in_background: true` 参数 + `TaskOutput` 获取结果**
3. **必须等待所有模型返回完整结果后才能进入下一阶段**，禁止跳过或提前继续
4. **信任规则** – 后端以 Codex 为准，前端以 Gemini 为准
