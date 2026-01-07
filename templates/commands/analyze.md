---
description: 多模型技术分析（并行执行），交叉验证后综合见解
---

## 用法
`/analyze <QUESTION_OR_TASK>`

## 上下文
- Question or analysis task: $ARGUMENTS
- This command triggers multi-model analysis without code changes.
- Configured models provide perspectives for cross-validation.

## 你的角色
You are the **Analysis Coordinator** orchestrating multi-model research. You direct:
1. **ace-tool** – for codebase context retrieval
2. **Configured Models** – for comprehensive multi-perspective analysis
3. **Claude (Self)** – for synthesizing insights

## 流程

### Step 1: 上下文检索

1. Call `mcp__ace-tool__search_context` to understand relevant code:
   - `project_root_path`: Project root directory absolute path
   - `query`: Natural language description of what to analyze
5. Identify key files, patterns, and architecture

### Step 2: 并行分析

**并行调用所有配置的分析模型**（使用 `run_in_background: true`）：

遍历后端模型 {{BACKEND_MODELS}} 和前端模型 {{FRONTEND_MODELS}}（合并去重）：

```bash
# 合并并去重后端和前端模型列表
BACKEND='{{BACKEND_MODELS}}'
FRONTEND='{{FRONTEND_MODELS}}'
ALL_MODELS=$(echo "$BACKEND $FRONTEND" | jq -s 'add | unique' | jq -r '.[]')

# 遍历所有分析模型
for model in $ALL_MODELS; do
  codeagent-wrapper --backend $model - $PROJECT_DIR <<'EOF' &
ROLE_FILE: ~/.claude/.ccg/prompts/$model/analyzer.md

<TASK>
分析任务: {{分析问题或任务}}
Context: {{从 MCP 获取的相关代码}}
</TASK>

OUTPUT: Detailed analysis with recommendations.
EOF
done
wait  # 等待所有后台任务完成
```

### Step 3: 交叉验证
使用 `TaskOutput` 获取所有任务的结果，然后：
1. Compare perspectives from all configured models
2. Identify agreements and disagreements
3. Evaluate trade-offs objectively
4. Weight opinions based on model strengths

### Step 4: 综合输出
Present unified analysis combining all perspectives.

## 输出格式
1. **Configuration** – models used for analysis
2. **Context Overview** – relevant codebase elements
3. **Model Perspectives** – analysis from each configured model
4. **Synthesis** – combined insights and trade-offs
5. **Recommendations** – actionable next steps

## 注意事项
- This command is for analysis only, no code changes
- **Use `run_in_background: true` for parallel execution** to avoid blocking
- 多模型结果交叉验证，取长补短
- Use HEREDOC syntax (`<<'EOF'`) to avoid shell escaping issues
