---
description: 多模型性能优化（Codex 后端优化 + Gemini 前端优化）
---

## 用法
`/optimize <优化目标>`

## 上下文
- 优化目标: $ARGUMENTS
- Codex 专注后端性能（数据库、算法、缓存）
- Gemini 专注前端性能（渲染、加载、交互）

## 流程

### Phase 1: 性能基线分析
1. 调用 `mcp__ace-tool__search_context` 检索目标代码:
   - `project_root_path`: 项目根目录绝对路径
   - `query`: 需要优化的目标代码描述
2. 识别性能关键路径
3. 收集现有指标（如有）：
   - 后端: 响应时间、查询耗时、内存占用
   - 前端: LCP、FID、CLS、Bundle Size

### Phase 2: 并行性能分析
**同时调用**（`run_in_background: true`）:

**调用方式**: 使用 `Bash` 工具调用 `codeagent-wrapper`

```bash
# Codex 后端性能分析
codeagent-wrapper --backend {{BACKEND_PRIMARY}} - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/{{BACKEND_PRIMARY}}/optimizer.md

<TASK>
性能优化: {{优化目标}}
Context: {{从 ace-tool 获取的相关代码和性能指标}}
</TASK>

OUTPUT: Analysis report + Unified Diff Patch for optimizations.
EOF
```

```bash
# Gemini 前端性能分析
codeagent-wrapper --backend {{FRONTEND_PRIMARY}} - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/{{FRONTEND_PRIMARY}}/optimizer.md

<TASK>
性能优化: {{优化目标}}
Context: {{从 ace-tool 获取的相关代码和性能指标}}
</TASK>

OUTPUT: Analysis report + Unified Diff Patch for optimizations.
EOF
```

- **Codex** + `optimizer` 角色 → 后端性能分析
- **Gemini** + `optimizer` 角色 → 前端性能分析

### Phase 3: 优化整合
1. 收集双模型分析（`TaskOutput`）
2. **优先级排序**：按影响程度 × 实施难度 计算性价比
3. Claude 重构优化代码

### Phase 4: 实施优化
1. 按优先级实施
2. 确保不破坏现有功能
3. 添加必要的性能监控

### Phase 5: 验证
1. 运行性能测试（如有）
2. 对比优化前后指标
3. 双模型审查优化效果

## 性能指标参考

### 后端
| 指标 | 良好 | 需优化 | 严重 |
|------|------|--------|------|
| API 响应 | <100ms | 100-500ms | >500ms |
| 数据库查询 | <50ms | 50-200ms | >200ms |

### 前端 (Core Web Vitals)
| 指标 | 良好 | 需改进 | 差 |
|------|------|--------|-----|
| LCP | <2.5s | 2.5-4s | >4s |
| FID | <100ms | 100-300ms | >300ms |
| CLS | <0.1 | 0.1-0.25 | >0.25 |

## 常见优化模式
**后端**: N+1 查询→批量加载、缺少索引→复合索引、重复计算→缓存、同步阻塞→异步
**前端**: 大 Bundle→代码分割、频繁重渲染→memo、大列表→虚拟滚动、未优化图片→WebP/懒加载

## 关键原则
1. **先测量后优化** - 没有数据不盲目优化
2. **性价比优先** - 高影响 + 低难度优先
3. **不破坏功能** - 优化不能引入 bug
4. **可观测性** - 添加监控便于持续优化
