# codeagent-wrapper (Go CLI Wrapper)

> [根目录](../CLAUDE.md) > **codeagent-wrapper**

**Last Updated**: 2026-08-28
**Binary Version**: v5.15.0
**Go Version**: 1.21+（`go.mod:1`）

---

## 模块职责

`codeagent-wrapper` 是用 Go 编写的跨平台 CLI 包装器，通过 `Backend` 接口 + `backendRegistry` 工厂将 **7 种 AI CLI 后端**（Codex / Gemini / Claude / Grok / Kimi / OpenCode / Antigravity）统一成一个标准接口。CCG 工作流系统中的 20+ 个斜杠命令通过调用它来执行多模型协作任务——Claude 作为编排层，codeagent-wrapper 负责实际派发、执行、输出解析和会话管理。

---

## 入口与启动

- **主入口**：`main.go:120` — `main()` 调用 `run()` 获取退出码
- **可执行文件**：
  - macOS/Linux：`codeagent-wrapper`
  - Windows：`codeagent-wrapper.exe`

### CLI 调用语法

```bash
# 单任务模式（新会话）
codeagent-wrapper [--backend <codex|gemini|claude>] "任务文本" [工作目录]

# stdin 模式（处理含换行/特殊字符的任务）
codeagent-wrapper [--backend <codex|gemini|claude>] - [工作目录] <<'EOF'
任务文本
EOF

# 会话恢复
codeagent-wrapper resume <session_id> "任务文本" [工作目录]
codeagent-wrapper resume <session_id> - [工作目录]

# 并行模式（从 stdin 读取多任务配置）
codeagent-wrapper --parallel [--backend <name>] [--full-output] < tasks.txt

# 其他
codeagent-wrapper --version
codeagent-wrapper --cleanup
```

### 参数说明

| Flag | 说明 | 默认值 |
|------|------|--------|
| `--backend <name>` | 指定后端：`codex`、`gemini`、`claude` | `codex` |
| `--gemini-model <name>` | Gemini 型号（仅 gemini 后端有效） | 空（后端默认） |
| `--progress` | 向 stderr 输出紧凑进度行 | 关 |
| `--with-mcp` | 让子代理加载 MCP servers。默认跳过：grok/kimi 走影子 HOME（v3.3.0），codex 注入 `-c mcp_servers={}`、gemini 注入哨兵 allowlist（v5.15.0） | 关 |
| `--lite` / `-L` | 精简模式：关闭 Web UI，加快响应 | 关 |
| `--parallel` | 并行模式，从 stdin 读取多任务配置 | — |
| `--full-output` | 并行模式输出完整消息（传统模式） | 关（默认摘要） |
| `--skip-permissions` | 跳过权限提示（claude 后端） | 关 |
| `--version` / `-v` | 打印版本 | — |
| `--help` / `-h` | 打印帮助 | — |
| `--cleanup` | 清理过期日志文件 | — |

### 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `CODEX_TIMEOUT` | 超时毫秒数（>10000）或秒数 | 7200s |
| `CODEX_REQUIRE_APPROVAL` | 启用文件操作审批 | false |
| `CODEX_DISABLE_SKIP_GIT_CHECK` | 禁止跳过 Git 仓库检查 | false |
| `CODEAGENT_ASCII_MODE` | 使用 ASCII 状态符（PASS/WARN/FAIL） | false |
| `CODEAGENT_LITE_MODE` | 精简模式 | false |
| `CODEAGENT_POST_MESSAGE_DELAY` | agent_message 后等待秒数（0-60） | 5s |
| `CODEAGENT_MAX_PARALLEL_WORKERS` | 并行 worker 上限（0=不限） | 0 |
| `GEMINI_MODEL` | Gemini 型号（低优先级，CLI 参数覆盖） | 空 |

### 退出码

| 码 | 含义 |
|----|------|
| 0 | 成功 |
| 1 | 通用错误（参数缺失、无输出） |
| 124 | 超时 |
| 127 | 后端命令不在 PATH |
| 130 | 用户中断（Ctrl+C） |
| 其他 | 后端进程退出码透传 |

---

## 对外接口

### 后端抽象层（`backend.go`）

`Backend` 接口（`backend.go:13`）定义三个方法：

```go
type Backend interface {
    Name()     string
    Command()  string
    BuildArgs(cfg *Config, targetArg string) []string
}
```

已注册后端（`config.go:75` 的 `backendRegistry` map + `selectBackend()` 工厂）：

