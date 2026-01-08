---
description: '多模型调试：Codex 后端诊断 + Gemini 前端诊断，交叉验证定位问题'
---

# Debug - 多模型调试

双模型并行诊断，交叉验证快速定位问题根因。

## 多模型调用语法

**⚠️ 必须使用 heredoc 语法调用外部模型**：

```bash
~/.claude/bin/codeagent-wrapper --backend <codex|gemini> - "$PWD" <<'EOF'
<任务内容>
EOF
```

- `--backend codex` – 后端/逻辑问题诊断
- `--backend gemini` – 前端/UI 问题诊断
- `$PWD` – 当前工作目录

---

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

## 执行工作流

**问题描述**：$ARGUMENTS

### 🔍 阶段 0：Prompt 增强（可选）

`[模式：准备]` - 增强问题描述

**如果 ace-tool MCP 可用**，调用 `mcp__ace-tool__enhance_prompt`：
- 输入原始问题描述
- 获取增强后的详细问题分析
- 用增强后的描述替代原始 $ARGUMENTS

### 🔍 阶段 1：上下文收集

`[模式：研究]`

1. 调用 `mcp__ace-tool__search_context` 检索相关代码（如可用）
2. 收集错误日志、堆栈信息、复现步骤
3. 识别问题类型：[后端/前端/全栈]

### 🔬 阶段 2：并行诊断

`[模式：诊断]`

**并行调用 Codex + Gemini**：

**执行步骤**：
1. 使用 **Bash 工具的 `run_in_background: true` 参数**启动两个后台进程：

**Codex 诊断进程**：
```
Bash({
  command: "~/.claude/bin/codeagent-wrapper --backend codex - \"$PWD\" <<'EOF_CODEX'
角色：后端调试专家

问题：$ARGUMENTS

任务：
1. 分析逻辑错误、数据流、异常处理
2. 检查 API、数据库、服务间通信
3. 输出诊断假设（按可能性排序）
EOF_CODEX",
  run_in_background: true,
  timeout: 3600000,
  description: "Codex 后端诊断"
})
```

**Gemini 诊断进程**：
```
Bash({
  command: "~/.claude/bin/codeagent-wrapper --backend gemini - \"$PWD\" <<'EOF_GEMINI'
角色：前端调试专家

问题：$ARGUMENTS

任务：
1. 分析 UI 渲染、状态管理、事件绑定
2. 检查组件生命周期、样式冲突
3. 输出诊断假设（按可能性排序）
EOF_GEMINI",
  run_in_background: true,
  timeout: 3600000,
  description: "Gemini 前端诊断"
})
```

2. 使用 `TaskOutput` 监控并获取 2 个模型的诊断结果。

**⚠️ 强制规则：必须等待 TaskOutput 返回两个模型的完整结果后才能进入下一阶段，禁止跳过或提前继续！**

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
3. **可选**：并行调用 Codex + Gemini 审查修复

---

## 关键规则

1. **heredoc 语法** – 外部模型调用必须使用 heredoc
2. **使用 Bash 工具的 `run_in_background: true` 参数 + `TaskOutput` 获取结果**
3. **必须等待所有模型返回完整结果后才能进入下一阶段**，禁止跳过或提前继续
4. **用户确认** – 修复前必须获得确认
5. **信任规则** – 后端问题以 Codex 为准，前端问题以 Gemini 为准
