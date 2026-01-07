---
description: 多模型代码审查（并行执行），无参数时自动审查 git diff
---

## 用法
`/review [CODE_OR_DESCRIPTION]`

## 上下文
- Arguments: $ARGUMENTS
- This command triggers multi-model code review based on your configuration.
- Configured models review simultaneously for comprehensive feedback.

## 行为
- **No arguments**: Automatically review current git changes (staged + unstaged)
- **With arguments**: Review specified code or description

## 你的角色
You are the **Code Review Coordinator** orchestrating multi-model review. You direct:
1. **ace-tool** – for retrieving code context
2. **Configured Review Models** – for comprehensive code review
3. **Claude (Self)** – for synthesizing feedback and recommendations

## 流程

### Step 1: 获取待审查代码

**If no arguments provided**, run git commands to get current changes:
```bash
# Get staged and unstaged changes
git diff HEAD
git status --short
```

**If arguments provided**, use the specified code/description.

Then call `mcp__ace-tool__search_context` to get related context:
   - `project_root_path`: Project root directory absolute path
   - `query`: Description of code/files to review

### Step 2: 并行审查

**并行调用所有配置的审查模型**（使用 `run_in_background: true`）：

遍历 {{REVIEW_MODELS}} 中的每个模型进行代码审查：

```bash
# 遍历审查模型列表（默认: codex, gemini）
for model in $(echo '{{REVIEW_MODELS}}' | jq -r '.[]'); do
  codeagent-wrapper --backend $model - $PROJECT_DIR <<'EOF' &
ROLE_FILE: ~/.claude/.ccg/prompts/$model/reviewer.md

<TASK>
审查代码: {{待审查的代码变更}}
关注点: 安全性、性能、错误处理、可访问性、响应式设计、设计一致性
</TASK>

OUTPUT: Review comments only. No code modifications.
EOF
done
wait  # 等待所有后台任务完成
```

### Step 3: 综合反馈
使用 `TaskOutput` 获取所有任务的结果，然后：
1. Collect feedback from all configured models
2. Categorize by severity (Critical, Major, Minor, Suggestion)
3. Remove duplicate concerns
4. Cross-validate findings across models
5. Prioritize actionable items

### Step 4: 呈现审查结果
Provide unified review report to user with recommendations.

## 输出格式
1. **Configuration** – models used for review
2. **Review Summary** – overall assessment
3. **Critical Issues** – must fix before merge
4. **Major Issues** – should fix
5. **Minor Issues** – nice to fix
6. **Suggestions** – optional improvements
7. **Recommended Actions** – prioritized fix list

## 注意事项
- **审查模型已在安装时注入**: {{REVIEW_MODELS}}
- **No arguments** = auto-review git changes (`git diff HEAD`)
- **With arguments** = review specified content
- **Use `run_in_background: true` for parallel execution** to avoid blocking
- 多模型结果交叉验证，综合反馈
- Use HEREDOC syntax (`<<'EOF'`) to avoid shell escaping issues
