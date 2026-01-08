---
description: '多模型测试生成：智能路由 Codex 后端测试 / Gemini 前端测试'
---

# Test - 多模型测试生成

根据代码类型智能路由，生成高质量测试用例。

## 多模型调用语法

**必须使用 heredoc 语法调用 codeagent-wrapper**：

```bash
~/.claude/bin/codeagent-wrapper --backend <codex|gemini> - [工作目录] <<'EOF'
<任务内容>
EOF
```

## 使用方法

```bash
/test <测试目标>
```

## 上下文

- 测试目标：$ARGUMENTS
- 智能路由：后端 → Codex，前端 → Gemini，全栈 → 并行
- 遵循项目现有测试框架和风格

## 你的角色

你是**测试工程师**，编排测试生成流程：
- **Codex** – 后端测试生成（**后端权威**）
- **Gemini** – 前端测试生成（**前端权威**）
- **Claude (自己)** – 整合测试、验证运行

---

## 执行工作流

**测试目标**：$ARGUMENTS

### 🔍 阶段 0：Prompt 增强（可选）

`[模式：准备]` - 增强测试需求

**如果 ace-tool MCP 可用**，调用 `mcp__ace-tool__enhance_prompt`：
- 输入原始测试目标
- 获取增强后的详细测试需求
- 用增强后的需求替代原始 $ARGUMENTS

### 🔍 阶段 1：测试分析

`[模式：研究]`

1. 检索目标代码的完整实现
2. 查找现有测试文件和测试框架配置
3. 识别代码类型：[后端/前端/全栈]
4. 评估当前测试覆盖率和缺口

### 🔬 阶段 2：智能路由测试生成

`[模式：生成]`

| 代码类型 | 路由 | 角色 |
|---------|------|------|
| 后端 | Codex | `tester.md` |
| 前端 | Gemini | `tester.md` |
| 全栈 | 并行执行 | 两者 |

**全栈代码并行调用**：

**执行步骤**：
1. 使用 **Bash 工具的 `run_in_background: true` 参数**启动两个后台进程：

**Codex 测试生成进程**：
```
Bash({
  command: "~/.claude/bin/codeagent-wrapper --backend codex - \"$PWD\" <<'EOF_CODEX'
你是后端测试专家，角色提示词见 ~/.claude/.ccg/prompts/codex/tester.md

任务：为以下代码生成单元测试
<代码内容>

要求：
1. 使用项目现有测试框架
2. 覆盖正常路径、边界条件、异常处理
3. 输出完整测试代码
EOF_CODEX",
  run_in_background: true,
  timeout: 3600000,
  description: "Codex 后端测试生成"
})
```

**Gemini 测试生成进程**：
```
Bash({
  command: "~/.claude/bin/codeagent-wrapper --backend gemini - \"$PWD\" <<'EOF_GEMINI'
你是前端测试专家，角色提示词见 ~/.claude/.ccg/prompts/gemini/tester.md

任务：为以下组件生成测试
<组件代码>

要求：
1. 使用项目现有测试框架
2. 测试渲染、交互、状态变化
3. 输出完整测试代码
EOF_GEMINI",
  run_in_background: true,
  timeout: 3600000,
  description: "Gemini 前端测试生成"
})
```

2. 使用 `TaskOutput` 监控并获取 2 个模型的测试代码。

**⚠️ 强制规则：必须等待 TaskOutput 返回两个模型的完整结果后才能进入下一阶段，禁止跳过或提前继续！**

### 🔀 阶段 3：测试整合

`[模式：计划]`

1. 收集模型输出
2. Claude 重构：统一风格、确保命名一致、优化结构、移除冗余

### ✅ 阶段 4：测试验证

`[模式：执行]`

1. 创建测试文件
2. 运行生成的测试
3. 如有失败，分析原因并修复

---

## 输出格式

```markdown
## 🧪 测试生成：<测试目标>

### 分析结果
- 代码类型：[后端/前端/全栈]
- 测试框架：<检测到的框架>

### 生成的测试
- 测试文件：<文件路径>
- 测试用例数：<数量>

### 运行结果
- 通过：X / Y
- 失败：<如有，列出原因>
```

## 测试策略金字塔

```
    /\      E2E (10%)
   /--\     Integration (20%)
  /----\    Unit (70%)
```

---

## 关键规则

1. **测试行为，不测试实现** – 关注输入输出
2. **智能路由** – 后端测试用 Codex，前端测试用 Gemini
3. **复用现有模式** – 遵循项目已有的测试风格
4. **使用 Bash 工具的 `run_in_background: true` 参数 + `TaskOutput` 获取结果**
5. **必须等待所有模型返回** – 禁止提前进入下一步
