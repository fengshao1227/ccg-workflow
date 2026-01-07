---
description: 三模型代码生成（Codex + Gemini + Claude 并行原型，集各家所长）
---

## 用法
`/code <功能描述>`

## 上下文
- 功能描述: $ARGUMENTS
- **三模型并行生成原型**，编排者集各家所长
- 生成的原型经 Claude (编排者) 重构为生产级代码

## 工作流程

### Phase 1: 需求分析

1. 调用 `mcp__ace-tool__search_context` 检索:
   - `project_root_path`: 项目根目录绝对路径
   - `query`: 功能需求的自然语言描述
   - 相关模块和文件结构
   - 现有代码模式和风格
   - 依赖和接口定义
2. 分析任务类型：
   - **前端**: UI 组件、样式、用户交互
   - **后端**: API、业务逻辑、数据库操作
   - **全栈**: 同时涉及前后端

### Phase 2: 三模型并行原型生成

**同时调用三个模型**（`run_in_background: true`）：

**调用方式**: 使用 `Bash` 工具调用 `codeagent-wrapper`

```bash
# Codex 后端架构原型
codeagent-wrapper --backend {{BACKEND_PRIMARY}} - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/{{BACKEND_PRIMARY}}/architect.md

<TASK>
生成原型: {{功能需求}}
Context: {{从 ace-tool 获取的相关代码}}
</TASK>

OUTPUT: Unified Diff Patch ONLY. Strictly prohibit any actual modifications.
EOF
```

```bash
# Gemini 前端 UI 原型
codeagent-wrapper --backend {{FRONTEND_PRIMARY}} - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/{{FRONTEND_PRIMARY}}/frontend.md

<TASK>
生成原型: {{功能需求}}
Context: {{从 ace-tool 获取的相关代码}}
</TASK>

OUTPUT: Unified Diff Patch ONLY. Strictly prohibit any actual modifications.
EOF
```

```bash
# Claude 全栈整合原型
codeagent-wrapper --backend claude - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/claude/architect.md

<TASK>
生成原型: {{功能需求}}
Context: {{从 ace-tool 获取的相关代码}}
</TASK>

OUTPUT: Unified Diff Patch ONLY. Strictly prohibit any actual modifications.
EOF
```

1. **Codex** + `architect` 角色 → 后端架构视角
2. **Gemini** + `frontend` 角色 → 前端 UI 视角
3. **Claude** + `architect` 角色 → 全栈整合视角

**三模型差异化价值**：
| 模型 | 专注点 | 独特贡献 |
|------|--------|----------|
| Codex | 后端逻辑、算法、API | 深度后端专业知识 |
| Gemini | 前端 UI、样式、交互 | 视觉设计和用户体验 |
| Claude | 全栈整合、契约设计 | 桥接前后端视角 |

定义清晰的接口契约：
```
API Contract:
- Endpoint: POST /api/xxx
- Request: { field1: string, field2: number }
- Response: { data: T, error?: string }
```

### Phase 3: 原型整合

1. 收集三个模型输出（使用 `TaskOutput`）
2. 将 Unified Diff 视为"脏原型"
3. **交叉验证，集各家所长**：
   - Codex 的后端逻辑和 API 设计
   - Gemini 的前端组件和 UI 交互
   - Claude 的整合视角和契约一致性
4. Claude (编排者) 重构：
   - 统一代码风格
   - 确保前后端接口一致
   - 优化实现细节
   - 移除冗余代码

### Phase 4: 代码实施

1. 应用重构后的代码
2. 确保不破坏现有功能
3. 验证编译/类型检查通过

### Phase 5: 三模型审查

**并行启动审查**（`run_in_background: true`）：

**调用方式**: 使用 `Bash` 工具调用 `codeagent-wrapper`

```bash
# Codex 安全性审查
codeagent-wrapper --backend {{BACKEND_PRIMARY}} - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/{{BACKEND_PRIMARY}}/reviewer.md

<TASK>
审查代码: {{实施的代码变更}}
关注点: 安全性、性能、错误处理
</TASK>

OUTPUT: Review comments with specific line references.
EOF
```

```bash
# Gemini 设计审查
codeagent-wrapper --backend {{FRONTEND_PRIMARY}} - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/{{FRONTEND_PRIMARY}}/reviewer.md

<TASK>
审查代码: {{实施的代码变更}}
关注点: 可访问性、响应式设计、设计一致性
</TASK>

OUTPUT: Review comments with specific line references.
EOF
```

```bash
# Claude 集成审查
codeagent-wrapper --backend claude - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/claude/reviewer.md

<TASK>
审查代码: {{实施的代码变更}}
关注点: 集成正确性、契约一致性
</TASK>

OUTPUT: Review comments with specific line references.
EOF
```

- **Codex** + `reviewer` 角色 → 安全性、性能、错误处理
- **Gemini** + `reviewer` 角色 → 可访问性、响应式、设计一致性
- **Claude** + `reviewer` 角色 → 集成正确性、契约一致性

### Phase 6: 修正与交付

1. 综合三模型审查意见
2. 修正发现的问题
3. 最终交付

## 输出格式

```
## 🚀 Code: <功能描述>

### Phase 1: 需求分析
- 任务类型: [前端/后端/全栈]
- 相关文件: <文件列表>
- 现有模式: <识别的模式>

### Phase 2: 代码生成
#### Codex 原型 (后端视角)
<Unified Diff 摘要>

#### Gemini 原型 (前端视角)
<Unified Diff 摘要>

#### Claude 原型 (全栈视角)
<Unified Diff 摘要>

### Phase 3: 整合重构
<重构说明>

### Phase 4: 实施
<变更文件列表>

### Phase 5: 审查
#### Codex 审查 (安全/性能)
- <审查意见 1>
- <审查意见 2>

#### Gemini 审查 (可访问性/设计)
- <审查意见 1>
- <审查意见 2>

#### Claude 审查 (集成/契约)
- <审查意见 1>
- <审查意见 2>

### Phase 6: 交付
✅ 实施完成
- 新增文件: X
- 修改文件: Y
- 代码行数: +N / -M
```

## 任务类型检测

| 关键词 | 类型 | 路由 |
|--------|------|------|
| component, UI, style, CSS, React, Vue | 前端 | Gemini |
| API, endpoint, database, auth, backend | 后端 | Codex |
| full-stack, 全栈, 页面+接口 | 全栈 | 并行 |

## 代码质量标准

### 前端代码 (Gemini 专注)
- [ ] TypeScript 类型完整
- [ ] 响应式设计
- [ ] 无障碍属性
- [ ] 加载/错误状态
- [ ] 遵循设计系统

### 后端代码 (Codex 专注)
- [ ] 输入验证
- [ ] 错误处理
- [ ] 安全检查
- [ ] 查询优化
- [ ] API 一致性

### 全栈整合 (Claude 专注)
- [ ] 前后端接口一致
- [ ] 类型定义共享
- [ ] 错误码统一
- [ ] 契约文档完整

## 关键原则

1. **三模型并行** - 同时获取三个视角的原型
2. **集各家所长** - 交叉验证，取最优方案
3. **接口优先** - 先定义 API 契约
4. **编排者重构** - 原型需要 Claude (编排者) 整合
5. **三重审查** - 代码必须经过三模型审查
