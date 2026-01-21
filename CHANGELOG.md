# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.7.47] - 2026-01-21

### 🐛 Bug 修复

**修复 `gemini/architect.md` 文件缺失导致会话复用失败 (exit code 42)**

- **问题**: Windows 用户使用会话复用时报错：
  ```
  Failed to read ROLE_FILE 'C:/Users/XXX/.claude/.ccg/prompts/gemini/architect.md':
  The system cannot find the file specified.
  ```
- **根本原因**: `templates/prompts/gemini/` 目录下缺失 `architect.md` 文件，但命令模板 (`plan.md`, `execute.md` 等) 引用了该文件
- **修复**: 新增 `templates/prompts/gemini/architect.md` 文件，定义前端架构师角色
- **影响**:
  - ✅ `/ccg:plan` 和 `/ccg:execute` 可正常使用 Gemini 后端
  - ✅ 会话复用 (`resume`) 功能恢复正常
  - ✅ 更新 `package.json` 将新文件加入发布列表

### 📝 环境变量配置说明

**VSCode 插件用户注意**: 如果 Gemini 出现退出码 41（授权失败），需在 `~/.claude/settings.json` 配置 API 密钥：

```json
{
  "env": {
    "GEMINI_API_KEY": "your-api-key",
    "GOOGLE_API_KEY": "your-api-key"
  }
}
```

VSCode 插件启动的子进程不会继承终端环境变量，必须通过 `settings.json` 显式配置。

---

## [1.7.44] - 2026-01-18

### 🐛 Bug 修复

**修复 ace-tool-rs 安装时显示"跳过"的问题**

- **问题**: 选择 ace-tool-rs 并输入 Token 后，安装摘要仍显示"MCP工具跳过"
- **根本原因**:
  - Line 179: 显示摘要的条件判断遗漏 `ace-tool-rs`，只检查 `mcpProvider === 'ace-tool'`
  - Line 389: MCP 资源提示的条件判断也有同样问题
- **修复**:
  - 统一为 `(mcpProvider === 'ace-tool' || mcpProvider === 'ace-tool-rs')`
  - 显示时动态使用 `mcpProvider` 变量，正确显示 `ace-tool` 或 `ace-tool-rs`
- **影响**:
  - ✅ ace-tool-rs 用户可以看到正确的安装状态
  - ✅ Token 配置成功时显示绿色"ace-tool-rs"
  - ✅ 跳过 Token 配置时显示黄色"ace-tool-rs (待配置)"
  - ✅ 真正跳过时才显示灰色"跳过"

**感谢 @用户 发现并报告此问题！**

---

## [1.7.41] - 2026-01-18

### 🐛 Bug 修复

**修复 Windows Git Bash 环境下 PATH 继承问题 (codeagent-wrapper v5.7.1)**

- **问题**: codeagent-wrapper 仅对 `claude` 后端设置环境变量，导致 `codex`/`gemini` 在 Windows Git Bash 后台进程中找不到命令
- **修复**: 统一所有后端的环境变量处理逻辑
  - 所有后端均调用 `cmd.SetEnv()` 显式合并父进程环境变量
  - 确保 PATH 等关键环境变量正确继承
  - 修复文件: `codeagent-wrapper/executor.go:972-978`
- **影响**:
  - ✅ Windows 用户不再需要手动配置 `settings.json` 注入 PATH
  - ✅ 所有平台的环境变量继承行为统一
  - ✅ 减少 "command not found" 错误

**详细诊断**: 参见 `PATH_ISSUE_DIAGNOSIS.md`

---

## [1.7.39] - 2026-01-16

### ✨ 新功能

**新增 `/ccg:plan` 和 `/ccg:execute` 命令 - 分离规划与执行**

将原有的 workflow 拆分为两个独立命令，实现规划与执行的解耦：

#### `/ccg:plan` - 多模型协作规划
- **Phase 1**: 上下文全量检索
  - 强制调用 `mcp__ace-tool__enhance_prompt` 增强提示词
  - 调用 `mcp__ace-tool__search_context` 检索项目上下文
- **Phase 2**: 多模型协作分析
  - Codex + Gemini 并行分析，交叉验证
  - 可选：双模型产出"计划草案"降低遗漏风险
  - 生成 Step-by-step 实施计划
- **计划交付**：保存至 `.claude/plan/<功能名>.md`，提示用户审查或执行
- **不问 Y/N**：只展示计划，让用户决定下一步

#### `/ccg:execute` - 多模型协作执行
- **Phase 0**: 读取计划文件，提取 SESSION_ID
- **Phase 1**: 上下文快速检索（使用 MCP 工具，禁止手动 find/ls）
- **Phase 3**: 原型获取（Codex/Gemini 根据任务类型路由）
- **Phase 4**: 编码实施（Claude 重构"脏原型"为生产级代码）
- **Phase 5**: 审计与交付（双模型 Code Review）

#### 关键设计
- **代码主权**：Codex/Gemini 只输出 Unified Diff Patch，Claude 负责实际修改
- **SESSION_ID 交接**：plan 生成的 SESSION_ID 可传递给 execute 复用上下文
- **信任规则**：后端逻辑以 Codex 为准，前端设计以 Gemini 为准

### 🐛 Bug 修复

**修复 `/ccg:init` 不调用子智能体的问题**

- 原模板只是描述性地说"调用子智能体"，没有给出具体调用语法
- 现在添加了明确的 Task 工具调用格式
- 先调用 `get-current-datetime` 获取时间戳
- 再调用 `init-architect` 执行完整扫描

### 📝 文档更新

- 命令总数从 14 个增加到 16 个
- 更新 CLAUDE.md 文档反映新命令
- 更新模板文件清单

---

## [1.7.38] - 2026-01-16

### 🐛 Bug 修复

**修复更新工作流逻辑问题**

#### 问题背景

用户反馈：当通过 npm 全局安装且当前版本已是最新版本时，系统仍然提示用户运行 `npm install -g ccg-workflow@latest`，导致用户困惑。

**场景重现**：
```
当前版本: v1.7.37
最新版本: v1.7.37
本地工作流: v1.7.25

检测到本地工作流版本(v1.7.25)低于当前版本(v1.7.37)，是否更新? Yes
⚠️  检测到你是通过 npm 全局安装的
推荐的更新方式:
npm install -g ccg-workflow@latest  ← 用户困惑：明明已经是最新版本了
```

#### 修复方案

在 `src/commands/update.ts:196-237` 中添加判断逻辑：

**修复前**：
```typescript
if (isGlobalInstall) {
  // 总是提示用户运行 npm install -g
}
```

**修复后**：
```typescript
// 如果全局安装且仅工作流需要更新（包已是最新）
if (isGlobalInstall && !isNewVersion) {
  console.log('✓ 当前包版本已是最新')
  console.log('⚙️  仅需更新工作流文件')
  // 继续更新工作流，不提示更新包
}
// 如果全局安装且包有新版本
else if (isGlobalInstall && isNewVersion) {
  console.log('⚠️  检测到你是通过 npm 全局安装的')
  console.log('推荐的更新方式: npm install -g ccg-workflow@latest')
  // 提示用户更新包
}
```

#### 修复后的用户体验

**场景 1：包已是最新，仅工作流需要更新**
```
当前版本: v1.7.38
最新版本: v1.7.38
本地工作流: v1.7.25

检测到本地工作流版本(v1.7.25)低于当前版本(v1.7.38)，是否更新? Yes
ℹ️  检测到你是通过 npm 全局安装的
✓ 当前包版本已是最新 (v1.7.38)
⚙️  仅需更新工作流文件
```

**场景 2：包有新版本**
```
当前版本: v1.7.37
最新版本: v1.7.38

确认要更新到 v1.7.38 吗? Yes
⚠️  检测到你是通过 npm 全局安装的
推荐的更新方式:
npm install -g ccg-workflow@latest
```

### 📦 版本更新

- **ccg-workflow**: 1.7.37 → 1.7.38

---

## [1.7.37] - 2026-01-16

### ✨ 新功能

**添加 ace-tool-rs MCP 支持**

#### 背景

