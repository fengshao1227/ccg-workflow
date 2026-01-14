---
description: '多模型测试生成：智能路由 Codex 后端测试 / Gemini 前端测试'
---

# Test - 多模型测试生成

根据代码类型智能路由，生成高质量测试用例。

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

## 多模型调用规范

**调用语法**（并行用 `run_in_background: true`）：

```
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--backend <codex|gemini> - \"$PWD\" <<'EOF'
<TASK>
需求：为以下代码生成测试
<代码内容>
需求描述：<增强后的需求（如未增强则用 $ARGUMENTS）>
要求：
1. 使用项目现有测试框架
2. 覆盖正常路径、边界条件、异常处理
</TASK>
OUTPUT: 完整测试代码
EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "简短描述"
})
```

**智能路由**：

| 代码类型 | 路由 |
|---------|------|
| 后端 | Codex |
| 前端 | Gemini |
| 全栈 | 并行执行两者 |

**并行调用**：使用 `run_in_background: true` 启动，用 `TaskOutput` 等待结果。**必须等所有模型返回后才能进入下一阶段**。

**等待后台任务**（使用最大超时 600000ms = 10分钟）：

```
TaskOutput({ task_id: "<task_id>", block: true, timeout: 600000 })
```

**重要**：必须指定 `timeout: 600000`，否则默认只有 30 秒会导致提前超时。
如果 10 分钟后仍未完成，继续用 `TaskOutput` 轮询，**绝对不要 Kill 进程**。

---

## 执行工作流

**测试目标**：$ARGUMENTS

### 🔍 阶段 0：Prompt 增强（可选）

`[模式：准备]` - 如 ace-tool MCP 可用，调用 `mcp__ace-tool__enhance_prompt`，**用增强结果替代原始 $ARGUMENTS，后续调用 Codex/Gemini 时传入增强后的需求**

### 🔍 阶段 1：测试分析

`[模式：研究]`

1. 检索目标代码的完整实现
2. 查找现有测试文件和测试框架配置
3. 识别代码类型：[后端/前端/全栈]
4. 评估当前测试覆盖率和缺口

### 🔬 阶段 2：智能路由测试生成

`[模式：生成]`

**⚠️ 根据代码类型必须调用对应模型**（参照上方调用规范）：

- **后端代码** → `Bash({ command: "...--backend codex...", run_in_background: false })`
- **前端代码** → `Bash({ command: "...--backend gemini...", run_in_background: false })`
- **全栈代码** → 并行调用两者：
  1. `Bash({ command: "...--backend codex...", run_in_background: true })`
  2. `Bash({ command: "...--backend gemini...", run_in_background: true })`
  用 `TaskOutput` 等待结果

OUTPUT：完整测试代码（使用项目现有测试框架，覆盖正常路径、边界条件、异常处理）

**必须等所有模型返回后才能进入下一阶段**。

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
4. 外部模型对文件系统**零写入权限**
