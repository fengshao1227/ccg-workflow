---
description: 'Agent Teams 8 阶段企业级工作流 - 7 角色全流程统一编排（需求→架构→规划→开发→测试→审查→修复→集成）'
---
<!-- CCG:TEAM:UNIFIED:START -->

⛔⛔⛔ **CRITICAL HARD RULE — AGENT TEAMS ONLY** ⛔⛔⛔

**禁止使用普通 Agent 子代理。本命令的所有角色必须通过 Agent Teams 创建：**

1. **第一步永远是 TeamCreate** — 创建一个 team，获得 team_name
2. **所有角色通过 Agent(team_name=..., name=...) spawn** — 这样它们才是真正的 teammates
3. **通过 TaskCreate/TaskUpdate 分配任务** — 共享任务板
4. **通过 SendMessage 通信** — teammates 之间直接通信
5. **禁止使用不带 team_name 的 Agent() 调用** — 那是普通子代理，不是 Agent Teams

**正确示范（必须这样做）**:
```
TeamCreate({ team_name: "todo-crud-team", description: "..." })

TaskCreate({ subject: "架构蓝图设计", description: "..." })

Agent({ team_name: "todo-crud-team", name: "architect", prompt: "...", model: "sonnet" })

TaskUpdate({ taskId: "1", owner: "architect" })
```

**错误示范（绝对禁止）**:
```
❌ Agent({ prompt: "...", subagent_type: "Plan" })          ← 这是普通子代理！
❌ Agent({ description: "...", prompt: "..." })              ← 没有 team_name！
❌ Agent({ name: "architect", prompt: "..." })               ← 没有 team_name！
```

违反此规则 = 整个工作流无效，必须重来。

⛔⛔⛔ **END HARD RULE** ⛔⛔⛔

---

**Core Philosophy**
- 单命令完成从需求到交付的完整流程，对标大厂工程团队编制。
- Lead（你自己）是技术总监/PM，只做编排和决策，绝不写产品代码。
- 所有专业角色（Architect、Dev、QA、Reviewer）均为 **Agent Teams 真实 teammates**。
- 必须通过 TeamCreate 创建 team，再通过 Agent(team_name=...) spawn teammates。
- 通过 SendMessage 通信，通过 TaskList/TaskCreate/TaskUpdate 协调。
- 后端/前端模型 多模型分析只在 Architecture 和 Review 阶段作为"外援参考"注入。

**角色编制（7 角色）**

| 角色 | 身份 | spawn 方式 | 模型 | 职责 |
|------|------|-----------|------|------|
| 🏛 Lead | 你自己（主对话） | N/A（不需要 spawn） | Opus | 编排、决策、用户沟通 |
| 🏗 Architect | Agent Teams teammate | `Agent(team_name=T, name="architect")` | Opus | 代码库扫描、架构蓝图、文件分配 |
| 📜 Dev × N | Agent Teams teammates | `Agent(team_name=T, name="dev-1")` | Sonnet | 并行编码，文件隔离 |
| 🧪 QA | Agent Teams teammate | `Agent(team_name=T, name="qa")` | Sonnet | 写测试、跑测试、lint、typecheck |
| 🔬 Reviewer | Agent Teams teammate | `Agent(team_name=T, name="reviewer")` | Sonnet | 综合审查，分级判决 |
| 🔥 {{BACKEND_PRIMARY}} | 外部模型（非 teammate） | Bash + codeagent-wrapper | {{BACKEND_PRIMARY}} | 后端分析/审查（Phase 2, 6） |
| 🔮 {{FRONTEND_PRIMARY}} | 外部模型（非 teammate） | Bash + codeagent-wrapper | {{FRONTEND_PRIMARY}} | 前端分析/审查（Phase 2, 6） |

**8 阶段流水线**

