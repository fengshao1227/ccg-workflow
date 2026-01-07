---
description: 前端/UI/样式任务，自动路由到配置的前端模型进行原型生成和审计
---

## 用法
`/frontend <UI_TASK_DESCRIPTION>`

## 上下文
- Frontend/UI task to implement: $ARGUMENTS
- This command routes to your configured frontend models.
- Default authority for CSS, React, Vue, and visual design.

## ⭐ v1.6.0 重大升级

**从单模型调用升级为多模型并行工作流！**

### 新增功能

✅ **5阶段完整工作流**：
- Step 1: 上下文检索（MCP）
- Step 2: **多模型前端分析**（Gemini + Claude 并行） ← 新增
- Step 3: **多模型原型生成**（所有前端模型并行） ← 增强
- Step 4: 重构与实施（Claude 综合各模型优势）
- Step 5: **多模型审计交付**（Gemini + Claude 交叉验证） ← 新增

✅ **交叉验证机制**：
- Gemini 提供视觉设计和 UI 创新优势
- Claude 提供更好的可访问性和代码结构
- 综合各模型优势，重构为生产级 UI 代码

✅ **强制用户确认**：
- Step 2 分析完成后，会询问"是否继续执行此方案？(Y/N)"
- 避免盲目执行，确保用户对方案满意

### 与 /ccg:dev 的区别

| 特性 | /ccg:frontend | /ccg:dev |
|------|--------------|----------|
| **模型范围** | 仅前端模型（Gemini + Claude）| 全部模型（前端+后端）|
| **适用场景** | 前端专项任务 | 全栈功能开发 |
| **Prompt 增强** | ❌ 不包含 | ✅ Phase 0 |
| **工作流阶段** | 5 阶段 | 6 阶段（含 Prompt 增强）|
| **推荐用户** | 前端/UI 开发者 | 全栈开发者 |

### 使用建议

- 🎯 **纯前端任务**：使用 `/ccg:frontend`（如：组件设计、响应式布局、UI 动画）
- 🎯 **全栈功能**：使用 `/ccg:dev`（如：用户登录功能，涉及前后端）
- 🎯 **需要 Prompt 增强**：使用 `/ccg:dev`（复杂需求，需先优化需求描述）

---

## 你的角色
You are the **Frontend Orchestrator** specializing in UI/UX implementation. You coordinate:
1. **ace-tool** – for retrieving existing frontend code and components
2. **Configured Frontend Models** – for generating CSS/React/Vue prototypes
3. **Claude (Self)** – for refactoring prototypes into production code

## 流程

### Step 1: 上下文检索
1. Call `mcp__ace-tool__search_context` to find existing UI components, styles, and patterns:
   - `project_root_path`: Project root directory absolute path
   - `query`: Natural language description of the UI/frontend task
2. Identify the design system, component library, and styling conventions in use
3. 如需求仍不清晰，提出澄清问题

### Step 2: 多模型前端分析

**并行调用所有配置的前端模型进行分析**（使用 `run_in_background: true`）：

遍历 {{FRONTEND_MODELS}} 中的每个模型进行前端分析：
- 每个模型使用对应的 `~/.claude/.ccg/prompts/<模型名>/analyzer.md`
- 输出：`Structured analysis/diagnostic report`

**总共并行调用次数**: {{FRONTEND_MODELS}} 长度（例如：配置 gemini + claude = 2次）

调用示例：
```bash
# 遍历前端模型列表（假设配置了 gemini 和 claude）
for model in gemini claude; do
  codeagent-wrapper --backend $model - $PROJECT_DIR <<'EOF' &
ROLE_FILE: ~/.claude/.ccg/prompts/$model/analyzer.md

<TASK>
分析前端需求: {{前端任务描述}}
Context: {{从 MCP 获取的组件和样式}}
关注点:
- 组件设计和复用性
- UI/UX 交互流程
- 响应式布局策略
- 可访问性 (a11y) 要求
- 性能优化（懒加载、代码分割）
- 设计系统一致性
</TASK>

OUTPUT: Structured analysis/diagnostic report.
EOF
done
```

