---
description: 优化 Prompt，展示原始与增强版本供确认（当前模式：{{PROMPT_ENHANCER}}）
---

## Usage
`/ccg:enhance <PROMPT>`

## Context
- Original prompt: $ARGUMENTS
- Enhancer mode: {{PROMPT_ENHANCER}}

## Your Role
You are the **Prompt Enhancer** that optimizes user prompts for better AI task execution.

## Process

{{#if PROMPT_ENHANCER_ACE_TOOL}}
### Mode: ace-tool (MCP)

#### Step 1: 调用 Prompt 增强工具

调用 `mcp__ace-tool__enhance_prompt` 工具：
- `prompt`: 用户原始输入
- `conversation_history`: 最近 5-10 轮对话历史
- `project_root_path`: 当前项目根目录（可选）

#### Step 2: 处理响应

根据工具返回的结果：
- **增强后的 prompt**: 展示增强版本，询问用户是否使用
- **`__END_CONVERSATION__`**: 停止对话，不执行任何任务
- **工具调用失败**: 直接使用原始 prompt

#### Step 3: 执行任务

根据用户选择执行相应操作。
{{/if}}

{{#if PROMPT_ENHANCER_CLAUDE_CONTEXT}}
### Mode: claude-context (内置向量搜索)

#### Step 1: 检查索引状态

调用 `mcp__claude-context__get_indexing_status` 检查当前项目索引：
- **未索引**：调用 `mcp__claude-context__index_codebase` 创建索引，等待完成
- **正在索引**：等待完成
- **已索引**：继续下一步

#### Step 2: 多轮语义搜索

基于用户 Prompt 进行 2-3 轮语义搜索：

**第一轮**：直接使用用户 Prompt 的核心关键词
```
mcp__claude-context__search_code({
  path: "<当前项目绝对路径>",
  query: "<提取的核心关键词>",
  limit: 10
})
```

**第二轮**：扩展相关概念（技术栈、模块名）
```
mcp__claude-context__search_code({
  path: "<当前项目绝对路径>",
  query: "<扩展的相关概念>",
  limit: 10
})
```

**第三轮（可选）**：如果前两轮结果不够，搜索更具体的实现细节

#### Step 3: 读取关键代码

使用 `Read` 工具读取 3-5 个最相关的文件，获取具体实现细节。

#### Step 4: 组织增强 Prompt

按以下结构输出：

```markdown
## 原始需求
<用户原始 Prompt>

## 相关代码上下文
### 核心文件
- `<file1.ts>`: <简述该文件与任务的关系>

### 关键代码片段
// <file.ts>:<line>
<关键代码片段>

### 现有模式与约定
- <现有代码中使用的模式>

## 技术约束
- <项目使用的框架/库版本>
- <现有的类型定义或接口>

## 建议关注点
1. <基于代码分析的建议>
2. <可能的陷阱或注意事项>
```

#### Step 5: 展示增强结果

展示原始 Prompt 和增强后的 Prompt，询问用户选择：
- **使用增强版本**: 继续执行任务
- **使用原始版本**: 直接使用原始 Prompt
- **修改**: 让用户进一步调整

#### Step 6: 执行任务

根据用户选择执行相应操作。
{{/if}}

## Notes
- 支持自动语言检测（中文输入 → 中文输出）
- 也可通过在消息末尾添加 `-enhance` 或 `-Enhancer` 触发
- 当前增强模式：**{{PROMPT_ENHANCER}}**
  - `ace-tool`: 使用 ace-tool MCP 服务
  - `claude-context`: 使用内置向量搜索，无需外部服务
