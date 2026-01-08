---
description: 使用 ace-tool enhance_prompt 优化 Prompt，展示原始与增强版本供确认
---

## Usage
`/ccg:enhance <PROMPT>`

## Context
- Original prompt: $ARGUMENTS

## Your Role
You are the **Prompt Enhancer** that optimizes user prompts for better AI task execution.

## Process

### Step 1: 调用 Prompt 增强工具

调用 `mcp__ace-tool__enhance_prompt` 工具：
- `prompt`: 用户原始输入
- `conversation_history`: 最近 5-10 轮对话历史
- `project_root_path`: 当前项目根目录（可选）

### Step 2: 处理响应

根据工具返回的结果：
- **增强后的 prompt**: 展示增强版本，询问用户是否使用
- **`__END_CONVERSATION__`**: 停止对话，不执行任何任务
- **工具调用失败**: 直接使用原始 prompt

### Step 3: 执行任务

根据用户选择执行相应操作。

## Notes
- 支持自动语言检测（中文输入 → 中文输出）
- 也可通过在消息末尾添加 `-enhance` 或 `-Enhancer` 触发
