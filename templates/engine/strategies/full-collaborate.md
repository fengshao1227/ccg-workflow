# Strategy: Full Collaborate — 完整多模型协作

> 适用于复杂功能开发，需要多模型并行分析、规划和审查。等效于 /ccg:workflow。

## 适用条件
- 复杂度 L/XL（5+ 文件，跨模块，架构级变更）
- 风险 medium 或 high
- 需要多角度分析和交叉验证

## 前置加载

```
Read("~/.claude/.ccg/engine/model-router.md")
```

---

## 工作流状态机

[phase-state:1-research]
当前阶段：研究与分析 [模式：研究]
📍 Next: 需求评分 ≥7 后进入多模型构思
[/phase-state:1-research]

[phase-state:2-ideation]
当前阶段：多模型构思 [模式：构思]
Gate: 需求完整性评分 ≥7 ✓
📍 Next: 双模型分析结果返回后进入规划
[/phase-state:2-ideation]

[phase-state:3-planning]
当前阶段：详细规划 [模式：计划]
Gate: 双模型分析已返回 ✓
📍 Next: 用户审批计划后进入实施（HARD STOP）
[/phase-state:3-planning]

[phase-state:4-implementation]
当前阶段：实施 [模式：执行]
Gate: 用户已审批计划 ✓
📍 Next: 实施完成后进入优化审查
[/phase-state:4-implementation]

[phase-state:5-optimization]
当前阶段：优化审查 [模式：优化]
Gate: 实施已完成 ✓
📍 Next: 审查结果整合后进入最终验收
[/phase-state:5-optimization]

[phase-state:6-final]
当前阶段：最终验收 [模式：评审]
Gate: 优化审查已完成 ✓
📍 Next: 验收通过后建议提交
[/phase-state:6-final]

---

## 阶段详情

### Phase 1: 研究与分析 [required]

`[模式：研究]`

1. **需求增强**：分析 $ARGUMENTS 的意图、缺失信息、隐含假设，补全为结构化需求（目标、约束、范围、验收标准）
2. **上下文检索**：用 MCP 搜索工具收集项目上下文
3. **需求完整性评分**（0-10）：
   - 目标明确性（0-3）、预期结果（0-3）、边界范围（0-2）、约束条件（0-2）
   - ≥7：继续 | <7：停止，提出补充问题

**Task 更新**：
```
更新 .ccg/tasks/{task-name}/task.json:
  currentPhase → "1-research"
  nextAction → "需求增强 + 上下文检索"
```
持久化：写入 `.ccg/tasks/{task-name}/requirements.md`

### Phase 2: 多模型构思 [required]

`[模式：构思]`

**Gate check**: 需求评分 ≥7

**并行调用**（`run_in_background: true`）：
- **backend 模型**：analyzer 角色 — 技术可行性、后端方案、风险评估
- **frontend 模型**：analyzer 角色 — UI 可行性、前端方案、用户体验

使用 model-router.md 中的调用模板。

等待双模型返回：
```
TaskOutput({ task_id: "$BACKEND_TASK_ID", block: true, timeout: 600000 })
TaskOutput({ task_id: "$FRONTEND_TASK_ID", block: true, timeout: 600000 })
```

**保存 SESSION_ID**（`BACKEND_SESSION` / `FRONTEND_SESSION`）用于后续复用。

**重试规则**：
- frontend 模型失败 → 重试 2 次，间隔 5s
- backend 模型执行中（5-15 分钟正常）→ 持续等待，**绝不终止**
- 3 次全败 → 降级为单模型，告知用户

综合双方分析，输出方案对比（至少 2 个方案）。

**Task 更新**：`currentPhase → "2-ideation"`, `nextAction → "综合分析结果，进入规划"`
**持久化**：写入 `.ccg/tasks/{task-name}/analysis.md`

**策展 context.jsonl**：
在进入 Phase 3 前，策展 `.ccg/tasks/{task-name}/context.jsonl`：
- 检查 `.ccg/spec/` 存在 → 列出相关 spec 文件
- 将 analysis.md 加入（子 Agent 在规划阶段需要参考分析结果）
- 格式：每行 `{"file": "路径", "reason": "原因"}`

### Phase 3: 详细规划 [required]