```
Phase 0: PRE-FLIGHT    → 环境检测
Phase 1: REQUIREMENT   → Lead 需求增强 → mini-PRD
Phase 2: ARCHITECTURE  → {{BACKEND_PRIMARY}}∥{{FRONTEND_PRIMARY}} 分析 + Architect teammate 出蓝图
Phase 3: PLANNING      → Lead 拆任务 → 零决策并行计划
Phase 4: DEVELOPMENT   → Dev×N teammates 并行编码
Phase 5: TESTING       → QA teammate 写测试+跑测试
Phase 6: REVIEW        → {{BACKEND_PRIMARY}}∥{{FRONTEND_PRIMARY}} 审查 + Reviewer teammate 综合判决
Phase 7: FIX           → Dev teammate(s) 修复 Critical（最多 2 轮）
Phase 8: INTEGRATION   → Lead 全量验证 + 报告 + 清理
```

**Guardrails**
- **Agent Teams 必须启用**：需要 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`。
- Lead 绝不直接修改产品代码。
- 每个 Dev 只能修改分配给它的文件。
- QA 只写测试文件，不改产品代码。
- Reviewer 只读不写。
- Architect 只读不写。
- Phase 7 最多 2 轮修复循环。

**Steps**

---

### Phase 0: PRE-FLIGHT + 创建 Team

1. **获取工作目录**
   - 通过 Bash 执行 `pwd` 获取当前工作目录的绝对路径，保存为 WORKDIR。

2. **解析 $ARGUMENTS**
   - 如果参数为空，用 AskUserQuestion 请求任务描述。
   - 从任务描述中提取一个英文短横线命名的任务名（如 `todo-crud`），用于文件命名和 team 命名。

3. **⛔ 立即创建 Team — 这是你的第一个工具调用动作**
   - 你必须现在就调用 TeamCreate 工具。不是稍后，不是在 Phase 2，而是**现在**。
   - 调用 TeamCreate，参数：team_name 设为 `<任务名>-team`，description 设为任务描述。
   - 这一步创建了共享任务板和通信通道。后续所有 Agent 调用都必须带上这个 team_name。
   - 如果 TeamCreate 失败（Agent Teams 未启用），输出启用指引后终止。

---

### Phase 1: REQUIREMENT

**执行者**：Lead（你自己）

1. **需求增强**
   - 分析 $ARGUMENTS 的意图、缺失信息、隐含假设。
   - 补全为结构化需求：明确目标、技术约束、范围边界、验收标准。

2. **生成 mini-PRD**
   - 用 Glob/Grep/Read 快速扫描项目结构，了解技术栈。
   - 写入 `.claude/team-plan/<任务名>-prd.md`：

   ```markdown
   # PRD: <任务名>
   ## 目标
   <一句话描述>
   ## 功能范围
   - 包含：[列表]
   - 不包含：[列表]
   ## 技术上下文
   - 技术栈：[自动检测]
   - 项目结构：[关键目录]
   ## 验收标准
   - [AC-1] <可验证条件>
   - [AC-2] ...
   ```

3. **用户确认**
   - 用 `AskUserQuestion` 展示 PRD 摘要，请求确认或补充。

---

### Phase 2: ARCHITECTURE

**执行者**：Lead 调用后端/前端模型 → Architect teammate 综合

1. **Team 已在 Phase 0 创建**，直接使用已有的 team_name。

2. **{{BACKEND_PRIMARY}} + {{FRONTEND_PRIMARY}} 并行分析（PARALLEL）**
   - **CRITICAL**: 必须在一条消息中同时发起两个 Bash 调用，`run_in_background: true`。

   **FIRST Bash call ({{BACKEND_PRIMARY}})**:
   ```
   Bash({
     command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--progress --backend {{BACKEND_PRIMARY}} {{GEMINI_MODEL_FLAG}}{{GROK_MODEL_FLAG}}{{KIMI_MODEL_FLAG}}{{OPENCODE_MODEL_FLAG}}- \"{{WORKDIR}}\" <<'EOF'\nROLE_FILE: ~/.claude/.ccg/prompts/{{BACKEND_PRIMARY}}/architect.md\n<TASK>\n需求：<PRD 内容>\n请分析后端架构：模块边界、API 设计、数据模型、依赖关系、实施建议。\n</TASK>\nEOF",
     run_in_background: true,
     timeout: 3600000,
     description: "{{BACKEND_PRIMARY}} 后端架构分析"
   })
   ```

   **SECOND Bash call ({{FRONTEND_PRIMARY}}) - IN THE SAME MESSAGE**:
   ```
   Bash({
     command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--progress --backend {{FRONTEND_PRIMARY}} {{GEMINI_MODEL_FLAG}}{{GROK_MODEL_FLAG}}{{KIMI_MODEL_FLAG}}{{OPENCODE_MODEL_FLAG}}- \"{{WORKDIR}}\" <<'EOF'\nROLE_FILE: ~/.claude/.ccg/prompts/{{FRONTEND_PRIMARY}}/architect.md\n<TASK>\n需求：<PRD 内容>\n请分析前端架构：组件拆分、状态管理、路由设计、UI/UX 要点、实施建议。\n</TASK>\nEOF",
     run_in_background: true,
     timeout: 3600000,
     description: "{{FRONTEND_PRIMARY}} 前端架构分析"
   })
   ```

   **等待结果**:
   ```
   TaskOutput({ task_id: "<codex_task_id>", block: true, timeout: 600000 })
   TaskOutput({ task_id: "<gemini_task_id>", block: true, timeout: 600000 })
   ```

   ⛔ **前端模型失败必须重试**：若前端模型调用失败，最多重试 2 次（间隔 5 秒）。3 次全败才跳过。
   ⛔ **后端模型结果必须等待**：后端模型执行 5-15 分钟属正常，超时后继续轮询，禁止跳过。

3. **Spawn Architect teammate**
   - 先调用 TaskCreate 工具，subject 为 "架构蓝图设计"。
   - 然后调用 Agent 工具 spawn Architect。**你必须在 Agent 工具调用中设置以下参数**：
     * **team_name**: 设为 Phase 0 创建的 team name（如 `todo-crud-team`）
     * **name**: 设为 `"architect"`
     * **model**: 设为 `"opus"`
     * **prompt**: 包含 PRD 内容、后端/前端模型 分析摘要（如有）、WORKDIR、以及指令（扫描代码库→设计蓝图→输出文件分配矩阵→写入 .claude/team-plan/→标记 completed）
   - 调用 TaskUpdate 将任务 owner 设为 `"architect"`。
   - 等待 Architect 完成（它会自动发消息通知你）。

4. **读取蓝图**
   - Read `.claude/team-plan/<任务名>-blueprint.md`
   - 验证文件分配矩阵完整性（每个文件只在一个 Dev 集合中）。

5. **Shutdown Architect**
   - `SendMessage({ to: "architect", message: { type: "shutdown_request" } })`

---

### Phase 3: PLANNING

**执行者**：Lead（你自己）

1. **基于蓝图拆分子任务**
   - 读取蓝图中的文件分配矩阵。
   - 为每个 Dev 文件集合创建一个子任务。
   - 每个子任务必须包含：
     * 精确的文件范围（从蓝图的文件分配矩阵）
     * 具体的实施步骤（从蓝图的设计方案）
     * 验收标准（从蓝图和 PRD）

2. **确保文件隔离**
   - 校验：任何文件不出现在两个子任务中。
   - 若发现重叠 → 将重叠文件放入同一子任务，或设置依赖关系。

3. **并行分层**
   - Layer 1：无依赖的子任务（可并行）。
   - Layer 2：依赖 Layer 1 的子任务。

4. **写入计划文件**
   - 路径：`.claude/team-plan/<任务名>-plan.md`
   - 格式同现有 team-plan 输出格式（见 `/ccg:team-plan`）。

5. **用户确认**
   - 用 `AskUserQuestion` 展示计划摘要：
     ```
     📋 即将并行实施：
     - 子任务：N 个
     - 并行分组：Layer 1 (X 个并行) → Layer 2 (Y 个)
     - Dev 数量：N 个
     确认开始？
     ```

---

### Phase 4: DEVELOPMENT

**执行者**：Dev × N teammates（⛔ 必须并行）

⛔ **核心规则：所有同 Layer 的 Dev 必须在同一条消息中同时 spawn，让它们并行跑。禁止串行（spawn dev-1 → 等完成 → spawn dev-2）。**

1. **一次性创建所有 Task + 设置依赖**
   - 为蓝图中的每个子任务调用 TaskCreate（在同一轮完成所有 TaskCreate）。
   - 如有 Layer 依赖：用 TaskUpdate 的 addBlockedBy 设置。

2. **⛔ 在同一条消息中并行 spawn 所有同 Layer 的 Dev**
   - 你必须在**一条消息中发起多个 Agent 工具调用**，每个 Dev 一个 Agent 调用。
   - 例如 3 个并行 Dev，你的这条消息应包含 3 个 Agent 工具调用，它们会同时启动。
   - 每个 Agent 调用必须设置：
     * **team_name**: Phase 0 创建的 team name
     * **name**: `"dev-1"`, `"dev-2"`, `"dev-3"` 等
     * **model**: `"sonnet"`
     * **prompt**: 包含该 Dev 的子任务内容、WORKDIR、文件范围约束、实施步骤、验收标准
   - spawn 后立即对每个 Task 调用 TaskUpdate 设 owner。

   示意（3 个 Dev 并行）：
   你的一条消息中同时包含：
   - Agent(team_name=T, name="dev-1", prompt="...任务1...")
   - Agent(team_name=T, name="dev-2", prompt="...任务2...")
   - Agent(team_name=T, name="dev-3", prompt="...任务3...")
   三个 Dev 同时启动，并行工作。

3. **等待所有 Dev 完成**
   - teammates 完成后会自动发消息通知，无需轮询。
   - 如果某个 Dev 遇到问题并发消息求助：通过 SendMessage 回复指导。
   - 如果某个 Dev 失败：记录失败原因，不影响其他 Dev 继续。

4. **Layer 2（如有）**
   - Layer 1 所有 Dev 完成后，同样在一条消息中并行 spawn Layer 2 的所有 Dev。

5. **所有 Dev 完成后，Shutdown 所有 Dev**
   - 逐一发送 shutdown_request。

---

### Phase 5: TESTING

**执行者**：QA teammate

1. **收集变更清单**
   - 运行 `git diff --name-only` 获取所有变更文件列表。

2. **Spawn QA teammate**
   - 调用 TaskCreate，subject 为 "QA: 全量测试验证"。
   - 调用 Agent 工具，**必须设置以下参数**：
     * **team_name**: Phase 0 创建的 team name
     * **name**: `"qa"`
     * **model**: `"sonnet"`
     * **prompt**: 包含变更文件列表、验收标准、WORKDIR、以及指令（检测测试框架→写测试→跑全量→输出报告→标记 completed）
   - 调用 TaskUpdate 设 owner 为 `"qa"`。
   - 等待 QA 完成（它会自动发消息通知你）。

3. **读取 QA 报告**
   - 从 QA 的消息或任务 metadata 中获取质量报告。
   - 如果测试全部通过 → 继续 Phase 6。
   - 如果测试失败 → 记录失败项，继续 Phase 6（Review 可能发现根因）。

4. **Shutdown QA**
   - `SendMessage({ to: "qa", message: { type: "shutdown_request" } })`

---

### Phase 6: REVIEW

**执行者**：Lead 调用后端/前端模型 → Reviewer teammate 综合

1. **运行 git diff 获取变更**
   - `Bash: git diff` 获取完整变更内容。

2. **{{BACKEND_PRIMARY}} + {{FRONTEND_PRIMARY}} 并行审查（PARALLEL）**
   - 模式与 Phase 2 相同，使用 reviewer prompt：

   **FIRST Bash call ({{BACKEND_PRIMARY}})**:
   ```
   Bash({
     command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--progress --backend {{BACKEND_PRIMARY}} {{GEMINI_MODEL_FLAG}}{{GROK_MODEL_FLAG}}{{KIMI_MODEL_FLAG}}{{OPENCODE_MODEL_FLAG}}- \"{{WORKDIR}}\" <<'EOF'\nROLE_FILE: ~/.claude/.ccg/prompts/{{BACKEND_PRIMARY}}/reviewer.md\n<TASK>\n审查以下变更：\n<git diff 输出或变更文件列表>\n</TASK>\nOUTPUT (JSON):\n{\n  \"findings\": [{\"severity\": \"Critical|Warning|Info\", \"dimension\": \"logic|security|performance|error_handling\", \"file\": \"path\", \"line\": N, \"description\": \"描述\", \"fix_suggestion\": \"修复建议\"}],\n  \"passed_checks\": [\"检查项\"],\n  \"summary\": \"总体评估\"\n}\nEOF",
     run_in_background: true,
     timeout: 3600000,
     description: "{{BACKEND_PRIMARY}} 后端审查"
   })
   ```

   **SECOND Bash call ({{FRONTEND_PRIMARY}}) - IN THE SAME MESSAGE**:
   ```
   Bash({
     command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--progress --backend {{FRONTEND_PRIMARY}} {{GEMINI_MODEL_FLAG}}{{GROK_MODEL_FLAG}}{{KIMI_MODEL_FLAG}}{{OPENCODE_MODEL_FLAG}}- \"{{WORKDIR}}\" <<'EOF'\nROLE_FILE: ~/.claude/.ccg/prompts/{{FRONTEND_PRIMARY}}/reviewer.md\n<TASK>\n审查以下变更：\n<git diff 输出或变更文件列表>\n</TASK>\nOUTPUT (JSON):\n{\n  \"findings\": [{\"severity\": \"Critical|Warning|Info\", \"dimension\": \"patterns|maintainability|accessibility|ux|frontend_security\", \"file\": \"path\", \"line\": N, \"description\": \"描述\", \"fix_suggestion\": \"修复建议\"}],\n  \"passed_checks\": [\"检查项\"],\n  \"summary\": \"总体评估\"\n}\nEOF",
     run_in_background: true,
     timeout: 3600000,
     description: "{{FRONTEND_PRIMARY}} 前端审查"
   })
   ```

   ⛔ **前端模型失败必须重试**：若失败，最多重试 2 次（间隔 5 秒）。3 次全败才跳过。
   ⛔ **后端模型结果必须等待**：超时后继续轮询，禁止跳过。

3. **Spawn Reviewer teammate**
   - 调用 TaskCreate，subject 为 "Review: 综合代码审查"。
   - 调用 Agent 工具，**必须设置以下参数**：
     * **team_name**: Phase 0 创建的 team name
     * **name**: `"reviewer"`
     * **model**: `"sonnet"`
     * **prompt**: 包含 git diff、后端/前端模型 审查 JSON（如有）、QA 报告、WORKDIR、以及指令（独立审查→综合意见→分级→输出报告→标记 completed）
   - 调用 TaskUpdate 设 owner 为 `"reviewer"`。
   - 等待 Reviewer 完成（它会自动发消息通知你）。

4. **读取审查报告**
   - 从 Reviewer 消息中提取 Critical / Warning / Info 列表。
   - 向用户展示审查摘要。

5. **Shutdown Reviewer**
   - `SendMessage({ to: "reviewer", message: { type: "shutdown_request" } })`

---

### Phase 7: FIX (Evaluator-Optimizer Loop)

**执行者**：Dev teammate(s)，最多 2 轮

**FIX_ROUND = 0**

1. **判断是否需要修复**
   - 如果 Critical == 0 → 跳过 Phase 7，直接进入 Phase 8。
   - 如果 Critical > 0 → 进入修复循环。

2. **修复循环（最多 2 轮）**

   **WHILE Critical > 0 AND FIX_ROUND < 2:**

   a. **FIX_ROUND += 1**

   b. **创建修复任务**
      - 为每个 Critical finding 创建修复任务。
      - 根据 finding 的文件归属，分配给对应的 Dev。
      - 如果多个 finding 涉及同一文件 → 合并为一个修复任务。

   c. **Spawn Fix Dev teammate(s)**
      - 调用 Agent 工具，**必须设置以下参数**：
        * **team_name**: Phase 0 创建的 team name
        * **name**: `"fix-dev-1"`, `"fix-dev-2"`, ... 依次命名
        * **model**: `"sonnet"`
        * **prompt**: 包含 Critical findings（文件、行号、描述、修复建议）、文件范围约束、WORKDIR

   d. **等待修复完成**

   e. **Shutdown Fix Dev(s)**

   f. **轻量验证**
      - Lead 通过 Bash 运行测试命令验证修复：
        ```
        Bash: cd {{WORKDIR}} && <测试命令>
        ```
      - 快速检查修复的 Critical 是否解决（Read 修复的文件验证）。

   g. **更新 Critical 计数**
      - 如果 Critical 仍 > 0 且 FIX_ROUND < 2 → 继续循环。
      - 如果 FIX_ROUND >= 2 且 Critical 仍 > 0 → 退出循环，报告用户。

3. **修复循环结束**
   - 如果所有 Critical 已修复 → 继续 Phase 8。
   - 如果仍有 Critical → 用 `AskUserQuestion` 报告：
     ```
     经过 2 轮自动修复，仍有 N 个 Critical 问题未解决：
     - [C-X] 描述...
     选择：继续手动修复 / 跳过并提交
     ```

---

### Phase 8: INTEGRATION

**执行者**：Lead（你自己）

1. **全量验证**
   - 运行完整测试套件：`Bash: cd {{WORKDIR}} && <测试命令>`
   - 运行 lint（如有）。
   - 运行 typecheck（如有）。

2. **知识沉淀**
   - 写入最终报告到 `.claude/team-plan/<任务名>-report.md`：

   ```markdown
   # Team Report: <任务名>

   ## 概述
   <一句话描述完成的工作>

   ## 团队编制
   - Architect: 1
   - Dev: N
   - QA: 1
   - Reviewer: 1
   - 外援: {{BACKEND_PRIMARY}} + {{FRONTEND_PRIMARY}}

   ## 阶段执行摘要
   | 阶段 | 状态 | 关键产出 |
   |------|------|----------|
   | Requirement | ✅ | PRD |
   | Architecture | ✅ | 蓝图 + 文件分配 |
   | Planning | ✅ | N 个子任务 |
   | Development | ✅/⚠️ | 变更文件列表 |
   | Testing | ✅/❌ | 测试报告 |
   | Review | ✅/⚠️ | 审查报告 |
   | Fix | ✅/⚠️/N/A | 修复 N 轮 |

   ## 变更摘要
   | Dev | 子任务 | 状态 | 修改文件 |
   |-----|--------|------|----------|
   | dev-1 | <名称> | ✅/❌ | file1, file2 |
   | dev-2 | <名称> | ✅/❌ | file3 |

   ## 审查结论
   - Critical: 0 ✅
   - Warning: N
   - Info: N

   ## 测试结论
   - 通过: N / 总计: N
   - Lint: ✅/❌
   - Typecheck: ✅/❌

   ## 后续建议
   1. [建议项]
   ```

3. **输出最终摘要**
   - 向用户展示简洁的完成报告。

4. **清理 Team**
   - 确保所有 teammates 已 shutdown。
   - 如果仍有活跃的 teammates → 逐一发送 shutdown_request。
   - `TeamDelete()` 清理 team。

---

**Exit Criteria**
- [ ] 所有 8 个阶段已执行（或明确跳过并记录原因）
- [ ] PRD、蓝图、计划、报告 4 个产物文件已写入 `.claude/team-plan/`
- [ ] 所有 Critical 审查问题已修复（或用户确认跳过）
- [ ] 测试通过（或用户确认接受失败项）
- [ ] Team 已清理（所有 teammates shutdown + TeamDelete）
- [ ] 最终报告已输出给用户
<!-- CCG:TEAM:UNIFIED:END -->