| 后端 | 命令 | 参数构建函数 |
|------|------|------|
| `codex` | `codex` | `buildCodexArgs()` |
| `gemini` | `gemini` | `buildGeminiArgs()` |
| `claude` | `claude` | `buildClaudeArgs()` |
| `grok` | `grok`（PATH 回退 `~/.grok/bin/grok`） | `buildGrokArgs()` |
| `kimi` | `kimi` | `buildKimiArgs()` |
| `opencode` | `opencode` | `buildOpencodeArgs()` |
| `antigravity` / `agy` | `agy` | `buildAntigravityArgs()` |

**加一个后端**：主路径干净 —— 在 `backend.go` 写个 struct 实现 `Backend` 三方法 + 在 `config.go` 的 `backendRegistry` 注册一行即可。此外需手动碰约 12 处后端字符串特判：`server.go`（SSE 输出格式，~4 处）、`executor.go`（stdin/prompt 传递方式 `line 877-878`、`case "codex"` `line 1018`，~4 处）、`main.go`（flag 校验，~4 处）。`parser.go` 已统一（靠 JSON 事件形状识别后端，0 处特判）。若加后端变频繁，可给 `Backend` 接口加 `PromptMode()` / `SSEFormat()` 把这 12 处也收编——半天~1 天渐进重构，非大工程。

### stdin 传递协议

当任务文本包含以下特殊字符时自动切换 stdin 模式（`main.go:22`）：
- 换行 `\n`、反斜杠 `\`、双引号 `"`、单引号 `'`、反引号 `` ` ``、`$`
- 或任务文本长度 > 800 字符

Gemini 平台差异（`executor.go:864`）：
- **macOS/Linux**：`-p "<任务文本>"` 直接传参（execve 保留多行 argv）
- **Windows**：omit `-p`，通过 stdin pipe 传入（cmd.exe 会截断多行参数，Issue #129）

### 并行任务配置格式（`config.go:109`）

```
---TASK---
id: task-a
workdir: /path/to/project
backend: codex
dependencies: task-b,task-c
---CONTENT---
任务内容文本
---TASK---
id: task-b
---CONTENT---
另一个任务内容
```

支持依赖拓扑排序（`executor.go:287`）：同层无依赖任务并行，跨层串行。

### Session 管理

- 后端执行完成后返回 `SESSION_ID`（写入 stdout 末尾 + 提前写入 stderr）
- 恢复模式：`resume <session_id>` 参数
- 并行模式每个任务独立 session，互不干扰

### WebServer SSE 流（`server.go`）

默认模式（非 `--lite`）启动一个本地 HTTP 服务（随机端口），通过 SSE 实时推送后端输出到浏览器页面，方便观察长任务进度。精简模式（`--lite`）跳过此机制。

---

## 源码结构

### 入口层

| 文件 | 职责 |
|------|------|
| `main.go` | CLI 入口、参数路由、模式分发（单任务/并行/cleanup） |
| `config.go` | `Config` / `TaskSpec` / `TaskResult` 结构体定义；`parseArgs()`；并行配置解析 |

### 后端抽象层

| 文件 | 职责 |
|------|------|
| `backend.go` | `Backend` 接口；7 个实现 `CodexBackend` / `GeminiBackend` / `ClaudeBackend` / `GrokBackend` / `KimiBackend` / `OpencodeBackend` / `AntigravityBackend`；各自 `buildXxxArgs()`；`loadMinimalEnvSettings()` 读取 `~/.claude/settings.json` 注入环境变量 |

### 执行层

| 文件 | 职责 |
|------|------|
| `executor.go` | `runCodexTaskWithContext()`——核心执行引擎；`commandRunner` 接口（可测试抽象）；并发调度 `executeConcurrentWithContext()`；拓扑排序 `topologicalSort()`；进程终止 `terminateCommand()` / `killProcessTree()`；并行输出报告 `generateFinalOutputWithMode()` |
| `utils.go` | `resolveTimeout()`；输出提取辅助函数（coverage / files / tests / key output） |

### 日志层

| 文件 | 职责 |
|------|------|
| `logger.go` | 异步 Logger（buffered channel + 单 worker goroutine）；日志文件创建于 `os.TempDir()`；`cleanupOldLogs()` 清理过期日志 |

### 解析层

