---
description: UltraThink 深度分析（双模型并行分析 + 综合见解）
---

## 用法
`/think <分析主题>`

## 上下文
- 分析主题: $ARGUMENTS
- 使用双模型进行多角度深度分析
- 适用于复杂架构决策、技术选型、问题探索

## 流程

### Phase 1: 上下文收集
1. 调用 `mcp__ace-tool__search_context` 检索相关代码:
   - `project_root_path`: 项目根目录绝对路径
   - `query`: 需要深度分析的问题描述
2. 识别分析范围和关键组件
3. 列出已知约束和假设

### Phase 2: 并行深度分析
**同时调用**（`run_in_background: true`）:

**调用方式**: 使用 `Bash` 工具调用 `codeagent-wrapper`

```bash
# Codex 后端/系统视角分析
codeagent-wrapper --backend {{BACKEND_PRIMARY}} - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/{{BACKEND_PRIMARY}}/analyzer.md

<TASK>
深度分析: {{问题或场景}}
Context: {{从 ace-tool 获取的相关代码}}
</TASK>

OUTPUT: Structured analysis report with clear reasoning.
EOF
```

```bash
# Gemini 前端/用户视角分析
codeagent-wrapper --backend {{FRONTEND_PRIMARY}} - $PROJECT_DIR <<'EOF'
ROLE_FILE: ~/.claude/.ccg/prompts/{{FRONTEND_PRIMARY}}/analyzer.md

<TASK>
深度分析: {{问题或场景}}
Context: {{从 ace-tool 获取的相关代码}}
</TASK>

OUTPUT: Structured analysis report with clear reasoning.
EOF
```

- **Codex** + `analyzer` 角色 → 后端/系统视角
- **Gemini** + `analyzer` 角色 → 前端/用户视角

### Phase 3: UltraThink 综合
1. 收集双模型分析报告（`TaskOutput`）
2. **交叉验证**：
   - 一致观点（强信号）
   - 分歧点（需要权衡）
   - 互补见解
3. **综合推理**：整合技术和用户视角，形成统一分析框架

### Phase 4: 输出结论
```
## 🧠 深度分析: <主题>

### 一致观点（强信号）
1. <双方都认同的点>

### 分歧点（需权衡）
| 议题 | Codex 观点 | Gemini 观点 | 建议 |
|------|------------|-------------|------|

### 核心结论
<1-2 句话总结>

### 推荐方案
**首选**: <方案>
- 理由 / 风险 / 缓解措施

### 行动计划
1. [ ] <短期>
2. [ ] <中期>
3. [ ] <长期>
```

## 适用场景
| 场景 | 示例 |
|------|------|
| 架构决策 | "评估微服务拆分方案" |
| 技术选型 | "比较 Redux vs Zustand" |
| 性能分析 | "分析页面加载慢的原因" |
| 重构评估 | "评估重构遗留模块的风险" |

## 关键原则
1. **不急于结论** - 充分收集和分析后再下结论
2. **多视角思考** - 技术 + 用户 + 业务
3. **量化权衡** - 尽可能用数据支撑判断
4. **可执行导向** - 分析结果要能指导行动
