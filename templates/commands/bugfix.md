---
description: 质量门控修复（双模型交叉验证，90%+ 通过）
---

## 用法
`/bugfix <bug描述>`

## 上下文
- Bug 描述: $ARGUMENTS
- 使用双模型交叉验证确保修复质量
- 质量门控：90%+ 评分才能通过，最多 3 轮迭代

## 流程

### Phase 1: Bug 分析
1. 调用 `mcp__ace-tool__search_context` 检索相关代码:
   - `project_root_path`: 项目根目录绝对路径
   - `query`: Bug 的自然语言描述
2. 分析 bug 类型：前端/后端/全栈
3. 收集复现步骤、错误日志、预期行为

### Phase 2: 双模型诊断
**并行调用**（`run_in_background: true`）:

**调用方式**: 使用 `Bash` 工具调用 `codeagent-wrapper`

```bash
# Codex 后端诊断修复
codeagent-wrapper --backend {{BACKEND_PRIMARY}} - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/{{BACKEND_PRIMARY}}/architect.md

<TASK>
Bug 修复: {{Bug 描述}}
Context: {{从 ace-tool 获取的相关代码}}
</TASK>

OUTPUT: Unified Diff Patch for the fix.
EOF
```

```bash
# Gemini 前端诊断修复
codeagent-wrapper --backend {{FRONTEND_PRIMARY}} - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/{{FRONTEND_PRIMARY}}/frontend.md

<TASK>
Bug 修复: {{Bug 描述}}
Context: {{从 ace-tool 获取的相关代码}}
</TASK>

OUTPUT: Unified Diff Patch for the fix.
EOF
```

- **Codex** + `architect` 角色 → 后端分析
- **Gemini** + `frontend` 角色 → 前端分析

### Phase 3: 修复整合
1. 收集双模型的修复方案（`TaskOutput`）
2. 综合分析：识别共同点、合并互补修复、选择最优方案
3. Claude 重构为生产级代码

### Phase 4: 实施修复
应用修复代码，记录变更内容

### Phase 5: 质量门控验证
**并行调用** Codex + Gemini + `reviewer` 角色验证

**调用方式**: 使用 `Bash` 工具调用 `codeagent-wrapper`

```bash
# Codex 审查修复
codeagent-wrapper --backend {{BACKEND_PRIMARY}} - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/{{BACKEND_PRIMARY}}/reviewer.md

<TASK>
审查修复: {{实施的修复代码}}
评分标准: 正确性、安全性、性能、可维护性
</TASK>

OUTPUT: Review with score (0-100%) and specific feedback.
EOF
```

```bash
# Gemini 审查修复
codeagent-wrapper --backend {{FRONTEND_PRIMARY}} - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/{{FRONTEND_PRIMARY}}/reviewer.md

<TASK>
审查修复: {{实施的修复代码}}
评分标准: 正确性、用户体验、可访问性、设计一致性
</TASK>

OUTPUT: Review with score (0-100%) and specific feedback.
EOF
```

### Phase 6: 质量门控决策
```
综合评分 = (Codex 评分 + Gemini 评分) / 2
```

| 综合评分 | 结果 | 动作 |
|----------|------|------|
| ≥ 90% | ✅ PASS | 完成修复，可提交 |
| 70-89% | ⚠️ ITERATE | 返回 Phase 3，携带反馈 |
| 3轮后 < 90% | ❌ FAIL | 需人工介入 |

## 关键原则
1. **双模型交叉验证** - 避免单一视角的盲区
2. **量化质量评估** - 使用评分制而非主观判断
3. **迭代改进** - 每轮携带具体反馈
4. **止损机制** - 最多 3 轮，防止无限循环