`[模式：计划]`

**Gate check**: 双模型分析已返回

**并行调用**（复用会话 `resume`）：
- **backend 模型**：architect 角色 + `resume $BACKEND_SESSION`
- **frontend 模型**：architect 角色 + `resume $FRONTEND_SESSION`

综合双方规划，输出详细实施计划：
- 实施步骤（按文件/模块分组）
- 架构决策及理由
- 测试策略
- 风险及缓解措施

**持久化**：写入 `.ccg/tasks/{task-name}/plan.md`

**Task 更新**：
```
更新 task.json:
  currentPhase → "3-planning"
  gate → "user_approval_required"
  nextAction → "等待用户审批计划"
```

**⛔⛔⛔ HARD STOP — 你必须在这里停下来，向用户展示以下选项并等待回复。不可跳过，不可默认选择。⛔⛔⛔**

你现在必须输出以下内容（原样输出，不是代码块示例）：

---
⛔ **计划审批 + 执行模式选择**

请审批以上计划，并选择谁来写代码：
1. **Agent Teams** — Claude Builders 并行写，多文件同时进行
2. **外部模型写**（{{BACKEND_PRIMARY}}）— 更快更便宜、省 Claude 额度，Claude 监控审查

请回复 1 或 2（或直接点名模型，如"用team"/"用codex"/"用grok"/"用kimi" — 点名时用该模型替换默认 backend）。
---

**在用户回复之前，你不可以执行任何文件写入操作。** 未审批不可进入 Phase 4。

用户确认后：`task.json: gate → null`

### Phase 4: 实施

`[模式：执行]`

**Gate check**: 用户已审批计划 + 选择了执行模式

根据用户选择的执行模式执行：

---

#### 模式 A: Agent Teams 并行（用户选 [1]）

**⛔⛔⛔ 你的第一个动作必须是 TeamCreate。不是 Write，不是 Bash，不是 Read，是 TeamCreate。⛔⛔⛔**

**你绝对不可以自己用 Write/Edit 工具写产品代码。所有代码由 Team Builder 写。你只做编排。**

**Task 更新**：`currentPhase → "4-implementation"`, `nextAction → "TeamCreate → spawn Builders"`

#### Step 1: 拆分子任务

从 plan.md 中提取实施步骤，按**文件归属**拆分为独立子任务：
- 每个子任务有明确的文件范围（互不重叠）
- 标注依赖关系：Layer 1（无依赖）→ Layer 2（依赖 Layer 1）

#### Step 2: 创建 Team（必须执行）

**立即调用 TeamCreate，不可跳过或假设会失败：**
```
TeamCreate({ team_name: "{task-id}-team", description: "CCG 实施团队" })
```

⚠️ 只有当 TeamCreate **实际返回错误**时（Agent Teams 未启用），才可降级为自己写。**不可预判失败而跳过。**

#### Step 3: 并行 spawn Layer 1 Builders

**所有 Layer 1 Builder 必须在同一条消息中 spawn**（一条消息多个 Agent 调用 = 真正并行）：

```
Agent({
  team_name: "{task-id}-team",
  name: "dev-1",
  model: "sonnet",
  prompt: "你是 Builder，负责实施子任务 1。\n\n## 工作目录\n{WORKDIR}\n\n## 文件范围约束（⛔ 硬性规则）\n你只能创建或修改以下文件：\n- {file1}\n- {file2}\n严禁修改其他文件。违反 = 任务失败。\n\n## 实施步骤\n{steps from plan.md}\n\n## 验收标准\n{criteria from prd}\n\n完成后标记任务 completed。"
})
Agent({
  team_name: "{task-id}-team",
  name: "dev-2",
  model: "sonnet",
  prompt: "..."
})
// ... 所有 Layer 1 dev 在这一条消息里
```

#### Step 4: 等待 Layer 1 → spawn Layer 2

- teammates 完成后自动通知（不需要轮询）
- Layer 1 全部完成后 → 在新消息中 spawn Layer 2 Builders
- Builder 遇到问题 → SendMessage 指导

#### Step 5: spawn Reviewer 快检

