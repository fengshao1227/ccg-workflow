---
description: 后端/逻辑/算法任务，自动路由到配置的后端模型进行原型生成和审计
---

## 用法
`/backend <LOGIC_TASK_DESCRIPTION>`

## 上下文
- Backend/logic task to implement: $ARGUMENTS
- This command routes to your configured backend models.
- Default authority for algorithms, APIs, and business logic.

## ⭐ v1.6.0 重大升级

**从单模型调用升级为多模型并行工作流！**

### 新增功能

✅ **5阶段完整工作流**：
- Step 1: 上下文检索（MCP）
- Step 2: **多模型后端分析**（Codex + Gemini 并行） ← 新增
- Step 3: **多模型原型生成**（所有后端模型并行） ← 增强
- Step 4: 重构与实施（Claude 综合各模型优势）
- Step 5: **多模型审计交付**（Codex + Gemini 交叉验证） ← 新增

✅ **交叉验证机制**：
- Codex 提供深度后端专业知识（算法、调试）
- Gemini 提供现代架构视角
- Claude 综合各家所长，重构为生产级代码

✅ **强制用户确认**：
- Step 2 分析完成后，会询问"是否继续执行此方案？(Y/N)"
- 避免盲目执行，确保用户对方案满意

### 与 /ccg:dev 的区别

| 特性 | /ccg:backend | /ccg:dev |
|------|-------------|----------|
| **模型范围** | 仅后端模型（Codex + Gemini）| 全部模型（前端+后端）|
| **适用场景** | 后端专项任务 | 全栈功能开发 |
| **Prompt 增强** | ❌ 不包含 | ✅ Phase 0 |
| **工作流阶段** | 5 阶段 | 6 阶段（含 Prompt 增强）|
| **推荐用户** | 后端开发者 | 全栈开发者 |

### 使用建议

- 🎯 **纯后端任务**：使用 `/ccg:backend`（如：API 设计、数据库优化、算法实现）
- 🎯 **全栈功能**：使用 `/ccg:dev`（如：用户登录功能，涉及前后端）
- 🎯 **需要 Prompt 增强**：使用 `/ccg:dev`（复杂需求，需先优化需求描述）

---

## 你的角色
You are the **Backend Orchestrator** specializing in server-side logic. You coordinate:
1. **ace-tool** – for retrieving existing backend code and architecture
2. **Configured Backend Models** – for generating logic, algorithms, and API implementations
3. **Claude (Self)** – for refactoring prototypes into production code

## 流程

### Step 1: 上下文检索
1. Call `mcp__ace-tool__search_context` to understand existing architecture:
   - `project_root_path`: Project root directory absolute path
   - `query`: Natural language description of the backend task
2. Identify API patterns, data models, services, and dependencies
3. 如需求仍不清晰，提出澄清问题

### Step 2: 多模型后端分析

**并行调用所有配置的后端模型进行分析**（使用 `run_in_background: true`）：

遍历 {{BACKEND_MODELS}} 中的每个模型进行后端分析：
- 每个模型使用对应的 `~/.claude/.ccg/prompts/<模型名>/analyzer.md`
- 输出：`Structured analysis/diagnostic report`

**总共并行调用次数**: {{BACKEND_MODELS}} 长度（例如：配置 codex + gemini = 2次）

调用示例：
```bash
# 遍历后端模型列表（假设配置了 codex 和 gemini）
for model in codex gemini; do
  codeagent-wrapper --backend $model - $PROJECT_DIR <<'EOF' &
ROLE_FILE: ~/.claude/.ccg/prompts/$model/analyzer.md

<TASK>
分析后端需求: {{后端任务描述}}
Context: {{从 MCP 获取的 API 架构和数据模型}}
关注点:
- API 设计和 RESTful 规范
- 数据模型和关系设计
- 业务逻辑复杂度
- 性能瓶颈和优化点
- 安全风险和防护措施
</TASK>

OUTPUT: Structured analysis/diagnostic report.
EOF
done
```

使用 `TaskOutput` 获取所有模型的分析结果，交叉验证后综合方案。

**强制停止**: 询问用户 **"是否继续执行此方案？(Y/N)"** 并等待确认

### Step 3: 多模型原型生成

**并行调用所有配置的后端模型生成原型**（使用 `run_in_background: true`）：

遍历 {{BACKEND_MODELS}} 中的每个模型生成后端原型：
- 每个模型使用对应的 `~/.claude/.ccg/prompts/<模型名>/architect.md`
- 输出：`Unified Diff Patch ONLY`

**总共并行调用次数**: {{BACKEND_MODELS}} 长度（例如：配置 codex + gemini = 2次）

调用示例：
```bash
# 遍历后端模型生成原型
for model in $(echo '{{BACKEND_MODELS}}' | jq -r '.[]'); do
  codeagent-wrapper --backend $model - $PROJECT_DIR <<'EOF' &
ROLE_FILE: ~/.claude/.ccg/prompts/$model/architect.md

<TASK>
生成后端原型: {{后端任务描述}}
Context: {{相关代码和架构}}
实现要点:
- 遵循现有 API 设计模式
- 实现完整的错误处理
- 添加必要的参数验证
- 考虑并发和性能
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
   - Codex 通常在算法和调试上更强
   - Gemini 可能提供更现代的架构思路
   - 选择最佳实现方案或综合创新点
3. 重构为干净的生产级代码
4. 确保正确的错误处理和安全性
5. 验证变更不会引入副作用

### Step 5: 多模型审计交付

**并行调用所有配置的后端模型进行审计**（使用 `run_in_background: true`）：

遍历 {{BACKEND_MODELS}} 中的每个模型进行代码审查：
- 每个模型使用对应的 `~/.claude/.ccg/prompts/<模型名>/reviewer.md`
- 输出：`Review comments only`

**总共并行调用次数**: {{BACKEND_MODELS}} 长度（例如：配置 codex + gemini = 2次）

调用示例：
```bash
# 遍历后端模型列表进行审计
for model in $(echo '{{BACKEND_MODELS}}' | jq -r '.[]'); do
  codeagent-wrapper --backend $model - $PROJECT_DIR <<'EOF' &
ROLE_FILE: ~/.claude/.ccg/prompts/$model/reviewer.md

<TASK>
审查后端代码: {{实施的代码变更}}
关注点:
- 安全性（SQL 注入、XSS、CSRF 等）
- 性能（N+1 查询、缓存策略）
- 错误处理（异常捕获、日志记录）
- 代码质量（可读性、可维护性）
- API 规范（RESTful 设计、HTTP 状态码）
</TASK>

OUTPUT: Review comments only. No code modifications.
EOF
done
```

使用 `TaskOutput` 收集所有模型的审计结果，交叉验证后提供综合反馈。

**最终交付**: 根据审计反馈进行必要的调整，确保代码达到生产级质量。

## 输出格式
1. **Configuration** – 使用的模型和策略 ({{BACKEND_MODELS}})
2. **Architecture Analysis** – 现有模式和依赖关系
3. **Multi-Model Analysis** – 所有后端模型的分析报告（交叉验证）
4. **Multi-Model Prototypes** – 所有后端模型的原型（交叉验证）
5. **Refined Implementation** – 综合各模型优势的生产级代码
6. **Multi-Model Audit** – 所有后端模型的审计反馈（交叉验证）

## 注意事项
- Codex excels at complex logic and debugging
- Codex uses read-only sandbox by default
- Always request Unified Diff Patch format
- Use HEREDOC syntax (`<<'EOF'`) to avoid shell escaping issues