| 文件 | 职责 |
|------|------|
| `parser.go` | `parseJSONStreamInternal()`——流式解析 Codex / Claude / Gemini JSON 事件；提取 `agent_message`、`session_id`；支持进度回调 `onProgressCallback`、session 回调 `onSessionStartedCallback` |
| `filter.go` | `filteringWriter`——过滤 stderr 噪声行（`[STARTUP]`、`YOLO mode`、Node.js warning 等） |

### 服务层

| 文件 | 职责 |
|------|------|
| `server.go` | SSE Web Server；`WebServer` 结构体；`StartSession()` / `EndSession()` / `SendContentWithType()`；浏览器实时预览后端输出 |

### 平台适配层

| 文件 | 构建约束 | 职责 |
|------|----------|------|
| `process_check_unix.go` | `unix \|\| darwin \|\| linux` | `isProcessRunning()`（`syscall.Signal(0)`）；`getProcessStartTime()`（解析 `/proc/<pid>/stat`） |
| `process_check_windows.go` | `windows` | `isProcessRunning()`（`kernel32.dll` + `GetExitCodeProcess`）；`getProcessStartTime()`（`GetProcessTimes` WinAPI） |
| `windows_console.go` | `windows` | `hideWindowsConsole()`——`CREATE_NO_WINDOW`（`0x08000000`）防止 taskkill 弹出 CMD 窗口 |
| `windows_console_unix.go` | `!windows` | `hideWindowsConsole()` 空实现 |

### 名称层

| 文件 | 职责 |
|------|------|
| `wrapper_name.go` | `currentWrapperName()`——解析当前二进制名（支持 symlink 别名）；向后兼容 `codex-wrapper` 旧名；日志文件名前缀 |

---

## 测试矩阵

共 17 个测试文件，源码/测试比约 1.2:1，覆盖场景：

| 测试文件 | 覆盖场景 |
|----------|----------|
| `main_test.go` | `run()` 主流程、flag 解析、退出码 |
| `main_integration_test.go` | 端到端集成：stdin 模式、会话恢复、后端切换 |
| `backend_test.go` | 三个 Backend 的 `BuildArgs()` 输出验证；环境变量注入 |
| `executor_concurrent_test.go` | 并发执行、拓扑排序、依赖跳过、worker 限流 |
| `concurrent_stress_test.go` | 高并发压力：100+ goroutine 并发调度稳定性 |
| `bench_test.go` | 基准测试：并行执行吞吐量、输出格式化性能 |
| `logger_test.go` | Logger 基础：写入、Flush、Close、行序 |
| `logger_suffix_test.go` | `NewLoggerWithSuffix()` 文件命名、防冲突 |
| `logger_additional_coverage_test.go` | Logger 边界：满 channel、并发写入、日志限流 |
| `log_writer_limit_test.go` | `logWriter` 行数限制；截断保护（`codexLogLineLimit`） |
| `parser_token_too_long_test.go` | 超长 JSON 行（10MB 上限）的截断和错误处理 |
| `parser_unknown_event_test.go` | 未知 event type 的降级处理、非 JSON 行跳过 |
| `filter_test.go` | `filteringWriter` 噪声过滤准确性；边界（半行、大块写入） |
| `process_check_test.go` | `isProcessRunning()` 跨平台行为；僵尸进程检测 |
| `wrapper_name_test.go` | 二进制名解析、symlink 别名、Windows .exe 后缀去除 |
| `path_normalization_test.go` | 工作目录路径规范化（相对路径、`~`、Windows 盘符） |
| `utils_test.go` | `resolveTimeout()` 解析规则；输出提取辅助函数 |

---

## 构建与发布

### 本地编译

```bash
cd codeagent-wrapper
go build -o codeagent-wrapper .         # 当前平台
go test ./...                            # 运行所有测试
```

### 交叉编译（`build-all.sh`）

```bash
cd codeagent-wrapper
bash build-all.sh
# 输出到 ../bin/：
#   codeagent-wrapper-darwin-amd64
#   codeagent-wrapper-darwin-arm64
#   codeagent-wrapper-linux-amd64
#   codeagent-wrapper-linux-arm64
#   codeagent-wrapper-windows-amd64.exe
#   codeagent-wrapper-windows-arm64.exe
```

### CI 自动构建

推送包含 `codeagent-wrapper/` 变更的 commit 后，`.github/workflows/build-binaries.yml` 自动：
1. 交叉编译 6 个平台二进制
2. 上传到 GitHub Release
3. 同步至 Cloudflare R2 镜像（国内加速）