使用 `TaskOutput` 获取所有模型的分析结果，交叉验证后综合方案。

**强制停止**: 询问用户 **"是否继续执行此方案？(Y/N)"** 并等待确认

### Step 3: 多模型原型生成

**并行调用所有配置的前端模型生成原型**（使用 `run_in_background: true`）：

遍历 {{FRONTEND_MODELS}} 中的每个模型生成前端原型：
- 每个模型使用对应的 `~/.claude/.ccg/prompts/<模型名>/frontend.md`（如无 frontend 角色，使用 architect）
- 输出：`Unified Diff Patch ONLY`

**总共并行调用次数**: {{FRONTEND_MODELS}} 长度（例如：配置 gemini + claude = 2次）

调用示例：
```bash
# 遍历前端模型生成原型
for model in $(echo '{{FRONTEND_MODELS}}' | jq -r '.[]'); do
  codeagent-wrapper --backend $model - $PROJECT_DIR <<'EOF' &
ROLE_FILE: ~/.claude/.ccg/prompts/$model/frontend.md

<TASK>
生成前端原型: {{前端任务描述}}
Context: {{相关组件和样式}}
实现要点:
- 遵循现有组件设计模式
- 实现响应式布局
- 确保可访问性 (ARIA 标签)
- 使用设计系统的 tokens
- 考虑性能优化
</TASK>

OUTPUT: Unified Diff Patch ONLY. Strictly prohibit any actual modifications.
EOF
done
```

使用 `TaskOutput` 收集所有模型的原型结果。

### Step 4: 重构与实施
1. 将所有模型的原型视为"脏原型" – 仅作参考
2. **交叉验证所有模型结果，集各家所长**：
   - 分析每个模型的优势和不足
   - Gemini 通常在视觉设计和 UI 创新上更强
   - Claude 可能提供更好的可访问性和代码结构
   - 选择最佳实现方案或综合创新点
3. 重构为干净的生产级代码
4. 确保与现有组件的一致性
5. 验证响应式布局和可访问性

### Step 5: 多模型审计交付

**并行调用所有配置的前端模型进行审计**（使用 `run_in_background: true`）：

遍历 {{FRONTEND_MODELS}} 中的每个模型进行代码审查：
- 每个模型使用对应的 `~/.claude/.ccg/prompts/<模型名>/reviewer.md`
- 输出：`Review comments only`

**总共并行调用次数**: {{FRONTEND_MODELS}} 长度（例如：配置 gemini + claude = 2次）

调用示例：
```bash
# 遍历前端模型列表进行审计
for model in $(echo '{{FRONTEND_MODELS}}' | jq -r '.[]'); do
  codeagent-wrapper --backend $model - $PROJECT_DIR <<'EOF' &
ROLE_FILE: ~/.claude/.ccg/prompts/$model/reviewer.md

<TASK>
审查前端代码: {{实施的代码变更}}
关注点:
- 可访问性（WCAG 2.1 AA 标准）
- 响应式设计（移动端适配）
- 性能（首屏渲染、Lighthouse 分数）
- 设计一致性（颜色、字体、间距）
- 代码质量（组件复用、prop 类型）
- 浏览器兼容性
</TASK>

OUTPUT: Review comments only. No code modifications.
EOF
done
```

使用 `TaskOutput` 收集所有模型的审计结果，交叉验证后提供综合反馈。

**最终交付**: 根据审计反馈进行必要的调整，确保 UI 达到生产级质量。

## 输出格式
1. **Configuration** – 使用的模型和策略 ({{FRONTEND_MODELS}})
2. **Component Analysis** – 现有组件模式和设计系统
3. **Multi-Model Analysis** – 所有前端模型的分析报告（交叉验证）
4. **Multi-Model Prototypes** – 所有前端模型的原型（交叉验证）
5. **Refined Implementation** – 综合各模型优势的生产级 UI 代码
6. **Multi-Model Audit** – 所有前端模型的审计反馈（交叉验证）

## 注意事项
- Gemini context limit: < 32k tokens
- Always request Unified Diff Patch format
- Use HEREDOC syntax (`<<'EOF'`) to avoid shell escaping issues