```
Agent({
  team_name: "{task-id}-team",
  name: "reviewer",
  model: "sonnet",
  prompt: "审查所有变更文件（git diff）。运行 lint/typecheck/test。输出 Critical/Warning/Info 分级报告。完成后标记 completed。"
})
```

Critical → spawn fix-dev 修复（最多 2 轮）。

#### Step 6: shutdown + cleanup

```
SendMessage({ to: "dev-1", message: { type: "shutdown_request" } })
SendMessage({ to: "dev-2", message: { type: "shutdown_request" } })
SendMessage({ to: "reviewer", message: { type: "shutdown_request" } })
```

#### 降级方案（仅当 TeamCreate 实际报错时）

如果 TeamCreate 返回错误（如 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` 未启用），则：
1. 告知用户："Agent Teams 未启用，降级为顺序实施"
2. 按 plan.md 中的 Layer 顺序逐文件实施
3. 仍然遵守质量关卡

---

#### 模式 B: 外部模型并行实施（用户选 [2]）

**Task 更新**：`currentPhase → "4-implementation"`, `nextAction → "Parallel Builder 执行 plan"`

Claude 作为编排者，调用外部模型**并行写代码**。默认用 `{{BACKEND_PRIMARY}}`；用户点名了其他模型（codex / grok / kimi / antigravity）则替换下方调用中的 `--backend` 和 ROLE_FILE 路径。

**Step 1**: 从 plan.md 按**文件归属**拆分为并行子任务：
- **Layer 1** — 无依赖（底层模块：model/store/util/schema）→ 并行
- **Layer 2** — 依赖 Layer 1（上层：route/middleware/controller/component）→ 串行等 Layer 1
- 每个子任务：文件范围 + 实施步骤 + 验证命令

**Step 2**: 调用 codeagent-wrapper `--parallel` 模式：

```
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--progress --parallel --backend {{BACKEND_PRIMARY}} {{GEMINI_MODEL_FLAG}}{{GROK_MODEL_FLAG}}{{KIMI_MODEL_FLAG}}{{OPENCODE_MODEL_FLAG}}- \"$WORKDIR\" <<'PARALLEL_EOF'\n---TASK---\nid: layer1-{name1}\nworkdir: $WORKDIR\n---CONTENT---\nROLE_FILE: ~/.claude/.ccg/prompts/{{BACKEND_PRIMARY}}/builder.md\n<TASK>\n## 文件范围（⛔ 只改这些文件）\n{file1, file2}\n\n## 实施步骤\n{steps from plan.md Layer 1}\n\n## 验证命令\n{test/lint commands}\n</TASK>\n---TASK---\nid: layer1-{name2}\nworkdir: $WORKDIR\n---CONTENT---\nROLE_FILE: ~/.claude/.ccg/prompts/{{BACKEND_PRIMARY}}/builder.md\n<TASK>\n## 文件范围\n{file3, file4}\n\n## 实施步骤\n{steps}\n</TASK>\n---TASK---\nid: layer2-{name3}\nworkdir: $WORKDIR\ndependencies: layer1-{name1},layer1-{name2}\n---CONTENT---\nROLE_FILE: ~/.claude/.ccg/prompts/{{BACKEND_PRIMARY}}/builder.md\n<TASK>\n## 文件范围\n{file5, file6}\n\n## 实施步骤\n{steps from Layer 2}\n</TASK>\nPARALLEL_EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "Parallel Builder: {N} 个子任务（L1: {X} 并行 → L2: {Y} 串行）"
})
```

拆分原则：
- Layer 1 子任务数量 = plan 中无依赖的文件组数（通常 2-4 个）
- 每个子任务的文件范围**不可重叠**
- 可混合 backend（后端任务用 codex，前端任务用 antigravity）— 在 `---TASK---` 中指定 `backend: antigravity`

**Step 3**: 等待完成，读取汇总报告（wrapper 自动合并所有子任务结果）

**Step 4**: Claude 审查产出：
1. `git diff` 检查所有变更
2. 确认变更在 plan 范围内（scope check）
3. 小问题（<10 行）→ Claude 直接修复
4. 大问题 → 再调外部模型修复，或切换模式 A

**降级**：外部模型失败/超时 → 告知用户，切换到模式 A 执行

### Phase 5: 迭代审查 [required · Ralph Loop]

`[模式：优化]`

**Gate check**: 实施已完成

**Task 更新**：`currentPhase → "5-optimization"`, `nextAction → "Ralph Loop Round 1: 双模型审查 + 质量关卡"`

参考 `phase-guide.md § 10 Ralph Loop` 执行迭代审查。最多 3 轮。

#### Round N 流程（N=1,2,3）

**5a. 双模型交叉审查（每轮 spawn 新 Agent，干净上下文）**

**并行调用**（`run_in_background: true`）：
- **backend 模型**：reviewer 角色 — 关注安全、性能、错误处理
- **frontend 模型**：reviewer 角色 — 关注可访问性、设计一致性

**5b. 质量关卡**

**⛔ 以下 Skill 必须逐个调用执行，不可跳过，不可用自己的判断替代：**

1. 调用 Skill `verify-security` — 等待报告
2. 调用 Skill `verify-quality` — 等待报告
3. 调用 Skill `verify-change` — 等待报告

**5c. 综合报告**

整合审查意见 + 质量关卡结果，按严重度分级：
- **Critical**：必须修复（阻塞交付）
- **Warning**：建议修复
- **Info**：供参考

**持久化**：写入 `.ccg/tasks/{task-name}/review.md`（每轮覆盖）

追加进度到 `.ccg/tasks/{task-name}/fix-log.jsonl`：
```jsonl
{"round": N, "critical": X, "warning": Y, "info": Z, "ts": "ISO"}
```

**5d. 用户决定（⛔ 必须等待）**

展示审查结果后询问用户：
- 有 Critical → `发现 N 个 Critical 问题。修复后再审一轮？[Y/n]`
- 无 Critical 但有 Warning → `无 Critical 问题。需要再审一轮处理 Warning？[y/N]`
- 全部通过 → 直接进入 Phase 6

用户选择继续 →
1. spawn fix-dev（**新 Agent，干净上下文**）修复 Critical/Warning
2. fix-dev 完成后回到 5a 开始 Round N+1
3. 追加修复记录到 fix-log.jsonl

用户选择停止 → 进入 Phase 6

**第 3 轮仍有 Critical** → 强制停止，建议回退到 Phase 3 重新规划。

### Phase 6: 最终验收

`[模式：评审]`

**Task 更新**：`currentPhase → "6-final"`, `nextAction → "最终验收"`

1. 对照计划检查完成情况
2. 运行测试验证功能
3. `git diff` 全量变更摘要
4. 输出结果：
   ```
   ✅ 协作开发完成
     变更: [N] 文件，[M] 行
     方案: [选定方案摘要]
     审查: [Critical: N, Warning: N, Info: N]
     📍 Next: /ccg commit 提交，或查看 .ccg/tasks/{task-name}/ 中的完整记录
   ```

#### Spec Evolution（归档前必须执行）

参考 `phase-guide.md § 8 Spec Evolution Protocol` 执行：
1. 分析本次 `git diff` + `review.md`，提炼可复用的编码约定和经验教训
2. 如有值得记录的经验 → 草拟 Spec 条目，展示给用户确认后追加到 `.ccg/spec/{domain}/index.md`
3. 无值得提炼的经验 → 跳过（不强行凑）

**Task 更新**：`status → "archived"`

**归档任务**：将 `.ccg/tasks/{task-name}/` 移动到 `.ccg/tasks/archive/YYYY-MM/{task-name}/`
```bash
mkdir -p .ccg/tasks/archive/$(date +%Y-%m) && mv .ccg/tasks/{task-name} .ccg/tasks/archive/$(date +%Y-%m)/
```

**自动提交归档**：
```bash
git add .ccg/tasks/ && git commit -m "chore: archive ccg task {task-name}"
```

```
📍 Next: /ccg:commit 提交产品代码
```

---

## 铁律

- **Phase 3 必须用户审批** — HARD STOP，不可自动跳过
- **Phase 2 双模型必须并行** — 不可串行调用
- **外部模型返回前不可提前进入下一阶段** — 等待是必须的
- **不可因为"任务简单"而跳过 [required] 阶段** — 每个阶段都有其价值
- **外部模型零文件写入权限** — 所有修改由 Claude 执行
- **评分 <7 或用户未审批时强制停止** — 不可绕过
