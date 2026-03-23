---
description: '智能功能开发 - 自动识别输入类型，规划/讨论/实施全流程'
---

# Feat - 智能功能开发

$ARGUMENTS

---

## 多模型调用规范

**工作目录**：
- `{{WORKDIR}}`：替换为目标工作目录的**绝对路径**
- 如果用户通过 `/add-dir` 添加了多个工作区，先用 Glob/Grep 确定任务相关的工作区
- 如果无法确定，用 `AskUserQuestion` 询问用户选择目标工作区
- 默认使用当前工作目录

**调用语法**（并行用 `run_in_background: true`，串行用 `false`）：

```
# 新会话调用
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--progress --backend <codex|gemini> {{GEMINI_MODEL_FLAG}}- \"{{WORKDIR}}\" <<'EOF'
ROLE_FILE: <角色提示词路径>
<TASK>
需求：<增强后的需求（如未增强则用 $ARGUMENTS）>
上下文：<前序阶段收集的项目上下文、计划文件内容等>
</TASK>
OUTPUT: 期望输出格式
EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "简短描述"
})

# 复用会话调用
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--progress --backend <codex|gemini> {{GEMINI_MODEL_FLAG}}resume <SESSION_ID> - \"{{WORKDIR}}\" <<'EOF'
ROLE_FILE: <角色提示词路径>
<TASK>
需求：<增强后的需求（如未增强则用 $ARGUMENTS）>
上下文：<前序阶段收集的项目上下文、计划文件内容等>
</TASK>
OUTPUT: 期望输出格式
EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "简短描述"
})
```

**模型参数说明**：
- `{{GEMINI_MODEL_FLAG}}`：当使用 `--backend gemini` 时，替换为 `--gemini-model gemini-3.1-pro-preview `（注意末尾空格）；使用 codex 时替换为空字符串

**角色提示词**：

| 阶段 | Codex | Gemini |
|------|-------|--------|
| 分析 | `~/.claude/.ccg/prompts/codex/analyzer.md` | `~/.claude/.ccg/prompts/gemini/analyzer.md` |
| 规划 | `~/.claude/.ccg/prompts/codex/architect.md` | `~/.claude/.ccg/prompts/gemini/architect.md` |
| 实施 | `~/.claude/.ccg/prompts/codex/architect.md` | `~/.claude/.ccg/prompts/gemini/frontend.md` |
| 审查 | `~/.claude/.ccg/prompts/codex/reviewer.md` | `~/.claude/.ccg/prompts/gemini/reviewer.md` |

**会话复用**：每次调用返回 `SESSION_ID: xxx`，后续阶段用 `resume xxx` 复用上下文。

**并行调用**：使用 `run_in_background: true` 启动，用 `TaskOutput` 等待结果。**必须等所有模型返回后才能进入下一阶段**。

**等待后台任务**（使用最大超时 600000ms = 10 分钟）：

```
TaskOutput({ task_id: "<task_id>", block: true, timeout: 600000 })
```

**重要**：
- 必须指定 `timeout: 600000`，否则默认只有 30 秒会导致提前超时。
如果 10 分钟后仍未完成，继续用 `TaskOutput` 轮询，**绝对不要 Kill 进程**。
- 若因等待时间过长跳过了等待 TaskOutput 结果，则**必须调用 `AskUserQuestion` 工具询问用户选择继续等待还是 Kill Task。禁止直接 Kill Task。**
- ⛔ **Gemini 失败必须重试**：若 Gemini 调用失败（非零退出码或输出包含错误信息），最多重试 2 次（间隔 5 秒）。仅当 3 次全部失败时才跳过 Gemini 结果并使用单模型结果继续。
- ⛔ **Codex 结果必须等待**：Codex 执行时间较长（5-15 分钟）属于正常。TaskOutput 超时后必须继续用 TaskOutput 轮询，**绝对禁止在 Codex 未返回结果时直接跳过或继续下一阶段**。已启动的 Codex 任务若被跳过 = 浪费 token + 丢失结果。

