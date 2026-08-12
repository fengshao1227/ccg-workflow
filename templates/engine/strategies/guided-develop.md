# Strategy: Guided Develop — 引导式开发

> 适用于中等复杂度的功能开发。可选调用外部模型进行领域分析。

## 适用条件
- 复杂度 M（2-5 文件，单模块）
- 需要一定规划但不需要完整的多模型协作
- 风险 low 或 medium

---

## 工作流状态机

[phase-state:1-requirements]
当前阶段：需求增强
📍 Next: 需求结构化后进入上下文检索
[/phase-state:1-requirements]

[phase-state:2-context]
当前阶段：上下文检索
Gate: 需求已增强 ✓
📍 Next: 上下文收集完毕后判断是否需要外部模型分析
[/phase-state:2-context]

[phase-state:3-analysis]
当前阶段：领域分析（可选外部模型）
Gate: 上下文已收集 ✓
📍 Next: 分析完成后进入规划阶段
[/phase-state:3-analysis]

[phase-state:4-plan]
当前阶段：规划
Gate: 分析已完成 ✓
📍 Next: 用户确认计划后进入实施
[/phase-state:4-plan]

[phase-state:5-implement]
当前阶段：实施
Gate: 用户已确认计划 ✓（HARD STOP）
📍 Next: 实施完成后进入验证
[/phase-state:5-implement]

[phase-state:6-verify]
当前阶段：验证
Gate: 实施已完成 ✓
📍 Next: 验证通过后报告结果
[/phase-state:6-verify]

---

## 阶段详情

### Phase 1: 需求增强 [required]

分析用户的 $ARGUMENTS，补全为结构化需求：
- **目标**：要实现什么
- **约束**：不能改什么、需要兼容什么
- **范围**：哪些文件/模块会受影响
- **验收标准**：怎样算完成

展示增强后的需求，用户确认或调整。

### Phase 2: 上下文检索 [required]

1. 用 MCP 搜索工具搜索相关代码
2. 读取目标模块的核心文件
3. 识别依赖关系和可能的影响范围
4. 了解现有的测试覆盖情况

### Phase 3: 多模型分析 [required]

**Gate check**: 需求已增强 ✓ 上下文已收集 ✓

**⛔ M 复杂度必须调用双模型（{{FRONTEND_PRIMARY}} + {{BACKEND_PRIMARY}}）并行分析。不可只调一个，不可跳过。**

这是多模型协作的核心价值——两个模型从不同角度分析同一个问题，交叉验证，弥补单模型盲区。

执行步骤：

1. 确定工作目录：`WORKDIR=$(pwd)`

2. **并行调用双模型**（`run_in_background: true`，两个同时启动）：

Backend 模型：
```
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--progress --backend {{BACKEND_PRIMARY}} {{GEMINI_MODEL_FLAG}}{{GROK_MODEL_FLAG}}{{KIMI_MODEL_FLAG}}{{OPENCODE_MODEL_FLAG}}- \"$WORKDIR\" <<'CODEAGENT_EOF'\nROLE_FILE: ~/.claude/.ccg/prompts/{{BACKEND_PRIMARY}}/analyzer.md\n<TASK>\n需求：{增强后的需求}\n上下文：{Phase 2 收集的项目上下文、相关代码摘要}\n</TASK>\nOUTPUT: 技术分析报告（可行性、架构建议、风险评估、实施方案对比）\nCODEAGENT_EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "Backend 模型分析"
})
```

Frontend 模型（**必须同时启动，不是"如果是全栈才调"**）：
```
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--progress --backend {{FRONTEND_PRIMARY}} {{GEMINI_MODEL_FLAG}}{{GROK_MODEL_FLAG}}{{KIMI_MODEL_FLAG}}{{OPENCODE_MODEL_FLAG}}- \"$WORKDIR\" <<'CODEAGENT_EOF'\nROLE_FILE: ~/.claude/.ccg/prompts/{{FRONTEND_PRIMARY}}/analyzer.md\n<TASK>\n需求：{增强后的需求}\n上下文：{Phase 2 收集的项目上下文}\n</TASK>\nOUTPUT: 从不同视角的分析报告（可行性、设计建议、风险评估）\nCODEAGENT_EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "Frontend 模型分析"
})
```