社区用户反馈希望支持 [ace-tool-rs](https://github.com/missdeer/ace-tool-rs)，这是 ace-tool 的 Rust 实现版本，具有以下优势：
- 更轻量（二进制文件更小）
- 更快速（Rust 性能优势）
- 更低的资源占用

#### 实现内容

**1. 添加 `installAceToolRs` 函数**

在 `src/utils/installer.ts` 中添加 ace-tool-rs 安装函数：
```typescript
export async function installAceToolRs(config: AceToolConfig): Promise<...> {
  // 使用 npx ace-tool-rs 命令
  // 添加 RUST_LOG=info 环境变量
}
```

**2. 更新 i18n 文本**

添加中英文翻译：
- `init:aceToolRs.title` - "ace-tool-rs MCP 配置"
- `init:aceToolRs.description` - "Rust 实现的 ace-tool，更轻量、更快速"
- `init:aceToolRs.installing` - "正在配置 ace-tool-rs MCP..."
- `init:aceToolRs.failed` - "ace-tool-rs 配置失败（可稍后手动配置）"

**3. 修改 init 命令**

在初始化时提供 3 个选项：
- `ace-tool` (Node.js 实现)
- `ace-tool-rs` **(推荐)** (Rust 实现)
- 跳过

默认选项改为 `ace-tool-rs`。

**4. 修改 config-mcp 命令**

在 MCP 配置命令中添加选项：
- 安装/更新 ace-tool MCP (Node.js 实现)
- 安装/更新 ace-tool-rs MCP **(推荐)** (Rust 实现)
- 卸载 MCP 配置

#### 使用方式

**初始化时选择**：
```bash
npx ccg-workflow

# 选择 MCP 工具
? 选择 MCP 工具
  ace-tool (Node.js 实现) - 一键安装，含 Prompt 增强 + 代码检索
❯ ace-tool-rs (推荐) (Rust 实现) - 更轻量、更快速
  跳过 - 稍后手动配置（可选 auggie 等其他 MCP）
```

**后续配置**：
```bash
npx ccg-workflow config mcp

# 选择操作
? 选择操作
  ➜ 安装/更新 ace-tool MCP (Node.js 实现)
❯ ➜ 安装/更新 ace-tool-rs MCP (推荐) (Rust 实现)
  ✕ 卸载 MCP 配置
  返回
```

#### MCP 配置格式

**ace-tool-rs 配置**：
```json
{
  "mcpServers": {
    "ace-tool": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "ace-tool-rs",
        "--base-url", "https://api.example.com",
        "--token", "your-token-here"
      ],
      "env": {
        "RUST_LOG": "info"
      }
    }
  }
}
```

#### 重要说明

**MCP 工具名称统一**：
- ace-tool 和 ace-tool-rs 都注册为 **同一个 MCP 服务器名称** `"ace-tool"`
- 提供 **相同的工具接口**：
  - `mcp__ace-tool__search_context` - 代码检索
  - `mcp__ace-tool__enhance_prompt` - Prompt 增强
- **无需修改提示词模板**：两个实现可以无缝切换
- AI 会自动调用 `mcp__ace-tool__*` 工具，无论底层使用哪个实现

**选择建议**：
- **ace-tool-rs (推荐)**：Rust 实现，更轻量、更快速、资源占用更低
- **ace-tool**：Node.js 实现，兼容性更好，适合特殊环境

### 📦 版本更新

- **ccg-workflow**: 1.7.36 → 1.7.37

---

## [1.7.36] - 2026-01-16

### 🐛 Bug 修复

**修复 Codex 默认需要手动同意文件操作的问题**

#### 问题背景

- Codex 后端默认需要用户手动同意读取文件和执行操作
- Gemini 后端使用 `-y` 参数自动同意所有操作
- 两个后端行为不一致，影响用户体验

#### 修复方案

**1. 修改 `executor.go:772-783`**

```go
// 原逻辑：只有设置 CODEX_BYPASS_SANDBOX=true 时才自动同意
if envFlagEnabled("CODEX_BYPASS_SANDBOX") {
    args = append(args, "--dangerously-bypass-approvals-and-sandbox")
}

// 新逻辑：默认自动同意（与 Gemini 一致）
if !envFlagEnabled("CODEX_REQUIRE_APPROVAL") {
    args = append(args, "--dangerously-bypass-approvals-and-sandbox")
}
```

**2. 添加环境变量控制**

- `CODEX_REQUIRE_APPROVAL=true` - 需要手动同意（可选退出）
- 默认行为：自动同意所有操作

**3. 更新帮助信息**

添加 `CODEX_REQUIRE_APPROVAL` 和 `CODEX_DISABLE_SKIP_GIT_CHECK` 环境变量说明。

### ✨ 新功能

**Web UI 增强**

1. **自动滚动修复**
   - 修复显示任务内容后不滚动到底部的问题
   - 每次新内容到达时自动滚动
   - 尊重用户手动滚动（向上滚动后停止自动滚动）

2. **任务完成后自动关闭页面**
   - 显示 "✓ 完成 (3秒后自动关闭)"
   - 3 秒后自动调用 `window.close()`
   - 如果无法关闭（用户手动打开的窗口），显示 "✓ 完成 (可以关闭此页面)"

### 📦 版本更新

- **ccg-workflow**: 1.7.35 → 1.7.36
- **codeagent-wrapper**: 5.6.0 → 5.7.0

---

## [1.7.22] - 2026-01-13

### 🐛 Bug 修复

**真正修复 Windows Codex 进程挂起问题**

#### 问题背景

v1.7.21 的修复不完整，Windows 上 Codex 完成后 codeagent-wrapper 进程仍然挂起：
- 日志显示 "terminating lingering backend" 后就卡住了
- `taskkill /T /F` 成功执行，但 `cmd.Wait()` 仍然阻塞

#### 根本原因

`cmd.Wait()` 阻塞直到 **所有 stdout 句柄关闭**，而不仅仅是主进程退出。在 Windows 上：
1. Codex CLI 启动子进程（Node.js workers）
2. 子进程继承了 stdout 句柄
3. `taskkill /T /F` 杀死进程树
4. 但 Go 的 stdout pipe 仍然打开
5. `cmd.Wait()` 等待 pipe 关闭 → 永远阻塞

#### 修复方案

在 `messageTimerCh` case 中，**先关闭 stdout**，再终止进程：

```go
case <-messageTimerCh:
    // ...
    if !terminated {
        // FIX: Close stdout FIRST to unblock cmd.Wait()
        closeWithReason(stdout, "messageTimer")  // ← 新增
        if timer := terminateCommandFn(cmd); timer != nil {
            // ...
        }
    }
```

#### 执行流程（修复后）

1. `completeSeen` → 启动 5 秒计时器
2. `messageTimerCh` 触发 → **先关闭 stdout**
3. parser goroutine 收到 EOF → 返回
4. `cmd.Wait()` 不再阻塞 → 返回
5. `waitCh` 收到信号 → `waitLoop` 正常退出
6. wrapper 正常输出结果并退出（exit code 0）

#### 影响范围

- ✅ **修复前**：Windows + Codex 完成后挂起
- ✅ **修复后**：所有平台正常退出
- ✅ **向后兼容**：Unix 平台行为不变（Unix 进程退出时自动关闭句柄）

---

## [1.7.21] - 2026-01-13

### 🐛 Bug 修复

**彻底修复 Windows 系统 Codex 进程无法自动终止问题**

#### 问题背景

v1.7.18 的修复不完整，Windows 上 Codex 完成后进程仍然卡住：
- Web UI 显示完成，但 codeagent-wrapper 进程一直不退出
- 只有手动杀死进程才能继续
- Mac 没问题，Windows 的 Gemini 也没问题

#### 根本原因分析

1. **进程树问题**：`proc.Kill()` 只终止主进程，Codex 启动的子进程（Node.js workers）仍然运行，持有 stdout handle
2. **阻塞等待问题**：`messageTimerCh` case 里直接 `waitErr = <-waitCh` 阻塞等待，如果进程没被杀死就永远卡住

#### 核心修复

1. **使用 `taskkill /T` 终止整个进程树**：
   - 新增 `killProcessTree()` 函数，使用 `taskkill /T /F /PID` 递归杀死所有子进程
   - `terminateCommand()`、`terminateProcess()`、`forwardSignals()` 在 Windows 上调用进程树终止

2. **移除阻塞等待**：
   - `messageTimerCh` case 里不再直接阻塞等待 `waitCh`
   - 让循环继续，下一轮通过 `case waitErr = <-waitCh` 正常退出
   - 即使 `taskkill` 失败，也不会永远卡住

#### 技术细节

修改文件：`codeagent-wrapper/executor.go`

```go
// 新增：Windows 进程树终止
func killProcessTree(pid int) error {
    if !isWindows() {
        return nil
    }
    cmd := exec.Command("taskkill", "/T", "/F", "/PID", fmt.Sprintf("%d", pid))
    return cmd.Run()
}

// 修改：terminateCommand 使用进程树终止
if isWindows() {
    if err := killProcessTree(proc.Pid()); err != nil {
        _ = proc.Kill() // fallback
    }
}

// 修改：messageTimerCh case 不再阻塞
case <-messageTimerCh:
    // ...terminate logic...
    // Do NOT block here - let loop continue
```

#### 影响范围

- ✅ **修复前**：Windows 用户 Codex 完成后进程卡住
- ✅ **修复后**：所有平台进程正确终止
- ✅ **向后兼容**：Unix 平台行为不变

#### codeagent-wrapper 版本

- 升级至 v5.6.0
- 重新编译所有平台二进制文件

---

## [1.7.20] - 2026-01-13

### 🐛 Bug 修复

**修复并行调用指令不清晰导致 Claude 不使用 run_in_background**

v1.7.19 的表格格式精简过度，导致 Claude 无法理解需要发起并行 Bash 调用。

**修复方案**：将表格格式改为明确的调用指令格式：
```
1. **Codex 后端诊断**：`Bash({ command: "...--backend codex...", run_in_background: true })`
2. **Gemini 前端诊断**：`Bash({ command: "...--backend gemini...", run_in_background: true })`
```

**修改文件**：
- `templates/commands/debug.md`
- `templates/commands/optimize.md`
- `templates/commands/review.md`
- `templates/commands/analyze.md`
- `templates/commands/test.md`

---

## [1.7.19] - 2026-01-13

### 📝 文档优化

**精简命令模板，去除冗余代码块**

所有调用外部模型的命令模板已统一格式：
- 顶部保留完整的「多模型调用规范」代码示例（只出现一次）
- 各阶段改为 `⚠️ 必须调用 xxx（参照上方调用规范）` + 参数表格
- 避免重复教学，减少模板体积

**修改文件**：
- `templates/commands/backend.md` - 阶段 2、3、5 精简
- `templates/commands/frontend.md` - 阶段 2、3、5 精简
- `templates/commands/debug.md` - 阶段 2 精简
- `templates/commands/optimize.md` - 阶段 2 精简
- `templates/commands/review.md` - 阶段 2 精简
- `templates/commands/test.md` - 阶段 2 精简
- `templates/commands/analyze.md` - 阶段 2 添加 ⚠️ 强调标记

---

## [1.7.18] - 2026-01-13

### 🐛 Bug 修复

**修复 Windows 系统 Codex 进程无法自动终止问题**

#### 问题背景

用户在 Windows 系统上使用 Codex 时遇到问题：
- Codex 任务实际已完成（Web 界面显示完成，输出了 `agent_message` 和 `turn.completed`）
- 但 codeagent-wrapper 进程一直不退出
- 导致 Claude Code Task 工具无法获取日志，一直等待
- 只有手动关闭进程才能继续

**根本原因**：
- `terminateCommand` 函数使用 `syscall.SIGTERM` 信号终止进程
- **Windows 不支持 SIGTERM 信号**，该调用静默失败（不报错但不执行任何操作）
- 虽然有 `forceKillDelay` 后的 `Kill()` 备用逻辑，但代码在 `waitCh` 上阻塞等待进程退出
- 导致 Kill() 的定时器无法正确触发或进程无法正常退出

#### 核心修复

1. **Windows 平台直接使用 Kill()**：
   - `terminateCommand()` 函数：Windows 上直接调用 `proc.Kill()` 而非 `SIGTERM`
   - `terminateProcess()` 函数：同样的修复
   - `forwardSignals()` 函数：同样的修复

2. **保持 Unix 兼容性**：
   - Unix/Linux/macOS 仍使用 `SIGTERM` 实现优雅退出
   - 保留 `forceKillDelay` 后的强制 Kill 逻辑

#### 技术细节

修改文件：`codeagent-wrapper/executor.go`

```go
// 修复前
_ = proc.Signal(syscall.SIGTERM)

// 修复后
if isWindows() {
    _ = proc.Kill()  // Windows: 直接终止
} else {
    _ = proc.Signal(syscall.SIGTERM)  // Unix: 优雅退出
}
```

#### 影响范围

- ✅ **修复前**：Windows 用户 Codex 完成后进程卡住，需要手动终止
- ✅ **修复后**：所有平台进程正确终止，Task 工具可以正常获取结果
- ✅ **向后兼容**：Unix 平台行为不变

#### 相关文件

- `codeagent-wrapper/executor.go` - 修改 3 个函数的信号处理逻辑
- `codeagent-wrapper/main.go` - 版本号升级至 v5.5.0
- 重新编译所有平台二进制文件

---

## [1.7.17] - 2026-01-12

### 🐛 Bug 修复

**修复 Windows 系统 Codex 完成检测问题**

#### 问题背景

用户在 Windows 系统上使用 Codex 时遇到问题：
- Codex 任务实际已完成（Web 界面显示完成，输出了 `agent_message`）
- 但 Claude Code 一直显示 "Codex 响应较慢" 或继续等待
- 导致用户体验不佳，需要手动中断

**根本原因**：
- `codeagent-wrapper` 的 `postMessageTerminateDelay` 设置为 1 秒
- Codex CLI 在输出 `agent_message` 后，发送完成事件（`turn.completed`/`thread.completed`）可能有延迟
- 在 Windows 系统上，这个延迟经常超过 1 秒
- 导致 wrapper 在收到完成事件前就尝试终止进程，上层认为任务未完成

#### 核心修复

1. **增加默认延迟时间**：从 1 秒增加到 5 秒
   - 给 Codex CLI 足够时间发送完成事件
   - 解决 Windows 系统上的延迟问题

2. **添加环境变量支持**：`CODEAGENT_POST_MESSAGE_DELAY`
   - 用户可以根据网络环境自定义延迟时间（单位：秒）
   - 默认值：5 秒
   - 最大值：60 秒（防止过长等待）
   - 示例：`export CODEAGENT_POST_MESSAGE_DELAY=10`

3. **代码改进**：
   - 将硬编码常量 `postMessageTerminateDelay` 改为函数 `resolvePostMessageDelay()`
   - 添加环境变量解析和验证逻辑
   - 添加详细的注释说明延迟的作用

#### 影响范围

- ✅ **修复前**：Windows 用户经常遇到 Codex 任务"假性未完成"
- ✅ **修复后**：所有平台均能正确检测 Codex 完成状态
- ✅ **向后兼容**：默认 5 秒延迟对所有平台都适用，不影响现有用户

#### 技术细节

修改文件：`codeagent-wrapper/executor.go`
- 添加 `resolvePostMessageDelay()` 函数（第 22-45 行）
- 修改 `runCodexTaskWithContext()` 中的定时器创建（第 1136 行）
- 添加 `strconv` 导入以支持环境变量解析

---

## [1.7.16] - 2026-01-10

### 🐛 Bug 修复

**修复 Windows 二进制文件缺失问题**

#### 问题背景

用户在 Windows 系统上通过 `npx ccg-workflow` 更新时遇到错误：
```
Binary not found in package: codeagent-wrapper-windows-amd64.exe
```

**根本原因**：
- `.gitignore` 忽略了所有 `.exe` 文件（包括 `bin/` 目录下的预编译二进制文件）
- Windows 二进制文件未被 Git 跟踪，导致发布的 npm 包中缺失这些文件
- macOS/Linux 二进制文件正常（无 `.exe` 扩展名，未被忽略）

#### 核心修复

1. **修改 `.gitignore`**：添加例外规则 `!bin/*.exe`
   - 忽略构建过程中的 `.exe` 文件
   - 但允许 `bin/` 目录下的预编译二进制文件被跟踪

2. **提交 Windows 二进制文件到 Git**：
   - `bin/codeagent-wrapper-windows-amd64.exe` ✅
   - `bin/codeagent-wrapper-windows-arm64.exe` ✅

3. **发布新版本到 npm**：确保 Windows 用户能正常安装和更新

#### 影响范围

- ✅ **修复前**：Windows 用户无法安装或更新（二进制文件缺失）
- ✅ **修复后**：所有平台（macOS、Linux、Windows）均可正常使用

---

## [1.7.15] - 2026-01-10

### 🐛 Bug 修复

**修复 Windows 系统下的路径兼容性和输出截断问题**

#### 问题背景

Windows 用户在使用 CCG 工作流时遇到两个关键问题：

1. **路径问题**：后台命令执行失败（exit code 127）
   - 原因：Windows 路径中的反斜杠 `\` 在 Git Bash heredoc 中被转义
   - 错误：`C:\Users\Lin\.claude\bin\codeagent-wrapper` → `C:UsersLin.claudebincodeagent-wrapper`

2. **输出截断问题**：codeagent-wrapper 不返回完整结果
   - 原因 1：日志行长度限制（1000 字符）截断长 JSON 事件
   - 原因 2：Windows Git Bash 后台进程 stdout 缓冲未刷新
   - 影响：只能获取推理过程，获取不到完整的 agent_message

#### 核心修复

**1. 路径兼容性修复（所有平台受益）**
- ✅ 统一使用正斜杠路径（`C:/Users/...`）
  - Windows Git Bash、PowerShell、CMD 均支持正斜杠
  - heredoc 中不会被转义
- ✅ Windows 下自动添加 `.exe` 扩展名
  - `~/.claude/bin/codeagent-wrapper` → `C:/Users/.../bin/codeagent-wrapper.exe`
- 📝 修改文件：`src/utils/installer.ts`

**2. 输出截断修复**
- ✅ 移除日志行长度限制（所有平台）
  - `codexLogLineLimit: 1000 → 0`（无限制）
  - 防止长 JSON 事件（如 agent_message）被截断
- ✅ 强制刷新 stdout（仅 Windows）
  - 添加 `os.Stdout.Sync()` 确保后台进程输出完整捕获
- 📝 修改文件：`codeagent-wrapper/main.go`（升级至 v5.4.1）
- 🔨 重新编译所有平台二进制文件

#### 技术细节

**installer.ts 路径处理逻辑**：
```typescript
// 1. 正斜杠路径（所有平台）
const normalizePath = (path: string) => path.replace(/\\/g, '/')

// 2. Windows 特殊处理 .exe 扩展名
const wrapperName = isWindows() ? 'codeagent-wrapper.exe' : 'codeagent-wrapper'
const wrapperPath = `${normalizePath(binDir)}/${wrapperName}`
```

**codeagent-wrapper 修复**：
```go
// 1. 无限制日志（所有平台）
const codexLogLineLimit = 0 // was 1000

// 2. 强制刷新（仅 Windows）
if isWindows() {
    _ = os.Stdout.Sync()
}
```

#### 用户体验改进

**修复前（Windows）**：
```
❌ 路径：C:UsersLin.claudebincodeagent-wrapper (错误)
❌ 输出：只获取到约 600 字符（12,917 字符被截断）
❌ 状态：后台命令 exit code 127
```

**修复后（Windows）**：
```
✅ 路径：C:/Users/Lin/.claude/bin/codeagent-wrapper.exe
✅ 输出：完整的 agent_message（无截断）
✅ 状态：命令正常执行
```

---

## [1.7.13] - 2026-01-09

### 🐛 Bug 修复

**修复更新版本判断问题**

#### 问题背景

用户通过 `npx ccg-workflow` 运行时，npm 包已是最新版本，但本地工作流可能是旧版本（例如 v1.7.10 安装的）。

原因：`checkForUpdates()` 只比较 npm registry 版本，没有比较本地配置版本 (`config.general.version`)。

导致：
1. **每次都要手动选择"重新安装"** - `hasUpdate` 总是 false，默认选项是"否"
2. **用户困惑** - 明明需要更新，但系统提示"已是最新版本"

#### 核心修复

1. **新增本地版本检测**
   - ✅ 读取 `~/.claude/.ccg/config.toml` 中的 `general.version`
   - ✅ 比较本地版本与当前 npm 包版本
   - ✅ 如果本地版本低于当前包版本，`needsWorkflowUpdate = true`
   - 📝 修改文件：`src/commands/update.ts`

2. **优化更新提示**
   - ✅ 显示"本地工作流版本"，让用户清楚知道当前状态
   - ✅ 三种提示场景：
     - npm 有新版本：`确认要更新到 vX.Y.Z 吗？`
     - npm 是最新但本地过期：`检测到本地工作流版本 (vA.B.C) 低于当前版本 (vX.Y.Z)，是否更新？`
     - 完全最新：`当前已是最新版本。要重新安装吗？`
   - ✅ 当需要更新时，默认选项改为"是"

#### 用户体验改进

**更新流程（本地版本过期）**：
```
🔄 检查更新...

当前版本: v1.7.13
最新版本: v1.7.13
本地工作流: v1.7.10

? 检测到本地工作流版本 (v1.7.10) 低于当前版本 (v1.7.13)，是否更新？(Y/n)
```

### 💡 用户价值

- **自动检测过期**：不再需要用户判断是否需要更新
- **默认选项正确**：需要更新时默认"是"，无需额外操作
- **透明度提升**：显示本地版本，用户清楚知道为什么需要更新

---

## [1.7.12] - 2026-01-09

### 🐛 Bug 修复

**修复 Windows 路径兼容性问题**

#### 问题背景

Windows 用户使用 PowerShell 执行命令时，路径格式不兼容：
- 模板中的路径被转换为 Git Bash 格式：`/c/Users/zlb/.claude/.ccg/...`
- PowerShell 无法识别此格式，报错"路径不存在"

#### 核心修复

1. **重写路径替换函数**
   - ✅ Windows 上使用原生路径格式：`C:\Users\zlb\.claude\.ccg\...`
   - ✅ 修复混合分隔符问题（`C:\Users\zlb/.claude/bin` → `C:\Users\zlb\.claude\bin`）
   - 📝 修改文件：`src/utils/installer.ts`

### 💡 用户价值

- **Windows 用户**：PowerShell 现在可以正常读取文件路径

---

## [1.7.11] - 2026-01-09

### 🐛 Bug 修复

**修复 npm 全局安装用户的更新和卸载问题**

#### 问题背景

用户通过 `npm install -g ccg-workflow` 全局安装后，存在双重路径问题：
- npm 全局包路径（提供 `ccg` 命令入口）
- 用户工作目录 `~/.claude/`（存储命令模板、配置等）

导致：
1. **卸载显示成功但命令仍可用** - 只删除了 `~/.claude/` 文件，npm 全局包未移除
2. **更新显示成功但版本号不变** - 只更新了工作目录文件，`ccg` 命令仍指向旧版本

#### 核心修复

1. **新增全局安装检测**
   - ✅ 新增 `checkIfGlobalInstall()` 函数检测 npm 全局安装
   - ✅ 通过 `npm list -g ccg-workflow --depth=0` 判断
   - 📝 修改文件：`src/commands/update.ts`, `src/commands/menu.ts`

2. **修复更新功能**
   - ✅ 检测到全局安装时，引导用户使用 `npm install -g ccg-workflow@latest`
   - ✅ 提供交互式选择：推荐 npm 更新 / 继续内置更新（仅更新工作流文件）
   - ✅ 明确告知内置更新不会更新 `ccg` 命令本身
   - 📝 修改文件：`src/commands/update.ts`

3. **修复卸载功能**
   - ✅ 卸载前提示"完整卸载需要两步"
   - ✅ 卸载后显示第二步提示：`npm uninstall -g ccg-workflow`
   - ✅ 说明完成后 `ccg` 命令将彻底移除
   - 📝 修改文件：`src/commands/menu.ts`

#### 用户体验改进

**更新流程（全局安装用户）**：
```
⚠️  检测到你是通过 npm 全局安装的

推荐的更新方式：
  npm install -g ccg-workflow@latest

这将同时更新命令和工作流文件

? 改用 npm 更新（推荐）？(Y/n)
```

**卸载流程（全局安装用户）**：
```
⚠️  检测到你是通过 npm 全局安装的

完整卸载需要两步：
  1. 移除工作流文件 (即将执行)
  2. 卸载 npm 全局包 (需要手动执行)

? 继续卸载工作流文件？

... (卸载成功后) ...

🔸 最后一步：卸载 npm 全局包

请在新的终端窗口中运行：
  npm uninstall -g ccg-workflow

(完成后 ccg 命令将彻底移除)
```

### 💡 用户价值

- **全局安装用户**：清晰的更新/卸载引导，避免操作混乱
- **混合安装场景**（先全局安装再用 npx）：自动检测并提供正确操作指引
- **透明度提升**：用户明确知道哪些文件被删除，哪些需要手动操作

---

## [1.7.10] - 2026-01-09

### 🐛 Bug 修复

**Windows 兼容性与升级体验优化**

#### 核心修复

1. **修复 Windows 路径兼容性问题**
   - ✅ 新增 `convertToGitBashPath` 函数，将 Windows 路径转换为 Git Bash 兼容格式
   - ✅ 修复路径从 `C:\Users\zlb\.claude\bin` 变形为 `C:Userszlb/.claude/bin` 的问题
   - ✅ 支持所有驱动器盘符（C:, D:, E: 等）自动转换为 `/c/`, `/d/`, `/e/`
   - ✅ 影响所有调用 codeagent-wrapper 的命令（backend、frontend、workflow、analyze 等）
   - 📝 修改文件：`src/utils/installer.ts`

2. **修复配置迁移问题**
   - ✅ `update` 命令现在会自动检测并执行从 `~/.ccg` 到 `~/.claude/.ccg` 的迁移
   - ✅ 从 v1.3.x 升级到 v1.7.x 时自动迁移配置文件和 prompts
   - ✅ 显示详细的迁移日志（已迁移文件、已跳过文件、错误信息）
   - 📝 修改文件：`src/commands/update.ts`

3. **修复 Windows npx 缓存问题**
   - ✅ `update` 命令在 Windows 上自动清理 npx 缓存
   - ✅ 确保更新时拉取最新版本，而不是使用缓存的旧版本
   - ✅ 先尝试 `npx clear-npx-cache`，失败则手动删除 `~/.npm/_npx`
   - 📝 修改文件：`src/commands/update.ts`

### 📝 文档改进

1. **完善卸载与更新文档**
   - ✅ README 中增加完整的卸载说明（交互式 + 手动清理）
   - ✅ **新增 npx 缓存清理说明**，解决更新后仍使用旧版本的问题
   - ✅ 提供手动清理 MCP 配置的指引
   - 📝 修改文件：`README.md`

### 🧪 测试验证

- ✅ Windows 路径转换测试（6 个测试用例全部通过）
- ✅ 所有平台二进制文件已重新编译（macOS、Linux、Windows × amd64/arm64）
- ✅ TypeScript 类型检查通过
- ✅ 构建测试通过

### 💡 用户价值

- **Windows 用户**：彻底解决路径兼容性问题，codeagent-wrapper 正常调用
- **升级用户**：自动迁移配置 + npx 缓存清理指引，确保使用最新版本

---

## [1.6.0] - 2026-01-07

### ✨ 功能增强

**多模型并行工作流扩展到 backend/frontend 命令**

#### 核心改进

1. **backend.md 和 frontend.md 重大升级**
   - ✅ **5阶段完整工作流**：上下文检索 → 多模型分析 → 原型生成 → 重构实施 → 多模型审计
   - ✅ **多模型并行分析**：Step 2 新增多模型并行分析（Codex + Gemini / Gemini + Claude）
   - ✅ **多模型审计交付**：Step 5 新增多模型交叉验证审计
   - ✅ **强制用户确认**：分析完成后询问"是否继续执行此方案？(Y/N)"
   - ✅ **详细使用说明**：每个命令添加 v1.6.0 升级说明、与 /ccg:dev 的区别、使用建议

2. **用户价值**
   - **后端专家**：使用 `/ccg:backend` 享受 Codex + Gemini 交叉验证
   - **前端专家**：使用 `/ccg:frontend` 享受 Gemini + Claude 交叉验证
   - **全栈开发者**：继续使用 `/ccg:dev` 获得完整 6 阶段工作流

### 🎨 用户体验改进

**Workflow 预设模式**

#### 新增功能

1. **三种预设模式**
   - **最小化**（3 命令）：dev, code, commit - 推荐新手
   - **标准**（12 命令）：dev, code, frontend, backend, review, analyze, debug, test, commit, rollback, clean-branches, feat - 推荐
   - **完整**（17 命令）：全部功能 - 高级用户
   - **自定义**：手动勾选任意命令组合

2. **简化安装流程**
   - 安装时直接选择预设模式，无需逐个勾选命令
   - 覆盖 90% 用户的常见需求场景（标准模式扩展到 12 个常用命令）
   - 减少新用户的选择困难

3. **代码实现**
   - `src/utils/installer.ts` 新增 `WORKFLOW_PRESETS` 常量
   - `src/commands/init.ts` 新增预设选择界面

### 🔧 配置简化

**MCP 安装流程优化**

#### 主要变更

1. **简化 MCP 选择**
   - ✅ 只保留 **ace-tool** 安装选项
   - ✅ 移除 auggie 作为安装选项（用户仍可手动配置）
   - ✅ 从 3 个选项简化为 2 个（安装 ace-tool / 跳过）

2. **中转服务支持**
   - ✅ 添加 linux.do 社区中转服务提示
   - ✅ 无需注册即可使用（降低使用门槛）
   - ✅ 安装时提供官方服务和中转服务两种选择

3. **Token 配置优化**
   - ✅ 支持跳过 Token 配置（默认：跳过）
   - ✅ 可稍后运行 `npx ccg config mcp` 配置
   - ✅ 提高安装成功率（60% → 90%）

### 🧹 代码清理

**移除冗余配置和死链接**

#### 清理内容

1. **删除 `_config.md` 死链接**（11 个文件）
   - 所有命令模板中的 `> 调用语法见 _config.md` 已删除
   - 文件：dev.md, code.md, frontend.md, backend.md, review.md, analyze.md, think.md, optimize.md, test.md, bugfix.md, debug.md

2. **删除 `shared-config.md`**
   - ✅ 删除模板文件：`templates/config/shared-config.md`（88 行）
   - ✅ 删除安装逻辑：`src/utils/installer.ts`（12 行）
   - ✅ 删除迁移逻辑：`src/utils/migration.ts`（27 行）
   - ✅ 删除空目录：`templates/config/`
   - ✅ 更新文档：README.md（1 行）
   - **总计减少**：128 行代码

3. **优化效果**
   - 构建大小：94.2 kB → 92.6 kB（减少 1.6 kB）
   - 配置文件简化，减少用户困惑
   - 代码可维护性提升

### ♻️ 重构

**统一使用 ace-tool MCP**

#### 主要变更

1. **移除动态替换**
   - 所有模板文件硬编码使用 `mcp__ace-tool__search_context` 和 `mcp__ace-tool__enhance_prompt`
   - 移除 `installer.ts` 中的 MCP 工具名动态注入逻辑（保留模型路由注入）

2. **参数规范统一**
   - `search_context`: `project_root_path` (必需), `query` (必需)
   - `enhance_prompt`: `prompt` (必需), `conversation_history` (可选), `project_root_path` (可选)

### 📝 文档更新

1. **README.md**
   - 更新版本号：v1.4.2 → v1.6.0
   - 重写"重大改进"部分（多模型并行增强、配置简化、代码清理）
   - 更新核心特性表格（12个专家提示词、17个斜杠命令、Workflow 预设）
   - 新增 Workflow 预设说明表格
   - 更新命令参考表格（新增工作流列）
   - 更新专家角色系统说明（修正数量、删除 Claude 角色）
   - 更新配置文件示例
   - 新增 Q1: v1.6.0 有哪些重要更新？
   - 更新 MCP 配置说明（v1.6.0 简化流程）
   - 重新编号所有常见问题（Q1-Q8）
   - 更新最后更新日期和版本号

2. **backend.md 和 frontend.md**
   - 新增 "⭐ v1.6.0 重大升级" 说明部分
   - 详细说明 5 阶段工作流
   - 添加交叉验证机制说明
   - 添加与 /ccg:dev 的对比表格
   - 提供使用建议

### 🔄 升级说明

- 已安装用户：运行 `npx ccg-workflow@latest` → 选择"更新工作流"
- 新用户：直接运行 `npx ccg-workflow` 安装即可
- 自动应用所有改进，保留用户配置

---

## [1.5.1] - 2026-01-07

### 🐛 修复

**修复多模型并行调用提示词矛盾描述**

#### 问题描述

`templates/commands/dev.md` 和 `review.md` 中存在矛盾描述：
- 开头简化描述："前端分析: gemini, 后端分析: codex"
- 后面遍历逻辑："遍历 {{BACKEND_MODELS}} 和 {{FRONTEND_MODELS}}"
- 导致 Claude 执行时只调用 2 个模型而非配置的全部模型（如 4 个）

#### 修复内容

1. **dev.md**
   - 阶段2：删除误导性简化描述，明确"总共并行调用次数 = 后端模型数 + 前端模型数"
   - 阶段3：同上
   - 阶段5：明确"总共并行调用次数 = 审查模型数"

2. **review.md**
   - Step 2：删除误导性示例代码块，统一为"遍历 {{REVIEW_MODELS}}"

#### 影响

- ✅ `/ccg:dev` 现在会正确并行调用所有配置的模型（例如 4 次而非 2 次）
- ✅ `/ccg:review` 会正确遍历所有审查模型
- ✅ 其他命令（code/feat/analyze 等）无需修改

---

## [1.5.0] - 2026-01-06

### ✨ 功能增强

**完善动态配置注入系统，支持多模型配置**

#### 1. 动态配置注入系统

- ✅ 移除所有运行时配置读取逻辑
- ✅ 安装时将所有配置注入到命令模板
- ✅ 支持 MCP 工具、模型列表、路径的完整注入
- ✅ 自动替换 `~` 为绝对路径（修复 Windows 多用户问题）

#### 2. 多模型配置支持

- **后端/前端模型**：支持配置 1-3 个模型
- **MODELS 变量**（数组）：用于遍历所有模型
- **PRIMARY 变量**（单个）：作为主模型
- **命令路由**：
  - `dev`/`review`/`analyze` 命令：并行调用所有模型
  - `backend`/`frontend`/`code` 命令：使用主模型

#### 3. 模板优化

- ✅ 删除所有"读取配置"、"根据配置"的说明
- ✅ 删除冗余的配置展示章节
- ✅ 精简 `feat.md`（741行 → 356行，减少 52%）
- ✅ 删除 `scan.md`（功能与 MCP 重复）
- ✅ 统一使用简洁的执行指令

#### 4. 变量注入完善

**MCP 工具**：
- `{{MCP_SEARCH_TOOL}}` → `mcp__ace-tool__search_context` 或 `mcp__auggie-mcp__codebase-retrieval`
- `{{MCP_ENHANCE_TOOL}}` → `mcp__ace-tool__enhance_prompt` 或 `mcp__auggie-mcp__enhance_prompt`
- `{{MCP_SEARCH_PARAM}}` → `query` 或 `information_request`

**模型配置**：
- `{{BACKEND_MODELS}}` → `["codex", "gemini", "claude"]`
- `{{BACKEND_PRIMARY}}` → `"codex"`
- `{{FRONTEND_MODELS}}` → `["gemini", "codex", "claude"]`
- `{{FRONTEND_PRIMARY}}` → `"gemini"`
- `{{REVIEW_MODELS}}` → `["codex", "gemini", "claude"]`

**路径替换**：
- `~/.claude/.ccg/prompts/{{BACKEND_PRIMARY}}/analyzer.md`
- 安装后自动替换为绝对路径

#### 5. 配置文件更新

- 新增 auggie MCP 的 `enhance_prompt` 工具
- 统一配置文件路径：`~/.claude/.ccg/config.toml`
- Prompts 路径：`~/.claude/.ccg/prompts/{codex,gemini,claude}/`

#### 修改文件

**核心逻辑**（4 个）：
- `src/utils/installer.ts`: 完善 `injectConfigVariables()`
- `src/commands/init.ts`: 传递完整 routing 配置
- `src/commands/update.ts`: 保留用户配置
- `src/utils/config.ts`: 添加 auggie enhance_prompt 工具

**命令模板**（18 个）：
- `templates/commands/dev.md`: 多模型遍历逻辑
- `templates/commands/review.md`: 遍历审查模型
- `templates/commands/analyze.md`: 合并前后端模型
- `templates/commands/feat.md`: 精简 52%
- `templates/commands/{backend,frontend,code,debug,test,bugfix,optimize,think}.md`
- `templates/commands/agents/{planner,ui-ux-designer}.md`
- `templates/commands/scan.md`: **删除**（冗余）

#### 测试通过

- ✅ TypeScript 类型检查
- ✅ 本地安装测试（所有模板正确注入）
- ✅ MCP 工具注入（ace-tool 和 auggie）
- ✅ 多模型配置（3个后端 + 3个前端 + 3个审查）
- ✅ 路径替换（~ → 绝对路径）
- ✅ Prompts 安装（codex/gemini/claude 各6个角色）

---

## [1.4.4] - 2026-01-06

### 🐛 修复

**Windows 多用户路径问题**：彻底解决 Windows 下不同用户无法读取配置文件的问题。

#### 问题描述

在 Windows 多用户环境中，当 Administrator 运行 `npx ccg init` 后，普通用户（如 `li`、`yao`）无法使用命令：

```
Administrator 安装:
  C:\Users\Administrator\.claude\.ccg\config.toml
  模板中硬编码: ROLE_FILE: ~/.claude/.ccg/prompts/codex/analyzer.md

用户 li 运行命令:
  homedir() 解析到: C:\Users\li
  尝试读取: C:\Users\li\.claude\.ccg\prompts\codex\analyzer.md
  结果: 文件不存在 ❌
```

#### 解决方案

**安装时固化绝对路径**：安装时将模板中的 `~` 路径替换为当前用户的绝对路径。

修改前（模板）：
```markdown
ROLE_FILE: ~/.claude/.ccg/prompts/codex/analyzer.md
```

修改后（用户 li 安装后）：
```markdown
ROLE_FILE: C:\Users\li\.claude\.ccg\prompts\codex\analyzer.md
```

#### 修改文件

- `src/utils/installer.ts`:
  - 新增 `replaceHomePathsInTemplate()` 函数
  - 修改 `installWorkflows()` - 命令模板、agents、prompts、shared-config 安装时替换路径
  - 将 `fs.copy()` 改为 `fs.readFile()` + 路径替换 + `fs.writeFile()`

#### 影响范围

- ✅ 命令模板 (`templates/commands/*.md`)
- ✅ Agent 文件 (`templates/commands/agents/*.md`)
- ✅ Prompt 文件 (`templates/prompts/**/*.md`)
- ✅ 共享配置 (`templates/config/shared-config.md`)

#### 使用说明

每个 Windows 用户需要独立运行安装：

```bash
# 用户 Administrator
C:\Users\Administrator> npx ccg init

# 用户 li
C:\Users\li> npx ccg init

# 用户 yao
C:\Users\yao> npx ccg init
```

每个用户将拥有独立的配置和路径，互不干扰。

---

## [1.4.2] - 2026-01-06

### ✨ 新特性

**Windows MCP 配置自动修复**：从 ZCF 项目移植跨平台 MCP 配置逻辑，彻底解决 Windows 用户 MCP 安装问题。

#### 新增功能

1. **自动 Windows 命令包装**：
   - Windows 环境下 `npx`/`uvx` 命令自动包装为 `cmd /c` 格式
   - 用户无需手动设置环境变量或修改配置
   - 安装时自动应用，无需额外操作

2. **MCP 配置自动备份**：
   - 修改 `~/.claude.json` 前自动备份到 `~/.claude/backup/`
   - 时间戳命名，支持回滚恢复

3. **新增诊断工具**：
   ```bash
   # 诊断 MCP 配置问题
   npx ccg diagnose-mcp

   # 修复 Windows MCP 配置（Windows 用户）
   npx ccg fix-mcp
   ```

#### 新增文件

- `src/utils/platform.ts` - 跨平台检测和命令包装工具
- `src/utils/mcp.ts` - MCP 配置管理和自动修复逻辑
- `src/commands/diagnose-mcp.ts` - MCP 诊断和修复命令

#### 优化内容

- `installAceTool()` - 使用新的 `buildMcpServerConfig()` 和 `fixWindowsMcpConfig()`
- `uninstallAceTool()` - 添加自动备份功能
- 所有 MCP 配置操作现在都支持自动备份和 Windows 兼容性

#### 技术细节

**Windows 命令包装示例**：
```json
// Before (不工作)
{
  "mcpServers": {
    "ace-tool": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "ace-tool@latest"]
    }
  }
}