---

## 沟通守则

1. 在需要询问用户时，尽量使用 `AskUserQuestion` 工具进行交互，举例场景：请求用户确认/选择/批准

---

## 核心工作流程

### 1. 输入类型判断

**每次交互必须首先声明**：「我判断此次操作类型为：[具体类型]」

| 类型 | 关键词 | 动作 |
|------|--------|------|
| **需求规划** | 实现、开发、新增、添加、构建、设计 | → 步骤 2（完整规划） |
| **讨论迭代** | 调整、修改、优化、改进、包含计划文件路径 | → 读取现有计划 → 步骤 2.3 |
| **执行实施** | 开始实施、执行计划、按照计划、根据计划 | → 步骤 3（直接实施） |

---

### 2. 需求规划流程

#### 2.0 Prompt 增强

**Prompt 增强**（按 `/ccg:enhance` 的逻辑执行）：分析 $ARGUMENTS 的意图、缺失信息、隐含假设，补全为结构化需求（明确目标、技术约束、范围边界、验收标准），**用增强结果替代原始 $ARGUMENTS，后续调用 Codex/Gemini 时传入增强后的需求**

#### 2.1 上下文检索

调用 `{{MCP_SEARCH_TOOL}}` 检索相关代码、组件、技术栈。

#### 2.2 任务类型判断

| 任务类型 | 判断依据 | 调用流程 |
|----------|----------|----------|
| **前端** | 页面、组件、UI、样式、布局 | ui-ux-designer → planner |
| **后端** | API、接口、数据库、逻辑、算法 | planner |
| **全栈** | 同时包含前后端 | ui-ux-designer → planner |

#### 2.3 调用 Agents

**前端/全栈任务**：先调用 `ui-ux-designer` agent
```
执行 agent: ~/.claude/agents/ccg/ui-ux-designer.md
输入: 项目上下文 + 用户需求 + 技术栈
输出: UI/UX 设计方案
```

**所有任务**：调用 `planner` agent
```
执行 agent: ~/.claude/agents/ccg/planner.md
输入: 项目上下文 + UI设计方案(如有) + 用户需求
输出: 功能规划文档
```

#### 2.4 保存计划

**文件命名规则**：
- 首次规划：`.claude/plan/功能名.md`
- 迭代版本：`.claude/plan/功能名-1.md`、`.claude/plan/功能名-2.md`...

#### 2.5 交互确认

规划完成后询问用户：
- **开始实施** → 步骤 3
- **讨论调整** → 重新执行步骤 2.3
- **重新规划** → 删除当前计划，重新执行步骤 2
- **仅保存计划** → 退出

---

### 3. 执行实施流程

#### 3.1 读取计划

优先使用用户指定路径，否则读取最新的计划文件。

#### 3.2 任务类型分析

从计划提取任务分类：前端 / 后端 / 全栈

#### 3.3 多模型路由实施

按上方调用规范调用外部模型：

- **前端任务**：调用 Gemini，使用实施提示词
- **后端任务**：调用 Codex，使用实施提示词
- **全栈任务**：并行调用 Codex + Gemini（`run_in_background: true`），用 `TaskOutput` 等待结果

**⚠️ 强制规则：必须等待 TaskOutput 返回所有模型的完整结果后才能进入下一阶段**

**务必遵循上方 `多模型调用规范` 的 `重要` 指示**

#### 3.4 实施后验证

```bash
git status --short
git diff --name-status
```

询问用户是否运行代码审查（`/ccg:review`）。

---

### 4. 关键执行原则

1. **强制响应要求**：每次交互必须首先说明判断的操作类型
2. **文档一致性**：规划文档与实际执行保持同步
3. **依赖关系管理**：前端任务必须确保 UI 设计完整性
4. **多模型信任规则**：
   - 前端以 Gemini 为准
   - 后端以 Codex 为准
5. **用户沟通透明**：所有判断和动作都要明确告知用户

---

## 使用方法

```bash
/feat <功能描述>
```