4. **等待结果**（必须等，不可跳过）：
```
TaskOutput({ task_id: "<id>", block: true, timeout: 600000 })
```

5. 综合模型分析结果，提取关键建议用于 Phase 4 规划

**Task 更新**：`currentPhase → "3-analysis"`, `nextAction → "等待模型分析返回"`

### Phase 4: 规划 [required]

撰写实施计划，输出格式：

```
📋 实施计划

## 需求
[增强后的需求摘要]

## 方案
[选定方案及理由]

## 步骤
1. [文件路径] — [具体变更]
2. [文件路径] — [具体变更]
...

## 影响范围
- 修改: [文件列表]
- 新增: [文件列表]（如有）
- 测试: [需要更新/新增的测试]
```

将计划持久化到 `.ccg/tasks/{task-name}/plan.md`。

**Task 更新**：
```
更新 .ccg/tasks/{task-name}/task.json:
  currentPhase → "4-plan"
  gate → "user_approval_required"
  nextAction → "等待用户审批计划"
```

**⛔⛔⛔ HARD STOP — 你必须在这里停下来，向用户展示以下选项并等待回复。不可跳过，不可默认选择。⛔⛔⛔**

你现在必须输出以下内容（原样输出，不是代码块示例）：

---
⛔ **计划审批 + 执行模式选择**

请审批以上计划，并选择谁来写代码：
1. **Claude 自己写** — 精细控制，逐步实施
2. **外部模型写**（{{BACKEND_PRIMARY}}）— 更快、省 Claude 额度，Claude 监控审查

请回复 1 或 2（或直接点名模型，如"用codex"/"用grok"/"用kimi" — 点名时用该模型替换默认 backend）。
---

**在用户回复之前，你不可以执行任何文件写入操作。** 违反 = 流程失控。

用户确认后：
```
更新 task.json: gate → null, currentPhase → "5-implement"
```

### Phase 5: 实施

根据用户选择的执行模式：

#### 模式 A: Claude 自己写（用户选 [1]）

1. 严格按计划执行
2. 遵循项目现有代码规范
3. 每完成一个主要步骤，简要报告进度
4. 遇到计划外的问题时告知用户，不自行扩大范围

#### 模式 B: 外部模型实施（用户选 [2]）

Claude 作为编排者，调用外部模型写代码。默认用 `{{BACKEND_PRIMARY}}`；用户点名了其他模型（codex / grok / kimi / antigravity）则将下方调用中的 `--backend` 和 ROLE_FILE 路径替换为该模型。

**Step 1**: 从 plan.md 按文件归属拆分子任务：
- **Layer 1** — 无依赖的任务（底层模块：model/util/store）
- **Layer 2** — 依赖 Layer 1 的任务（上层：route/middleware/component）
- 每个子任务标注：文件范围、实施步骤、验证命令

**Step 2**: 生成并行任务配置，调用 codeagent-wrapper `--parallel` 模式：

```
Bash({
  command: "~/.claude/bin/codeagent-wrapper {{LITE_MODE_FLAG}}--progress --parallel --backend {{BACKEND_PRIMARY}} {{GEMINI_MODEL_FLAG}}{{GROK_MODEL_FLAG}}{{KIMI_MODEL_FLAG}}{{OPENCODE_MODEL_FLAG}}- \"$WORKDIR\" <<'PARALLEL_EOF'\n---TASK---\nid: layer1-{name1}\nworkdir: $WORKDIR\n---CONTENT---\nROLE_FILE: ~/.claude/.ccg/prompts/{{BACKEND_PRIMARY}}/builder.md\n<TASK>\n## 文件范围（⛔ 只改这些文件）\n{file1, file2}\n\n## 实施步骤\n{steps from plan.md}\n</TASK>\n---TASK---\nid: layer1-{name2}\nworkdir: $WORKDIR\n---CONTENT---\nROLE_FILE: ~/.claude/.ccg/prompts/{{BACKEND_PRIMARY}}/builder.md\n<TASK>\n## 文件范围\n{file3, file4}\n\n## 实施步骤\n{steps}\n</TASK>\n---TASK---\nid: layer2-{name3}\nworkdir: $WORKDIR\ndependencies: layer1-{name1},layer1-{name2}\n---CONTENT---\nROLE_FILE: ~/.claude/.ccg/prompts/{{BACKEND_PRIMARY}}/builder.md\n<TASK>\n## 文件范围\n{file5}\n\n## 实施步骤\n{steps}\n</TASK>\nPARALLEL_EOF",
  run_in_background: true,
  timeout: 3600000,
  description: "Parallel Builder: {task count} 个子任务"
})
```