**⛔ 禁止手动 `gh release upload`**——手动上传会覆盖 CI 产物且 R2 不同步。

---

## 版本同步规则（⚠ 强约束）

修改任何 `.go` 文件后必须同步 bump 两处版本号，缺一不可：

| 文件 | 位置 | 当前值 |
|------|------|--------|
| `codeagent-wrapper/main.go` | `version = "..."` （`main.go:17`） | `5.15.0` |
| `src/utils/installer.ts` | `EXPECTED_BINARY_VERSION = '...'` | `5.15.0` |

两边不一致的后果：用户运行 `npx ccg-workflow update` 时无法触发 binary 重新下载，继续使用旧版 binary。

---

## 平台兼容性

| 平台 | 架构 | 产物 | 特殊处理 |
|------|------|------|----------|
| macOS | amd64 | `codeagent-wrapper-darwin-amd64` | — |
| macOS | arm64 | `codeagent-wrapper-darwin-arm64` | — |
| Linux | amd64 | `codeagent-wrapper-linux-amd64` | 静态链接，无 GLIBC 运行时依赖 |
| Linux | arm64 | `codeagent-wrapper-linux-arm64` | 静态链接 |
| Windows | amd64 | `codeagent-wrapper-windows-amd64.exe` | Gemini stdin pipe；taskkill /T 进程树；隐藏 CMD 窗口 |
| Windows | arm64 | `codeagent-wrapper-windows-arm64.exe` | 同上 |

---

## 依赖

```
module codeagent-wrapper
go 1.21
```

**无任何第三方依赖**，仅使用 Go 标准库。优势：零 CVE 供应链风险、二进制体积小、交叉编译无需 CGO（除 Windows WinAPI 调用通过 `syscall.NewLazyDLL` 动态加载）。

---

## 关键设计决策

### 1. 为什么选 Go 而非 Node.js

Codex / Gemini CLI 本身都是 Node.js。用 Go 编写 wrapper 的核心原因：
- **无运行时依赖**：Node.js wrapper 需要在用户机器上安装 Node；Go 编译为独立二进制，开箱即用。
- **原生并发**：goroutine 天然适合同时管理多个后端进程的 stdout/stderr 读取、超时、信号转发。
- **进程控制精细**：`syscall.SIGTERM`、`os.Process.Kill()`、Windows `taskkill /T` 进程树终止，Go 的 `os/exec` 提供精准控制。

### 2. 为什么自己做 Session 管理

CCG 工作流需要跨会话恢复（`resume <session_id>`）。wrapper 通过解析 JSON 流中的 `thread_id` / `session_id` 字段提前写入 stderr（`executor.go:1083`），即使任务超时也能捕获 session ID，供后续恢复使用。

### 3. Windows 专属问题链

Windows cmd.exe 环境存在多个已知 bug，wrapper 针对性修复：
- **多行参数截断**（Issue #129）：Gemini `-p` 参数在 cmd.exe 转发时被截断为第一行，改用 stdin pipe 绕过（`executor.go:864`）
- **子进程持有 stdout handle**：Codex CLI 会 spawn Node.js worker，taskkill `/T` 才能终止整棵进程树（`executor.go:1421`）
- **stdout 缓冲**：Git Bash 后台模式缓冲 stdout，`os.Stdout.Sync()` 强制刷出（`main.go:496`）
- **CMD 窗口闪烁**：`CREATE_NO_WINDOW` 标志抑制 taskkill 弹出 CMD（`windows_console.go:14`）

### 4. Gemini `.env` 隔离

Gemini CLI 从 CWD 向上扫描 `.env` 文件加载，会覆盖全局 API Key。wrapper 通过 `loadMinimalEnvSettings()` 从 `~/.claude/settings.json` 提取 env 字段并注入，同时将项目目录通过 `--include-directories` 传入而非设为 CWD（`backend.go:43`）。

### 5. 依赖注入测试设计

`main.go` 定义全局可替换函数变量（`main.go:41`）：
```go
var (
    buildCodexArgsFn   = buildCodexArgs
    selectBackendFn    = selectBackend
    commandContext     = exec.CommandContext
    runTaskFn          = runCodexTask
    exitFn             = os.Exit
    ...
)
```
测试文件替换这些变量注入 mock，无需 fork 真实后端进程，保证测试隔离性和速度。

---

**扫描覆盖率**: 95%+
**最后更新**: 2026-04-10
