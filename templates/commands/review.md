---
description: '多模型代码审查：无参数时自动审查 git diff，双模型交叉验证'
---

# Review - 多模型代码审查

双模型并行审查，交叉验证综合反馈。无参数时自动审查当前 git 变更。

## 多模型调用语法

**⚠️ 必须使用 heredoc 语法调用外部模型**：

```bash
~/.claude/bin/codeagent-wrapper --backend <codex|gemini> - "$PWD" <<'EOF'
<任务内容>
EOF
```

---

## 使用方法

```bash
/review [代码或描述]
```

- **无参数**：自动审查 `git diff HEAD`
- **有参数**：审查指定代码或描述

---

## 执行工作流

### 🔍 阶段 1：获取待审查代码

`[模式：研究]`

**无参数时**：
```bash
git diff HEAD
git status --short
```

**有参数时**：使用指定的代码/描述

调用 `mcp__ace-tool__search_context` 获取相关上下文。

### 🔬 阶段 2：并行审查

`[模式：审查]`

**并行调用两个模型**：

**执行步骤**：
1. 使用 **Bash 工具的 `run_in_background: true` 参数**启动两个后台进程：

**Codex 审查进程**：
```
Bash({
  command: "~/.claude/bin/codeagent-wrapper --backend codex - \"$PWD\" <<'EOF_CODEX'
[角色] 后端代码审查专家
[任务] 审查以下代码变更

## 审查重点
- 安全性：注入、认证、授权
- 性能：N+1 查询、缓存、复杂度
- 错误处理：异常捕获、边界条件
- 可维护性：命名、结构、文档

## 待审查代码
<粘贴 git diff 内容>

## 输出格式
按 Critical/Major/Minor/Suggestion 分类列出问题
EOF_CODEX",
  run_in_background: true,
  timeout: 3600000,
  description: "Codex 后端代码审查"
})
```

**Gemini 审查进程**：
```
Bash({
  command: "~/.claude/bin/codeagent-wrapper --backend gemini - \"$PWD\" <<'EOF_GEMINI'
[角色] 前端代码审查专家
[任务] 审查以下代码变更

## 审查重点
- 可访问性：ARIA、键盘导航、色彩对比
- 响应式：移动端适配、断点
- 设计一致性：组件复用、样式规范
- 用户体验：加载状态、错误提示

## 待审查代码
<粘贴 git diff 内容>

## 输出格式
按 Critical/Major/Minor/Suggestion 分类列出问题
EOF_GEMINI",
  run_in_background: true,
  timeout: 3600000,
  description: "Gemini 前端代码审查"
})
```

2. 使用 `TaskOutput` 监控并获取 2 个模型的审查结果。

**⚠️ 强制规则：必须等待 TaskOutput 返回两个模型的完整结果后才能进入下一阶段，禁止跳过或提前继续！**

### 🔀 阶段 3：综合反馈

`[模式：综合]`

1. 收集双方审查结果
2. 按严重程度分类：Critical / Major / Minor / Suggestion
3. 去重合并 + 交叉验证

### 📊 阶段 4：呈现审查结果

`[模式：总结]`

```markdown
## 📋 代码审查报告

### 审查范围
- 变更文件：<数量> | 代码行数：+X / -Y

### 关键问题 (Critical)
> 必须修复才能合并
1. <问题描述> - [Codex/Gemini]

### 主要问题 (Major) / 次要问题 (Minor) / 建议 (Suggestions)
...

### 总体评价
- 代码质量：[优秀/良好/需改进]
- 是否可合并：[是/否/需修复后]
```

---

## 关键规则

1. **无参数 = 审查 git diff** – 自动获取当前变更
2. **heredoc 语法** – 必须使用 `<<'EOF'` 传递多行任务
3. **双模型交叉验证** – 后端问题以 Codex 为准，前端问题以 Gemini 为准
4. **使用 Bash 工具的 `run_in_background: true` 参数 + `TaskOutput` 获取结果**
5. **必须等待所有模型返回** – 禁止提前进入下一步
