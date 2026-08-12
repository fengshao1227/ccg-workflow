---
description: 'Agent Teams 规划 - Lead 调用后端/前端模型 并行分析，产出零决策并行实施计划'
---
<!-- CCG:TEAM:PLAN:START -->
**Core Philosophy**
- 产出的计划必须让 Builder teammates 能无决策机械执行。
- 每个子任务的文件范围必须隔离，确保并行不冲突。
- 多模型协作是强制的：{{BACKEND_PRIMARY}}（后端权威）+ {{FRONTEND_PRIMARY}}（前端权威）。

**Guardrails**
- 多模型分析是 **mandatory**：必须同时调用 {{BACKEND_PRIMARY}} 和 {{FRONTEND_PRIMARY}}。
- 不写产品代码，只做分析和规划。
- 计划文件必须包含 外部模型的实际分析摘要。
- 使用 `AskUserQuestion` 解决任何歧义。

**Steps**
1. **上下文收集**
   - 用 Glob/Grep/Read 分析项目结构、技术栈、现有代码模式。
   - 如果 `{{MCP_SEARCH_TOOL}}` 可用，优先语义检索。
   - 整理出：技术栈、目录结构、关键文件、现有模式。

2. **多模型并行分析（PARALLEL）**
   - **CRITICAL**: 必须在一条消息中同时发起两个 Bash 调用，`run_in_background: true`。
   - **工作目录**：`{{WORKDIR}}` **必须通过 Bash 执行 `pwd`（Unix）或 `cd`（Windows CMD）获取当前工作目录的绝对路径**，禁止从 `$HOME` 或环境变量推断。

   **FIRST Bash call ({{BACKEND_PRIMARY}})**:
   ```
   Bash({
     command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--progress --backend {{BACKEND_PRIMARY}} {{GEMINI_MODEL_FLAG}}{{GROK_MODEL_FLAG}}{{KIMI_MODEL_FLAG}}{{OPENCODE_MODEL_FLAG}}- \"{{WORKDIR}}\" <<'EOF'\nROLE_FILE: ~/.claude/.ccg/prompts/{{BACKEND_PRIMARY}}/analyzer.md\n<TASK>\n需求：$ARGUMENTS\n上下文：<步骤1收集的项目结构和关键代码>\n</TASK>\nOUTPUT:\n1) 技术可行性评估\n2) 推荐架构方案（精确到文件和函数）\n3) 详细实施步骤\n4) 风险评估\nEOF",
     run_in_background: true,
     timeout: 3600000,
     description: "{{BACKEND_PRIMARY}} 后端分析"
   })
   ```

   **SECOND Bash call ({{FRONTEND_PRIMARY}}) - IN THE SAME MESSAGE**:
   ```
   Bash({
     command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--progress --backend {{FRONTEND_PRIMARY}} {{GEMINI_MODEL_FLAG}}{{GROK_MODEL_FLAG}}{{KIMI_MODEL_FLAG}}{{OPENCODE_MODEL_FLAG}}- \"{{WORKDIR}}\" <<'EOF'\nROLE_FILE: ~/.claude/.ccg/prompts/{{FRONTEND_PRIMARY}}/analyzer.md\n<TASK>\n需求：$ARGUMENTS\n上下文：<步骤1收集的项目结构和关键代码>\n</TASK>\nOUTPUT:\n1) UI/UX 方案\n2) 组件拆分建议（精确到文件和函数）\n3) 详细实施步骤\n4) 交互设计要点\nEOF",
     run_in_background: true,
     timeout: 3600000,
     description: "{{FRONTEND_PRIMARY}} 前端分析"
   })
   ```

   **等待结果**:
   ```
   TaskOutput({ task_id: "<codex_task_id>", block: true, timeout: 600000 })
   TaskOutput({ task_id: "<gemini_task_id>", block: true, timeout: 600000 })
   ```

   - 必须指定 `timeout: 600000`，否则默认 30 秒会提前超时。
   - 若 10 分钟后仍未完成，继续轮询，**绝对不要 Kill 进程**。
   - ⛔ **前端模型失败必须重试**：若前端模型调用失败（非零退出码或输出包含错误信息），最多重试 2 次（间隔 5 秒）。仅当 3 次全部失败时才跳过前端模型结果并使用单模型结果继续。
   - ⛔ **后端模型结果必须等待**：后端模型执行时间较长（5-15 分钟）属于正常。TaskOutput 超时后必须继续轮询，**绝对禁止在后端模型未返回结果时直接跳过**。

3. **综合分析 + 任务拆分**
   - 后端方案以 {{BACKEND_PRIMARY}} 为准，前端方案以 {{FRONTEND_PRIMARY}} 为准。
   - 拆分为独立子任务，每个子任务：
     * 文件范围不重叠（**强制**）
     * 如果无法避免重叠 → 设为依赖关系
     * 有具体实施步骤和验收标准
   - 按依赖关系分 Layer：同 Layer 可并行，跨 Layer 串行。

4. **写入计划文件**
   - 路径：`.claude/team-plan/<任务名>.md`（英文短横线命名）
   - 格式：

   ```markdown
   # Team Plan: <任务名>

   ## 概述
   <一句话描述>

   ## {{BACKEND_PRIMARY}} 分析摘要
   <后端模型实际返回的关键内容>

   ## {{FRONTEND_PRIMARY}} 分析摘要
   <前端模型实际返回的关键内容>

   ## 技术方案
   <综合最优方案，含关键技术决策>

   ## 子任务列表

   ### Task 1: <名称>
   - **类型**: 前端/后端
   - **文件范围**: <精确文件路径列表>
   - **依赖**: 无 / Task N
   - **实施步骤**:
     1. <具体步骤>
     2. <具体步骤>
   - **验收标准**: <怎么算完成>

   ### Task 2: <名称>
   ...

   ## 文件冲突检查
   ✅ 无冲突 / ⚠️ 已通过依赖关系解决

   ## 并行分组
   - Layer 1 (并行): Task 1, Task 2
   - Layer 2 (依赖 Layer 1): Task 3
   ```

5. **用户确认**
   - 展示计划摘要（子任务数、并行分组、Builder 数量）。
   - 用 `AskUserQuestion` 请求确认。
   - 确认后提示：`计划已就绪，运行 /ccg:team-exec 开始并行实施`

6. **上下文检查点**
   - 报告当前上下文使用量。
   - 如果接近 80K：建议 `/clear` 后运行 `/ccg:team-exec`。

**Exit Criteria**
- [ ] {{BACKEND_PRIMARY}} + {{FRONTEND_PRIMARY}} 分析完成
- [ ] 子任务文件范围无冲突
- [ ] 计划文件已写入 `.claude/team-plan/`
- [ ] 用户已确认计划
<!-- CCG:TEAM:PLAN:END -->