**也可以用 Codex 原生 spawn 模式**（如果项目 `.codex/` 已配置 multi_agent_v2）：
- 发送编排指令让 Codex 读 AGENTS.md 的 §5 "Parallel Spawn" 模式
- Codex 自行 spawn ccg-implement 子代理并行写

**Step 3**: 等待完成，读取汇总报告

**Step 4**: Claude 审查 `git diff`，确认变更在 plan 范围内
- 小问题 Claude 直接修复
- 大问题再调外部模型或切换模式 A

**降级**：外部模型失败/超时 → 切换到模式 A

**Task 更新**：`currentPhase → "5-implement"`, `nextAction → "按计划执行实施"`

### Phase 6: 迭代审查 [Ralph Loop]

1. `git diff` 展示所有变更
2. 运行测试（如果有）

参考 `phase-guide.md § 10 Ralph Loop` 执行迭代审查（变更 >30 行时，最多 3 轮）。

#### Round N 流程

**⛔ 双模型交叉审查（每轮 spawn 新调用，干净上下文）：**
3. 并行调用双模型（`run_in_background: true`，使用 model-router.md 模板）：
   - backend 模型 + reviewer 角色 — 安全、性能、错误处理
   - frontend 模型 + reviewer 角色 — 设计一致性（如涉及前端）
4. 综合审查意见

**⛔ 质量关卡（必须逐个调用 Skill，不可跳过）：**
5. 调用 Skill `verify-quality` — 等待报告
6. 调用 Skill `verify-security` — 等待报告（涉及 auth/input/crypto 时）
7. 调用 Skill `verify-change` — 等待报告

**用户决定（⛔ 必须等待）：**
- 有 Critical → `发现 N 个 Critical 问题。修复后再审一轮？[Y/n]`
- 无 Critical → `审查通过。需要再审一轮？[y/N]`
- 用户选择继续 → 修复 Critical 后回到 Round N+1
- 用户选择停止 → 退出审查循环

追加进度到 `.ccg/tasks/{task-name}/fix-log.jsonl`。

8. 检查是否满足验收标准
9. 输出结果：
   ```
   ✅ 开发完成
     变更: [N] 文件，[M] 行
     实现: [摘要]
     测试: [通过/跳过/失败情况]
     审查: [N] 轮，[Critical: N, Warning: N, Info: N]
     📍 Next: 可以用 /ccg:commit 提交
   ```

#### Spec Evolution（归档前必须执行）

参考 `phase-guide.md § 8 Spec Evolution Protocol` 执行：
1. 分析本次 `git diff` + 审查结果，提炼可复用的编码约定
2. 如有值得记录的经验 → 草拟 Spec 条目，展示给用户确认后追加到 `.ccg/spec/{domain}/index.md`
3. 无值得提炼的经验 → 跳过

**Task 更新**：`status → "archived"`

**归档任务**：
```bash
mkdir -p .ccg/tasks/archive/$(date +%Y-%m) && mv .ccg/tasks/{task-name} .ccg/tasks/archive/$(date +%Y-%m)/
git add .ccg/tasks/ && git commit -m "chore: archive ccg task"
```

---

## 升级规则

- 发现涉及 5+ 文件或需要跨模块协调 → 升级到 `full-collaborate`
- 发现涉及架构级变更 → 升级到 `full-collaborate`
- 外部模型分析发现重大风险 → 升级到 `full-collaborate`

---

## 铁律

- **Phase 4 计划必须用户确认** — HARD STOP，不可自动跳过
- **外部模型仅提供建议** — Claude 执行所有文件修改
- **不扩大范围** — 只做计划内的变更，计划外的报告但不自行处理
- **增量实施** — 多文件变更时逐文件执行，便于追踪