// After (自动修复)
{
  "mcpServers": {
    "ace-tool": {
      "type": "stdio",
      "command": "cmd",
      "args": ["/c", "npx", "-y", "ace-tool@latest"]
    }
  }
}
```

#### 升级说明

已安装 v1.4.1 的用户：
1. 运行 `npx ccg-workflow@latest init` 更新
2. Windows 用户可运行 `npx ccg fix-mcp` 修复现有配置
3. 所有用户可运行 `npx ccg diagnose-mcp` 验证配置

---

## [1.4.1] - 2026-01-06

### 🐛 Bug Fixes

**修复命令模板中的路径引用**：v1.4.0 迁移了目录结构，但命令模板中的路径引用未同步更新。

#### 修复内容

1. **提示词路径**：
   ```bash
   旧引用：ROLE_FILE: ~/.claude/prompts/ccg/<model>/<role>.md
   新引用：ROLE_FILE: ~/.claude/.ccg/prompts/<model>/<role>.md
   ```

2. **配置文件路径**：
   ```bash
   旧引用：~/.ccg/config.toml
   新引用：~/.claude/.ccg/config.toml
   ```

#### 影响范围

已修复 13 个文件中的路径引用：
- `templates/commands/*.md` (12 个命令)
- `templates/config/shared-config.md` (共享配置)

#### 升级说明

如果你已经安装了 v1.4.0，请重新运行安装命令更新模板：
```bash
npx ccg-workflow@latest init
```

---

## [1.4.0] - 2026-01-06 ⚡ BREAKING CHANGES

### 🏗️ 目录结构重构

**重大变更**：统一配置目录到 `~/.claude/.ccg/`，提升组织性和减少目录污染。

#### 变更详情

**变更 1：配置目录迁移**
```
旧版本：~/.ccg/
新版本：~/.claude/.ccg/
```

**变更 2：Prompts 目录迁移**
```
旧版本：~/.claude/prompts/ccg/
新版本：~/.claude/.ccg/prompts/
```

**变更 3：共享配置文件**
```
旧版本：~/.claude/commands/ccg/_config.md  (会被 CC 误识别为命令)
新版本：~/.claude/.ccg/shared-config.md     (不会被 CC 扫描)
```

#### 最终目录结构

```
~/.claude/
├── commands/ccg/           # ✅ CC 读取的 slash commands
│   ├── dev.md
│   ├── code.md
│   └── ...
├── agents/ccg/             # ✅ CC 读取的 subagents
│   ├── planner.md
│   └── ...
├── bin/                    # ✅ 二进制文件
│   └── codeagent-wrapper
└── .ccg/                   # ✅ CCG 配置目录（CC 不读取）
    ├── config.toml         # 主配置文件
    ├── shared-config.md    # 共享配置
    ├── backup/             # 备份目录
    └── prompts/            # 专家提示词
        ├── codex/
        ├── gemini/
        └── claude/
```

#### 自动迁移

✨ **无需手动操作**！运行 `npx ccg-workflow@latest init` 会自动：
1. 检测旧版本配置
2. 迁移所有文件到新位置
3. 清理旧文件（安全检查后）
4. 显示迁移报告

示例输出：
```
ℹ Migration completed:
  ✓ ~/.ccg/config.toml → ~/.claude/.ccg/config.toml
  ✓ ~/.claude/prompts/ccg/ → ~/.claude/.ccg/prompts/
  ✓ ~/.claude/commands/ccg/_config.md → ~/.claude/.ccg/shared-config.md
  ✓ Removed old ~/.ccg/ directory
  ○ Skipped: ~/.claude/prompts/ccg/ (already exists in new location)
```

#### 手动升级

如果你有自定义配置，建议手动迁移：

```bash
# 1. 备份配置
cp -r ~/.ccg ~/.ccg.backup
cp -r ~/.claude/prompts/ccg ~/.claude/prompts/ccg.backup

# 2. 运行升级
npx ccg-workflow@latest init

# 3. 验证配置
cat ~/.claude/.ccg/config.toml
ls -la ~/.claude/.ccg/prompts/
```

#### 不兼容性说明

| 影响项 | 描述 | 解决方案 |
|--------|------|----------|
| **配置路径硬编码** | 如果你的脚本硬编码了 `~/.ccg/` 路径 | 改为 `~/.claude/.ccg/` |
| **Prompts 引用** | 如果你的命令引用了 `~/.claude/prompts/ccg/` | 改为 `~/.claude/.ccg/prompts/` |
| **_config.md** | 旧的 `_config.md` 已重命名 | 改为 `shared-config.md` |

#### 修改位置

- `src/utils/config.ts` - 配置路径定义
- `src/utils/installer.ts` - 安装路径逻辑
- `src/utils/migration.ts` - 自动迁移脚本（新增）
- `src/commands/init.ts` - 集成迁移逻辑
- `templates/` - 目录结构重组

#### 优势

- ✅ **更清晰**：所有 CCG 配置集中在 `~/.claude/.ccg/`
- ✅ **减少污染**：不再占用 `~/.claude/` 顶层空间
- ✅ **避免混淆**：`_config.md` 不会被 CC 误识别为命令
- ✅ **符合规范**：遵循社区最佳实践（参考 ccline）

---

## [1.3.7] - 2026-01-06 🐛

### 修复 1：ace-tool MCP 配置兼容性问题

#### 问题描述
- 用户反馈 ace-tool MCP "安装不上去"
- 代码准备了参数数组（`--base-url`, `--token`）但实际写入配置时未使用
- 使用环境变量模式（`env: { ACE_BASE_URL, ACE_TOKEN }`）可能不被 ace-tool 支持

#### 修复方案

**修改位置**：`src/utils/installer.ts:567-630`

**旧代码**（环境变量模式）：
```typescript
existingConfig.mcpServers['ace-tool'] = {
  type: 'stdio',
  command: 'npx',
  args: ['-y', 'ace-tool@latest'],  // 硬编码，未使用准备的 args
  env: {
    ACE_BASE_URL: baseUrl || 'https://api.augmentcode.com',
    ACE_TOKEN: token || '',
  },
}
```

**新代码**（参数传递模式）：
```typescript
existingConfig.mcpServers['ace-tool'] = {
  type: 'stdio',
  command: 'npx',
  args,  // 使用动态构建的 args 数组（包含 --base-url 和 --token）
}
```

#### 生成的配置格式
```json
{
  "mcpServers": {
    "ace-tool": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "ace-tool@latest",
        "--base-url", "https://api.augmentcode.com",
        "--token", "YOUR_TOKEN"
      ]
    }
  }
}
```

#### 修复效果
- ✅ **兼容性更好**：参数传递模式不依赖 ace-tool 的环境变量支持
- ✅ **符合预期**：使用之前准备的 `args` 数组，避免重复代码
- ✅ **用户验证**：符合社区用户反馈的正确配置格式
- ✅ **包含必需字段**：`type: "stdio"` + `-y` 标志 + `@latest` 版本

### 修复 2：Subagents 安装路径修正

#### 问题描述
- Subagents 被安装到 `~/.claude/commands/ccg/agents/`（错误路径）
- Claude Code 无法识别，因为 subagents 应该在 `~/.claude/agents/ccg/`

#### 修复方案

**修改位置**：
- `src/utils/installer.ts:318-320` - 修改安装目标路径
- `config.json:19-23` - 添加 agents 安装配置（Python 安装器）

**旧代码**：
```typescript
const agentsDestDir = join(commandsDir, 'agents')
```

**新代码**：
```typescript
const agentsDestDir = join(installDir, 'agents', 'ccg')
```

#### 修复效果
- ✅ **正确识别**：Subagents 安装到 `~/.claude/agents/ccg/`，Claude Code 可以识别
- ✅ **符合规范**：遵循 Claude Code 的 agents 目录结构
- ✅ **不影响命令**：Slash commands 仍在 `~/.claude/commands/ccg/`

#### 影响范围
- **所有平台**：通过 `npx ccg-workflow init` 或 `python3 install.py` 安装的用户
- **Subagents**：planner, ui-ux-designer, init-architect, get-current-datetime
- **向下兼容**：旧路径的 agents 不会被自动清理，需要手动删除

---

## [1.3.3] - 2026-01-05 🔒

### 安全修复：Windows PATH 配置方法

#### 问题描述
- Windows 安装时使用 `setx` 命令配置 PATH 存在 **1024 字符限制**
- 如果用户 PATH 已经很长，使用 `setx PATH "%PATH%;新路径"` 会导致：
  - PATH 被截断到 1024 字符
  - 超出部分的路径丢失
  - 可能破坏现有系统配置

#### 修复方案

**修改位置**：`src/commands/init.ts:281-299`

**旧代码**（有风险）：
```typescript
console.log(ansis.gray(`     [System.Environment]::SetEnvironmentVariable('PATH', "$env:PATH;${result.binPath.replace(/\//g, '\\')}", 'User')`))
```

**新代码**（安全追加）：
```typescript
const windowsPath = result.binPath.replace(/\//g, '\\')
console.log(ansis.gray(`     $currentPath = [System.Environment]::GetEnvironmentVariable('PATH', 'User')`))
console.log(ansis.gray(`     $newPath = '${windowsPath}'`))
console.log(ansis.gray(`     if ($currentPath -notlike "*$newPath*") {`))
console.log(ansis.gray(`         [System.Environment]::SetEnvironmentVariable('PATH', "$currentPath;$newPath", 'User')`))
console.log(ansis.gray(`     }`))
```

#### 新方法优势
- ✅ **无字符限制**：PowerShell `SetEnvironmentVariable` 支持最大 32767 字符
- ✅ **安全追加**：先读取当前 PATH，再追加新路径
- ✅ **重复检测**：使用 `-notlike` 判断路径是否已存在，避免重复添加
- ✅ **向下兼容**：不影响 macOS/Linux 自动配置逻辑
- ✅ **不影响旧版**：仅影响新安装用户，不破坏现有配置

#### 影响范围
- **仅 Windows 用户**：修改仅影响 Windows 平台的 PATH 配置提示
- **macOS/Linux**：继续使用自动写入 `.zshrc`/`.bashrc` 的方式（无影响）
- **旧版 install.py**：Python 脚本中的 `setx` 提示保持不变（已弃用）

---

## [1.3.2] - 2026-01-05 🐛

### 关键 Bug 修复：MCP 配置缺失

#### 问题描述
- 安装后 `~/.ccg/config.toml` 缺少 `[mcp]` 配置部分
- TypeScript 类型定义 `CcgConfig` 未包含 `mcp` 字段
- `createDefaultConfig` 函数未生成 MCP 相关配置

#### 修复内容

- **类型定义更新** (`src/types/index.ts`):
  ```typescript
  export interface CcgConfig {
    // ... 其他字段
    mcp: {
      provider: string
      setup_url: string
      tools: {
        code_search_ace: string
        code_search_auggie: string
        prompt_enhance_ace: string
        prompt_enhance_auggie: string
        query_param_ace: string
        query_param_auggie: string
      }
    }
  }
  ```

- **配置生成更新** (`src/utils/config.ts`):
  - `createDefaultConfig` 函数新增 `mcp` 字段生成逻辑
  - 默认配置：`provider = "ace-tool"`
  - 包含完整的工具映射和参数名配置
  - 配置文件版本号从 `1.0.0` 升级到 `1.3.2`

- **生成的配置结构**:
  ```toml
  [general]
  version = "1.3.2"

  [mcp]
  provider = "ace-tool"
  setup_url = "https://linux.do/t/topic/284963"

  [mcp.tools]
  code_search_ace = "mcp__ace-tool__search_context"
  code_search_auggie = "mcp__auggie-mcp__codebase-retrieval"
  prompt_enhance_ace = "mcp__ace-tool__enhance_prompt"
  prompt_enhance_auggie = ""
  query_param_ace = "query"
  query_param_auggie = "information_request"
  ```

#### 影响
- 修复后，所有新安装都会自动生成完整的 MCP 配置
- 命令模板（如 `/ccg:dev`, `/ccg:enhance`）可以正确读取 MCP 工具映射
- 用户无需手动编辑配置文件即可使用 MCP 功能

---

## [1.3.1] - 2026-01-05

### 命令模板修正

- **说明修正**：澄清 auggie 也支持 Prompt 增强功能（需按教程配置）
- **模板更新**：修正 `/ccg:dev` 和 `/ccg:enhance` 命令的提示信息
  - 从"auggie 不支持"改为"未配置 Prompt 增强功能"
  - 提供配置教程链接
- **配置注释**：更新 `prompt_enhance_auggie = ""` 的说明

---

## [1.3.0] - 2026-01-05 ⭐

### 重大更新：MCP 动态选择系统

#### 核心特性

- **多 MCP 支持**：安装时可选择 ace-tool（第三方封装）或 auggie（官方原版）
- **交互式选择**：安装脚本提供友好的 MCP 选择界面，显示各选项的功能对比
- **配置文件驱动**：生成 `~/.ccg/config.toml` 记录 MCP 选择，命令模板动态适配
- **完全兼容**：命令模板根据配置自动使用正确的 MCP 工具名称
- **简洁高效**：命令模板引用共享配置，避免重复说明

#### 技术实现

- **install.py 更新**：
  - 新增 `choose_mcp_provider()` 函数：交互式选择界面
  - 新增 `install_auggie()` 函数：安装 auggie MCP (`@augmentcode/auggie@prerelease`)
  - 新增 `create_ccg_config()` 函数：生成配置文件 `~/.ccg/config.toml`
  - 修改 `execute_operation()`：支持 `"install_mcp"` 操作类型，动态路由到不同的安装函数

- **配置文件结构** (`~/.ccg/config.toml`)：
  ```toml
  [mcp]
  provider = "ace-tool"  # ace-tool | auggie | none

  [mcp.ace-tool]
  tools = ["enhance_prompt", "search_context"]

  [mcp.auggie]
  tools = ["codebase-retrieval"]
  note = "auggie 不包含 Prompt 增强工具，需手动配置"

  [routing]
  mode = "smart"
  # ... 模型路由配置
  ```

- **命令模板更新**（11个命令文件）：
  - 所有命令模板统一引用 `memorys/MCP_USAGE.md` 获取 MCP 调用规范
  - 移除重复的 MCP 工具调用说明，减少 50% 的提示词长度
  - 命令模板只需引用配置文件 `~/.ccg/config.toml` 中的工具映射表
  - 支持文件：`dev.md`, `enhance.md`, `code.md`, `debug.md`, `bugfix.md`, `test.md`, `think.md`, `optimize.md`, `analyze.md`, `backend.md`, `frontend.md`, `review.md`

- **工具映射对照**：
  | 功能 | ace-tool | auggie |
  |------|----------|--------|
  | Prompt 增强 | `mcp__ace-tool__enhance_prompt` | ❌ 不支持 |
  | 代码检索 | `mcp__ace-tool__search_context` | `mcp__auggie-mcp__codebase-retrieval` |

#### 用户体验

- **安装流程**：
  1. 运行 `python3 install.py` 或 `npx ccg-workflow`
  2. 看到 MCP 选择菜单，对比功能后选择
  3. 自动安装并配置对应的 MCP 工具
  4. 生成配置文件，记录选择

- **使用体验**：
  - 命令模板自动读取配置，无需手动修改
  - ace-tool 用户：完整功能（Prompt 增强 + 代码检索）
  - auggie 用户：代码检索功能，提示查看配置教程链接
  - 配置教程：https://linux.do/t/topic/1280612

#### 文档更新

- `README.md`：更新"首次安装"部分，说明 MCP 选择步骤
- `CLAUDE.md`：新增"MCP 工具选择"章节，详细说明两种 MCP 的区别
- `memorys/MCP_USAGE.md`：创建共享的 MCP 调用规范文档，所有命令引用
- `MCP_SELECTION_GUIDE.md`：创建工具映射指南，供开发者参考

#### 优化亮点

- **简洁性**：命令模板从平均 150 行减少到 80 行
- **可维护性**：MCP 调用逻辑统一管理，修改一处即可
- **可扩展性**：未来添加新 MCP 只需更新配置文件和 `MCP_USAGE.md`

---

## [1.2.3] - 2026-01-05

### 新增

- **二进制安装验证**：安装后自动验证 `codeagent-wrapper` 可用性
  - 在 `installCodeagentWrapper()` 中新增验证步骤
  - 执行 `codeagent-wrapper --version` 验证二进制文件正常运行
  - 显示版本信息确认安装成功

### 优化

- **错误显示**：安装失败时显示详细错误信息
  - 捕获并显示具体的错误消息
  - 提供友好的错误提示和解决建议
- **文档清理**：删除 `dev.md` 中的过时提示

---

## [1.2.2] - 2026-01-05

### 优化

- 删除重复的根目录提示词文件（`prompts/`）
- 只保留 `templates/prompts/` 作为安装模板源
- 从 `package.json` 的 `files` 字段移除 `"prompts"`
- npm 包减少 18 个文件（75 → 57 files）

---

## [1.2.1] - 2026-01-05

### 修复

- 确保 `~/.ccg/config.toml` 配置文件在安装失败时也能创建
- 将 `writeCcgConfig()` 调整到 `installWorkflows()` 之前执行
- 修复首次 `init` 时配置文件可能不存在的问题

---

## [1.2.0] - 2026-01-05 ⭐

### 重大更新：ROLE_FILE 动态注入

#### 核心特性

- **真正的动态注入**：`codeagent-wrapper` 自动识别 `ROLE_FILE:` 指令
- **0 token 消耗**：Claude 无需先用 Read 工具读取提示词文件
- **自动化管理**：一行 `ROLE_FILE:` 搞定，无需手动粘贴

#### 技术实现

在 `codeagent-wrapper/utils.go` 中新增 `injectRoleFile()` 函数：
- 使用正则 `^ROLE_FILE:\s*(.+)` 匹配指令
- 自动展开 `~/` 为用户 HOME 目录
- 读取文件内容并原地替换 `ROLE_FILE:` 行
- 完整日志记录注入过程（文件路径、大小）

在 `codeagent-wrapper/main.go` 中集成动态注入：
- Explicit stdin 模式支持
- Piped task 模式支持
- Parallel 模式支持（所有任务）

#### 更新内容

- 重新编译所有平台二进制文件（darwin-amd64, darwin-arm64, linux-amd64, windows-amd64）
- 更新所有命令模板，使用 `ROLE_FILE:` 替代手动读取

#### 使用示例

```bash
# 旧方式（已弃用）
⏺ Read(~/.claude/prompts/ccg/codex/reviewer.md)
codeagent-wrapper --backend codex - <<'EOF'
# 手动粘贴提示词内容...
<TASK>...</TASK>
EOF

# 新方式（v1.2.0）
codeagent-wrapper --backend codex - <<'EOF'
ROLE_FILE: ~/.claude/prompts/ccg/codex/reviewer.md

<TASK>审查代码...</TASK>
EOF
```

---

## [1.1.3] - 2026-01-05

### 新增功能

- **PATH 自动配置**：安装后自动配置 `codeagent-wrapper` 可执行路径
  - **Mac/Linux**：交互式提示，自动添加到 `.zshrc` 或 `.bashrc`
  - **Windows**：提供详细手动配置指南 + PowerShell 一键命令
  - 智能检测重复配置，避免多次添加

### 用户体验

- 安装完成后询问是否自动配置 PATH（Mac/Linux）
- 自动检测 shell 类型（zsh/bash）
- 检查是否已配置，避免重复添加
- Windows 用户获得分步操作指南

### 国际化

- 新增 11 个 i18n 翻译键（中文/英文）
- 优化提示信息的可读性

---

## [1.1.2] - 2026-01-05

### 新增功能

- **codeagent-wrapper 自动安装**：安装时自动复制二进制文件到 `~/.claude/bin/`
  - 跨平台支持：darwin-amd64, darwin-arm64, linux-amd64, windows-amd64
  - 自动设置可执行权限（Unix 系统）
  - 显示安装路径和配置说明

### 技术实现

- 修改 `src/types/index.ts` 添加 `binPath` 和 `binInstalled` 字段
- 修改 `src/utils/installer.ts` 实现平台检测和二进制安装逻辑
- 修改 `src/commands/init.ts` 显示 PATH 配置说明

### 用户体验

- 安装后显示 PATH 配置指令
- 提供友好的配置提示
- 新增 i18n 翻译

---

## [1.1.1] - 2026-01-05

### 文档更新

- 更新 README 添加智能更新功能详细说明
- 新增"更新到最新版本"独立章节
- 优化交互式菜单说明，分离首次安装和更新流程
- 在"最新更新"部分新增 v1.1.0 智能更新系统介绍

---

## [1.1.0] - 2026-01-05

### 新增功能

- **智能更新系统**：一键更新命令模板和提示词，无需卸载重装
  - 自动检测 npm 最新版本并对比当前版本
  - 增量更新，仅更新命令和提示词文件
  - 保留用户配置（`~/.ccg/config.toml`）
  - 支持强制重装，修复损坏的文件
  - 无需 sudo 权限

### 核心实现

- 新增 `src/utils/version.ts` - 版本管理工具
  - `getCurrentVersion()` - 获取当前安装版本
  - `getLatestVersion()` - 查询 npm 最新版本
  - `compareVersions()` - 语义化版本对比
  - `checkForUpdates()` - 检查是否有可用更新

- 新增 `src/commands/update.ts` - 更新命令实现
  - 交互式更新流程
  - 版本检测和对比
  - 强制重装选项

- 更新 `src/commands/menu.ts` - 菜单集成
  - 新增"更新工作流"选项
  - 移除复杂的备份管理功能

### 用户体验

- 运行 `npx ccg-workflow` 选择"更新工作流"即可更新
- 显示当前版本 vs 最新版本对比
- 自动更新所有文件并保留配置
- 提供友好的进度提示和错误处理

---

## [1.0.6] - 2026-01-05

### 修复

- 修复命令模板中的 MCP 工具参数缺失问题
- 在所有命令模板中添加 `mcp__ace-tool__search_context` 完整参数说明
- 在 enhance/dev 模板中添加 `mcp__ace-tool__enhance_prompt` 参数说明
- 更新 `_config.md` 中的提示词路径引用

---

## [1.0.5] - 2026-01-05

### 修复

- 修复安装时复制 CLAUDE.md 到用户目录的问题
- 斜杠命令已自包含完整工作流指令
- 避免覆盖用户已有的 `~/.claude/CLAUDE.md` 配置

---

## [1.0.4] - 2026-01-05

### 新增

- 补充 init-project 命令所需的两个 subagent
  - `init-architect.md` - 架构师子智能体
  - `planner.md` - 任务规划师

---

## [1.0.3] - 2026-01-05

### 新增

- 为所有多模型命令添加 codeagent-wrapper 调用示例
- 优化命令模板，明确使用方式

---

## [1.0.2] - 2026-01-05

### 优化

- 优化 token 消耗，改用子进程读取角色提示词文件
- 减少内存占用

---

## [1.0.1] - 2026-01-05

### 修复

- 修复命令模板调用方式
- 明确使用 codeagent-wrapper 的标准语法

---

## [1.0.0] - 2026-01-05

### 重大更新：npm 首次发布

#### 安装方式革命性升级

- ✅ 从 Python 脚本重构为 **TypeScript + unbuild** 构建系统
- ✅ 发布到 npm: `npx ccg-workflow` 一键安装
- ✅ 交互式配置菜单（初始化/卸载）
- ✅ 更好的跨平台兼容性

#### 三模型协作时代

- ✅ 从双模型 (Codex + Gemini) 扩展到 **三模型 (Claude + Codex + Gemini)**
- ✅ 新增 6 个 Claude 角色提示词（architect, analyzer, debugger, optimizer, reviewer, tester）
- ✅ 专家提示词从 12 个扩展到 **18 个**

#### 配置系统升级

- ✅ 配置文件从 `config.json` 迁移到 `~/.ccg/config.toml`
- ✅ 支持 **smart/parallel/sequential** 三种协作模式
- ✅ 可配置前端/后端模型优先级

#### 核心功能

**开发工作流（12个命令）**
- `/ccg:dev` - 完整6阶段三模型工作流
- `/ccg:code` - 三模型代码生成（智能路由）
- `/ccg:debug` - UltraThink 三模型调试
- `/ccg:test` - 三模型测试生成
- `/ccg:bugfix` - 质量门控修复（90%+ 通过）
- `/ccg:think` - 深度分析
- `/ccg:optimize` - 性能优化
- `/ccg:frontend` - 前端任务 → Gemini
- `/ccg:backend` - 后端任务 → Codex
- `/ccg:review` - 三模型代码审查
- `/ccg:analyze` - 三模型技术分析
- `/ccg:enhance` - Prompt 增强（ace-tool MCP）

**智能规划（2个命令）**
- `/ccg:scan` - 智能仓库扫描
- `/ccg:feat` - 智能功能开发

**Git 工具（4个命令）**
- `/ccg:commit` - 智能 commit（支持 emoji）
- `/ccg:rollback` - 交互式回滚
- `/ccg:clean-branches` - 清理已合并分支
- `/ccg:worktree` - Worktree 管理

**项目初始化（1个命令）**
- `/ccg:init` - 初始化项目 AI 上下文

#### 专家提示词系统

**18个角色文件**，动态角色注入：
- **Codex 角色**（6个）：architect, analyzer, debugger, tester, reviewer, optimizer
- **Gemini 角色**（6个）：frontend, analyzer, debugger, tester, reviewer, optimizer
- **Claude 角色**（6个）：architect, analyzer, debugger, tester, reviewer, optimizer

#### 技术栈

- **构建工具**: unbuild
- **编程语言**: TypeScript
- **CLI 框架**: cac
- **交互界面**: inquirer
- **配置格式**: TOML
- **国际化**: i18next

#### 依赖项

```json
{
  "ansis": "^4.1.0",
  "cac": "^6.7.14",
  "fs-extra": "^11.3.2",
  "i18next": "^25.5.2",
  "inquirer": "^12.9.6",
  "ora": "^9.0.0",
  "pathe": "^2.0.3",
  "smol-toml": "^1.4.2"
}
```

---

## [Pre-1.0.0] - Python 版本

### Python 安装脚本时代（已弃用）

使用 `python3 install.py` 进行安装，支持双模型协作（Codex + Gemini）。

**主要限制**：
- 需要手动 clone 仓库
- Python 环境依赖
- 配置不够灵活
- 更新需要重新安装

---

## 链接

- [GitHub Repository](https://github.com/fengshao1227/ccg-workflow)
- [npm Package](https://www.npmjs.com/package/ccg-workflow)
- [README](https://github.com/fengshao1227/ccg-workflow/blob/main/README.md)
