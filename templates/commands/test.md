---
description: 多模型测试生成（Codex 后端测试 + Gemini 前端测试）
---

## 用法
`/test <测试目标>`

## 上下文
- 测试目标: $ARGUMENTS
- Codex 生成后端测试，Gemini 生成前端测试

## 流程

### Phase 1: 测试分析
1. 调用 `mcp__ace-tool__search_context` 检索:
   - `project_root_path`: 项目根目录绝对路径
   - `query`: 需要测试的代码/功能描述
   - 目标代码的完整实现
   - 现有测试文件和测试框架
   - 项目测试配置（jest.config, pytest.ini 等）
2. 识别代码类型：前端组件 / 后端逻辑 / 全栈
3. 评估当前测试覆盖率和缺口

### Phase 2: 智能路由测试生成
| 代码类型 | 路由 | 角色 |
|---------|------|------|
| 后端 | Codex | `tester` |
| 前端 | Gemini | `tester` |
| 全栈 | 并行执行 | 两者 |

**调用方式**: 使用 `Bash` 工具调用 `codeagent-wrapper`

```bash
# Codex 后端测试生成
codeagent-wrapper --backend {{BACKEND_PRIMARY}} - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/{{BACKEND_PRIMARY}}/tester.md

<TASK>
生成测试: {{需要测试的代码}}
Context: {{现有测试和测试框架配置}}
</TASK>

OUTPUT: Unified Diff Patch for test files ONLY.
EOF
```

```bash
# Gemini 前端测试生成
codeagent-wrapper --backend {{FRONTEND_PRIMARY}} - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/{{FRONTEND_PRIMARY}}/tester.md

<TASK>
生成测试: {{需要测试的代码}}
Context: {{现有测试和测试框架配置}}
</TASK>

OUTPUT: Unified Diff Patch for test files ONLY.
EOF
```

根据代码类型选择调用对应模型，全栈代码则并行调用（`run_in_background: true`）。

### Phase 3: 测试整合
1. 收集模型输出（`TaskOutput`）
2. Claude 重构：统一风格、确保命名一致、优化结构、移除冗余

### Phase 4: 测试验证
1. 运行生成的测试
2. 检查通过率
3. 如有失败，分析原因并修复

## 测试策略金字塔
```
    /\      E2E (10%)
   /--\     Integration (20%)
  /----\    Unit (70%)
```

## 关键原则
1. **测试行为，不测试实现** - 关注输入输出
2. **智能路由** - 后端测试用 Codex，前端测试用 Gemini
3. **复用现有模式** - 遵循项目已有的测试风格
4. **覆盖优先级** - 先覆盖关键路径和高风险代码
