package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

// resolvePostMessageDelay returns the delay duration after receiving agent_message
// before terminating the backend process. This delay allows the backend to send
// completion events (turn.completed/thread.completed) which may arrive after the message.
// Default: 5 seconds (increased from 1s to fix Windows Codex completion detection)
// Lite mode: 1 second (faster response)
// Override via CODEAGENT_POST_MESSAGE_DELAY environment variable (in seconds)
func resolvePostMessageDelay() time.Duration {
	// Lite mode uses faster delay
	if liteMode {
		return 1 * time.Second
	}

	raw := strings.TrimSpace(os.Getenv("CODEAGENT_POST_MESSAGE_DELAY"))
	if raw == "" {
		return 5 * time.Second // Default: 5 seconds
	}

	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 {
		logWarn(fmt.Sprintf("Invalid CODEAGENT_POST_MESSAGE_DELAY=%q, falling back to 5s", raw))
		return 5 * time.Second
	}

	if value > 60 {
		logWarn(fmt.Sprintf("CODEAGENT_POST_MESSAGE_DELAY=%d exceeds 60s, capping at 60s", value))
		return 60 * time.Second
	}

	return time.Duration(value) * time.Second
}

// commandRunner abstracts exec.Cmd for testability
type commandRunner interface {
	Start() error
	Wait() error
	StdoutPipe() (io.ReadCloser, error)
	StdinPipe() (io.WriteCloser, error)
	SetStderr(io.Writer)
	SetDir(string)
	SetEnv(env map[string]string)
	Process() processHandle
}

// processHandle abstracts os.Process for testability
type processHandle interface {
	Pid() int
	Kill() error
	Signal(os.Signal) error
}

// realCmd implements commandRunner using exec.Cmd
type realCmd struct {
	cmd *exec.Cmd
}

func (r *realCmd) Start() error {
	if r.cmd == nil {
		return errors.New("command is nil")
	}
	return r.cmd.Start()
}

func (r *realCmd) Wait() error {
	if r.cmd == nil {
		return errors.New("command is nil")
	}
	return r.cmd.Wait()
}

func (r *realCmd) StdoutPipe() (io.ReadCloser, error) {
	if r.cmd == nil {
		return nil, errors.New("command is nil")
	}
	return r.cmd.StdoutPipe()
}

func (r *realCmd) StdinPipe() (io.WriteCloser, error) {
	if r.cmd == nil {
		return nil, errors.New("command is nil")
	}
	return r.cmd.StdinPipe()
}

func (r *realCmd) SetStderr(w io.Writer) {
	if r.cmd != nil {
		r.cmd.Stderr = w
	}
}

func (r *realCmd) SetDir(dir string) {
	if r.cmd != nil {
		r.cmd.Dir = dir
	}
}

func (r *realCmd) SetEnv(env map[string]string) {
	if r == nil || r.cmd == nil || len(env) == 0 {
		return
	}

	merged := make(map[string]string, len(env)+len(os.Environ()))
	for _, kv := range os.Environ() {
		if kv == "" {
			continue
		}
		idx := strings.IndexByte(kv, '=')
		if idx <= 0 {
			continue
		}
		merged[kv[:idx]] = kv[idx+1:]
	}
	for _, kv := range r.cmd.Env {
		if kv == "" {
			continue
		}
		idx := strings.IndexByte(kv, '=')
		if idx <= 0 {
			continue
		}
		merged[kv[:idx]] = kv[idx+1:]
	}
	for k, v := range env {
		if strings.TrimSpace(k) == "" {
			continue
		}
		merged[k] = v
	}

	keys := make([]string, 0, len(merged))
	for k := range merged {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	out := make([]string, 0, len(keys))
	for _, k := range keys {
		out = append(out, k+"="+merged[k])
	}
	r.cmd.Env = out
}

func (r *realCmd) Process() processHandle {
	if r == nil || r.cmd == nil || r.cmd.Process == nil {
		return nil
	}
	return &realProcess{proc: r.cmd.Process}
}

// realProcess implements processHandle using os.Process
type realProcess struct {
	proc *os.Process
}

func (p *realProcess) Pid() int {
	if p == nil || p.proc == nil {
		return 0
	}
	return p.proc.Pid
}

func (p *realProcess) Kill() error {
	if p == nil || p.proc == nil {
		return nil
	}
	return p.proc.Kill()
}

func (p *realProcess) Signal(sig os.Signal) error {
	if p == nil || p.proc == nil {
		return nil
	}
	return p.proc.Signal(sig)
}

// newCommandRunner creates a new commandRunner (test hook injection point)
var newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
	return &realCmd{cmd: commandContext(ctx, name, args...)}
}

type parseResult struct {
	message  string
	threadID string
}

type taskLoggerContextKey struct{}

func withTaskLogger(ctx context.Context, logger *Logger) context.Context {
	if ctx == nil || logger == nil {
		return ctx
	}
	return context.WithValue(ctx, taskLoggerContextKey{}, logger)
}

func taskLoggerFromContext(ctx context.Context) *Logger {
	if ctx == nil {
		return nil
	}
	logger, _ := ctx.Value(taskLoggerContextKey{}).(*Logger)
	return logger
}

type taskLoggerHandle struct {
	logger  *Logger
	path    string
	shared  bool
	closeFn func()
}

func newTaskLoggerHandle(taskID string) taskLoggerHandle {
	taskLogger, err := NewLoggerWithSuffix(taskID)
	if err == nil {
		return taskLoggerHandle{
			logger:  taskLogger,
			path:    taskLogger.Path(),
			closeFn: func() { _ = taskLogger.Close() },
		}
	}

	msg := fmt.Sprintf("Failed to create task logger for %s: %v, using main logger", taskID, err)
	mainLogger := activeLogger()
	if mainLogger != nil {
		logWarn(msg)
		return taskLoggerHandle{
			logger: mainLogger,
			path:   mainLogger.Path(),
			shared: true,
		}
	}

	fmt.Fprintln(os.Stderr, msg)
	return taskLoggerHandle{}
}

// defaultRunCodexTaskFn is the default implementation of runCodexTaskFn (exposed for test reset)
func defaultRunCodexTaskFn(task TaskSpec, timeout int) TaskResult {
	if task.WorkDir == "" {
		task.WorkDir = defaultWorkdir
	}
	if task.Mode == "" {
		task.Mode = "new"
	}
	if task.UseStdin || shouldUseStdin(task.Task, false) {
		task.UseStdin = true
	}

	backendName := task.Backend
	if backendName == "" {
		backendName = defaultBackendName
	}

	backend, err := selectBackendFn(backendName)
	if err != nil {
		return TaskResult{TaskID: task.ID, ExitCode: 1, Error: err.Error()}
	}
	task.Backend = backend.Name()

	parentCtx := task.Context
	if parentCtx == nil {
		parentCtx = context.Background()
	}
	return runCodexTaskWithContext(parentCtx, task, backend, nil, false, true, timeout)
}

var runCodexTaskFn = defaultRunCodexTaskFn

func topologicalSort(tasks []TaskSpec) ([][]TaskSpec, error) {
	idToTask := make(map[string]TaskSpec, len(tasks))
	indegree := make(map[string]int, len(tasks))
	adj := make(map[string][]string, len(tasks))

	for _, task := range tasks {
		idToTask[task.ID] = task
		indegree[task.ID] = 0
	}

	for _, task := range tasks {
		for _, dep := range task.Dependencies {
			if _, ok := idToTask[dep]; !ok {
				return nil, fmt.Errorf("dependency %q not found for task %q", dep, task.ID)
			}
			indegree[task.ID]++
			adj[dep] = append(adj[dep], task.ID)
		}
	}

	queue := make([]string, 0, len(tasks))
	for _, task := range tasks {
		if indegree[task.ID] == 0 {
			queue = append(queue, task.ID)
		}
	}

	layers := make([][]TaskSpec, 0)
	processed := 0

	for len(queue) > 0 {
		current := queue
		queue = nil
		layer := make([]TaskSpec, len(current))
		for i, id := range current {
			layer[i] = idToTask[id]
			processed++
		}
		layers = append(layers, layer)

		next := make([]string, 0)
		for _, id := range current {
			for _, neighbor := range adj[id] {
				indegree[neighbor]--
				if indegree[neighbor] == 0 {
					next = append(next, neighbor)
				}
			}
		}
		queue = append(queue, next...)
	}

	if processed != len(tasks) {
		cycleIDs := make([]string, 0)
		for id, deg := range indegree {
			if deg > 0 {
				cycleIDs = append(cycleIDs, id)
			}
		}
		sort.Strings(cycleIDs)
		return nil, fmt.Errorf("cycle detected involving tasks: %s", strings.Join(cycleIDs, ","))
	}

	return layers, nil
}

func executeConcurrent(layers [][]TaskSpec, timeout int) []TaskResult {
	maxWorkers := resolveMaxParallelWorkers()
	return executeConcurrentWithContext(context.Background(), layers, timeout, maxWorkers)
}

func executeConcurrentWithContext(parentCtx context.Context, layers [][]TaskSpec, timeout int, maxWorkers int) []TaskResult {
	totalTasks := 0
	for _, layer := range layers {
		totalTasks += len(layer)
	}

	results := make([]TaskResult, 0, totalTasks)
	failed := make(map[string]TaskResult, totalTasks)
	resultsCh := make(chan TaskResult, totalTasks)

	var startPrintMu sync.Mutex
	bannerPrinted := false

	printTaskStart := func(taskID, logPath string, shared bool) {
		if logPath == "" {
			return
		}
		startPrintMu.Lock()
		if !bannerPrinted {
			fmt.Fprintln(os.Stderr, "=== Starting Parallel Execution ===")
			bannerPrinted = true
		}
		label := "Log"
		if shared {
			label = "Log (shared)"
		}
		fmt.Fprintf(os.Stderr, "Task %s: %s: %s\n", taskID, label, logPath)
		startPrintMu.Unlock()
	}

	ctx := parentCtx
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	workerLimit := maxWorkers
	if workerLimit < 0 {
		workerLimit = 0
	}

	var sem chan struct{}
	if workerLimit > 0 {
		sem = make(chan struct{}, workerLimit)
	}

	logConcurrencyPlanning(workerLimit, totalTasks)

	acquireSlot := func() bool {
		if sem == nil {
			return true
		}
		select {
		case sem <- struct{}{}:
			return true
		case <-ctx.Done():
			return false
		}
	}

	releaseSlot := func() {
		if sem == nil {
			return
		}
		select {
		case <-sem:
		default:
		}
	}

	var activeWorkers int64

	for _, layer := range layers {
		var wg sync.WaitGroup
		executed := 0

		for _, task := range layer {
			if skip, reason := shouldSkipTask(task, failed); skip {
				res := TaskResult{TaskID: task.ID, ExitCode: 1, Error: reason}
				results = append(results, res)
				failed[task.ID] = res
				continue
			}

			if ctx.Err() != nil {
				res := cancelledTaskResult(task.ID, ctx)
				results = append(results, res)
				failed[task.ID] = res
				continue
			}

			executed++
			wg.Add(1)
			go func(ts TaskSpec) {
				defer wg.Done()
				var taskLogPath string
				handle := taskLoggerHandle{}
				defer func() {
					if r := recover(); r != nil {
						resultsCh <- TaskResult{TaskID: ts.ID, ExitCode: 1, Error: fmt.Sprintf("panic: %v", r), LogPath: taskLogPath, sharedLog: handle.shared}
					}
				}()

				if !acquireSlot() {
					resultsCh <- cancelledTaskResult(ts.ID, ctx)
					return
				}
				defer releaseSlot()

				current := atomic.AddInt64(&activeWorkers, 1)
				logConcurrencyState("start", ts.ID, int(current), workerLimit)
				defer func() {
					after := atomic.AddInt64(&activeWorkers, -1)
					logConcurrencyState("done", ts.ID, int(after), workerLimit)
				}()

				handle = newTaskLoggerHandle(ts.ID)
				taskLogPath = handle.path
				if handle.closeFn != nil {
					defer handle.closeFn()
				}

				taskCtx := ctx
				if handle.logger != nil {
					taskCtx = withTaskLogger(ctx, handle.logger)
				}
				ts.Context = taskCtx

				printTaskStart(ts.ID, taskLogPath, handle.shared)

				res := runCodexTaskFn(ts, timeout)
				if taskLogPath != "" {
					if res.LogPath == "" || (handle.shared && handle.logger != nil && res.LogPath == handle.logger.Path()) {
						res.LogPath = taskLogPath
					}
				}
				// 只有当最终的 LogPath 确实是共享 logger 的路径时才标记为 shared
				if handle.shared && handle.logger != nil && res.LogPath == handle.logger.Path() {
					res.sharedLog = true
				}
				resultsCh <- res
			}(task)
		}

		wg.Wait()

		for i := 0; i < executed; i++ {
			res := <-resultsCh
			results = append(results, res)
			if res.ExitCode != 0 || res.Error != "" {
				failed[res.TaskID] = res
			}
		}
	}

	return results
}

func cancelledTaskResult(taskID string, ctx context.Context) TaskResult {
	exitCode := 130
	msg := "execution cancelled"
	if ctx != nil && errors.Is(ctx.Err(), context.DeadlineExceeded) {
		exitCode = 124
		msg = "execution timeout"
	}
	return TaskResult{TaskID: taskID, ExitCode: exitCode, Error: msg}
}

func shouldSkipTask(task TaskSpec, failed map[string]TaskResult) (bool, string) {
	if len(task.Dependencies) == 0 {
		return false, ""
	}

	var blocked []string
	for _, dep := range task.Dependencies {
		if _, ok := failed[dep]; ok {
			blocked = append(blocked, dep)
		}
	}

	if len(blocked) == 0 {
		return false, ""
	}

	return true, fmt.Sprintf("skipped due to failed dependencies: %s", strings.Join(blocked, ","))
}

// getStatusSymbols returns status symbols based on ASCII mode.
func getStatusSymbols() (success, warning, failed string) {
	if os.Getenv("CODEAGENT_ASCII_MODE") == "true" {
		return "PASS", "WARN", "FAIL"
	}
	return "✓", "⚠️", "✗"
}

func generateFinalOutput(results []TaskResult) string {
	return generateFinalOutputWithMode(results, true) // default to summary mode
}

// generateFinalOutputWithMode generates output based on mode
// summaryOnly=true: structured report - every token has value
// summaryOnly=false: full output with complete messages (legacy behavior)
func generateFinalOutputWithMode(results []TaskResult, summaryOnly bool) string {
	var sb strings.Builder
	successSymbol, warningSymbol, failedSymbol := getStatusSymbols()

	reportCoverageTarget := defaultCoverageTarget
	for _, res := range results {
		if res.CoverageTarget > 0 {
			reportCoverageTarget = res.CoverageTarget
			break
		}
	}

	// Count results by status
	success := 0
	failed := 0
	belowTarget := 0
	for _, res := range results {
		if res.ExitCode == 0 && res.Error == "" {
			success++
			target := res.CoverageTarget
			if target <= 0 {
				target = reportCoverageTarget
			}
			if res.Coverage != "" && target > 0 && res.CoverageNum < target {
				belowTarget++
			}
		} else {
			failed++
		}
	}

	if summaryOnly {
		// Header
		sb.WriteString("=== Execution Report ===\n")
		sb.WriteString(fmt.Sprintf("%d tasks | %d passed | %d failed", len(results), success, failed))
		if belowTarget > 0 {
			sb.WriteString(fmt.Sprintf(" | %d below %.0f%%", belowTarget, reportCoverageTarget))
		}
		sb.WriteString("\n\n")

		// Task Results - each task gets: Did + Files + Tests + Coverage
		sb.WriteString("## Task Results\n")

		for _, res := range results {
			taskID := sanitizeOutput(res.TaskID)
			coverage := sanitizeOutput(res.Coverage)
			keyOutput := sanitizeOutput(res.KeyOutput)
			logPath := sanitizeOutput(res.LogPath)
			filesChanged := sanitizeOutput(strings.Join(res.FilesChanged, ", "))

			target := res.CoverageTarget
			if target <= 0 {
				target = reportCoverageTarget
			}

			isSuccess := res.ExitCode == 0 && res.Error == ""
			isBelowTarget := isSuccess && coverage != "" && target > 0 && res.CoverageNum < target

			if isSuccess && !isBelowTarget {
				// Passed task: one block with Did/Files/Tests
				sb.WriteString(fmt.Sprintf("\n### %s %s", taskID, successSymbol))
				if coverage != "" {
					sb.WriteString(fmt.Sprintf(" %s", coverage))
				}
				sb.WriteString("\n")

				if keyOutput != "" {
					sb.WriteString(fmt.Sprintf("Did: %s\n", keyOutput))
				}
				if len(res.FilesChanged) > 0 {
					sb.WriteString(fmt.Sprintf("Files: %s\n", filesChanged))
				}
				if res.TestsPassed > 0 {
					sb.WriteString(fmt.Sprintf("Tests: %d passed\n", res.TestsPassed))
				}
				if logPath != "" {
					sb.WriteString(fmt.Sprintf("Log: %s\n", logPath))
				}

			} else if isSuccess && isBelowTarget {
				// Below target: add Gap info
				sb.WriteString(fmt.Sprintf("\n### %s %s %s (below %.0f%%)\n", taskID, warningSymbol, coverage, target))

				if keyOutput != "" {
					sb.WriteString(fmt.Sprintf("Did: %s\n", keyOutput))
				}
				if len(res.FilesChanged) > 0 {
					sb.WriteString(fmt.Sprintf("Files: %s\n", filesChanged))
				}
				if res.TestsPassed > 0 {
					sb.WriteString(fmt.Sprintf("Tests: %d passed\n", res.TestsPassed))
				}
				// Extract what's missing from coverage
				gap := sanitizeOutput(extractCoverageGap(res.Message))
				if gap != "" {
					sb.WriteString(fmt.Sprintf("Gap: %s\n", gap))
				}
				if logPath != "" {
					sb.WriteString(fmt.Sprintf("Log: %s\n", logPath))
				}

			} else {
				// Failed task: show error detail
				sb.WriteString(fmt.Sprintf("\n### %s %s FAILED\n", taskID, failedSymbol))
				sb.WriteString(fmt.Sprintf("Exit code: %d\n", res.ExitCode))
				if errText := sanitizeOutput(res.Error); errText != "" {
					sb.WriteString(fmt.Sprintf("Error: %s\n", errText))
				}
				// Show context from output (last meaningful lines)
				detail := sanitizeOutput(extractErrorDetail(res.Message, 300))
				if detail != "" {
					sb.WriteString(fmt.Sprintf("Detail: %s\n", detail))
				}
				if logPath != "" {
					sb.WriteString(fmt.Sprintf("Log: %s\n", logPath))
				}
			}
		}

		// Summary section
		sb.WriteString("\n## Summary\n")
		sb.WriteString(fmt.Sprintf("- %d/%d completed successfully\n", success, len(results)))

		if belowTarget > 0 || failed > 0 {
			var needFix []string
			var needCoverage []string
			for _, res := range results {
				if res.ExitCode != 0 || res.Error != "" {
					taskID := sanitizeOutput(res.TaskID)
					reason := sanitizeOutput(res.Error)
					if reason == "" && res.ExitCode != 0 {
						reason = fmt.Sprintf("exit code %d", res.ExitCode)
					}
					reason = safeTruncate(reason, 50)
					needFix = append(needFix, fmt.Sprintf("%s (%s)", taskID, reason))
					continue
				}

				target := res.CoverageTarget
				if target <= 0 {
					target = reportCoverageTarget
				}
				if res.Coverage != "" && target > 0 && res.CoverageNum < target {
					needCoverage = append(needCoverage, sanitizeOutput(res.TaskID))
				}
			}
			if len(needFix) > 0 {
				sb.WriteString(fmt.Sprintf("- Fix: %s\n", strings.Join(needFix, ", ")))
			}
			if len(needCoverage) > 0 {
				sb.WriteString(fmt.Sprintf("- Coverage: %s\n", strings.Join(needCoverage, ", ")))
			}
		}

	} else {
		// Legacy full output mode
		sb.WriteString("=== Parallel Execution Summary ===\n")
		sb.WriteString(fmt.Sprintf("Total: %d | Success: %d | Failed: %d\n\n", len(results), success, failed))

		for _, res := range results {
			taskID := sanitizeOutput(res.TaskID)
			sb.WriteString(fmt.Sprintf("--- Task: %s ---\n", taskID))
			if res.Error != "" {
				sb.WriteString(fmt.Sprintf("Status: FAILED (exit code %d)\nError: %s\n", res.ExitCode, sanitizeOutput(res.Error)))
			} else if res.ExitCode != 0 {
				sb.WriteString(fmt.Sprintf("Status: FAILED (exit code %d)\n", res.ExitCode))
			} else {
				sb.WriteString("Status: SUCCESS\n")
			}
			if res.Coverage != "" {
				sb.WriteString(fmt.Sprintf("Coverage: %s\n", sanitizeOutput(res.Coverage)))
			}
			if res.SessionID != "" {
				sb.WriteString(fmt.Sprintf("Session: %s\n", sanitizeOutput(res.SessionID)))
			}
			if res.LogPath != "" {
				logPath := sanitizeOutput(res.LogPath)
				if res.sharedLog {
					sb.WriteString(fmt.Sprintf("Log: %s (shared)\n", logPath))
				} else {
					sb.WriteString(fmt.Sprintf("Log: %s\n", logPath))
				}
			}
			if res.Message != "" {
				message := sanitizeOutput(res.Message)
				if message != "" {
					sb.WriteString(fmt.Sprintf("\n%s\n", message))
				}
			}
			sb.WriteString("\n")
		}
	}

	return sb.String()
}

func buildCodexArgs(cfg *Config, targetArg string) []string {
	if cfg == nil {
		panic("buildCodexArgs: nil config")
	}

	var resumeSessionID string
	isResume := cfg.Mode == "resume"
	if isResume {
		resumeSessionID = strings.TrimSpace(cfg.SessionID)
		if resumeSessionID == "" {
			logError("invalid config: resume mode requires non-empty session_id")
			isResume = false
		}
	}

	args := []string{"e"}

	if envFlagEnabled("CODEX_BYPASS_SANDBOX") {
		logWarn("CODEX_BYPASS_SANDBOX=true: running without approval/sandbox protection")
		args = append(args, "--dangerously-bypass-approvals-and-sandbox")
	}

	// Skip git repo check by default, but allow users to disable it if it causes API auth issues
	if !envFlagEnabled("CODEX_DISABLE_SKIP_GIT_CHECK") {
		args = append(args, "--skip-git-repo-check")
	}

	if isResume {
		return append(args,
			"--json",
			"resume",
			resumeSessionID,
			targetArg,
		)
	}

	return append(args,
		"-C", cfg.WorkDir,
		"--json",
		targetArg,
	)
}

func runCodexTask(taskSpec TaskSpec, silent bool, timeoutSec int) TaskResult {
	return runCodexTaskWithContext(context.Background(), taskSpec, nil, nil, false, silent, timeoutSec)
}

func runCodexProcess(parentCtx context.Context, codexArgs []string, taskText string, useStdin bool, timeoutSec int) (message, threadID string, exitCode int) {
	res := runCodexTaskWithContext(parentCtx, TaskSpec{Task: taskText, WorkDir: defaultWorkdir, Mode: "new", UseStdin: useStdin}, nil, codexArgs, true, false, timeoutSec)
	return res.Message, res.SessionID, res.ExitCode
}

func runCodexTaskWithContext(parentCtx context.Context, taskSpec TaskSpec, backend Backend, customArgs []string, useCustomArgs bool, silent bool, timeoutSec int) TaskResult {
	if parentCtx == nil {
		parentCtx = taskSpec.Context
	}
	if parentCtx == nil {
		parentCtx = context.Background()
	}

	result := TaskResult{TaskID: taskSpec.ID}
	injectedLogger := taskLoggerFromContext(parentCtx)
	logger := injectedLogger

	cfg := &Config{
		Mode:      taskSpec.Mode,
		Task:      taskSpec.Task,
		SessionID: taskSpec.SessionID,
		WorkDir:   taskSpec.WorkDir,
		Backend:   defaultBackendName,
	}

	commandName := codexCommand
	argsBuilder := buildCodexArgsFn
	if backend != nil {
		commandName = backend.Command()
		argsBuilder = backend.BuildArgs
		cfg.Backend = backend.Name()
	} else if taskSpec.Backend != "" {
		cfg.Backend = taskSpec.Backend
	} else if commandName != "" {
		cfg.Backend = commandName
	}

	if cfg.Mode == "" {
		cfg.Mode = "new"
	}
	if cfg.WorkDir == "" {
		cfg.WorkDir = defaultWorkdir
	}

	if cfg.Mode == "resume" && strings.TrimSpace(cfg.SessionID) == "" {
		result.ExitCode = 1
		result.Error = "resume mode requires non-empty session_id"
		return result
	}

	useStdin := taskSpec.UseStdin
	targetArg := taskSpec.Task
	if useStdin {
		targetArg = "-"
	}

	var codexArgs []string
	if useCustomArgs {
		codexArgs = customArgs
	} else {
		codexArgs = argsBuilder(cfg, targetArg)
	}

	// Start WebServer for this task (single-panel, random port, short-lived)
	// Skip in lite mode for better performance
	var webSessionID string
	if !liteMode && globalWebServer == nil {
		globalWebServer = NewWebServer(cfg.Backend)
		if err := globalWebServer.Start(); err != nil {
			logWarn(fmt.Sprintf("Failed to start web server: %v", err))
		}
	}

	// Generate a unique session ID for WebServer tracking
	if !liteMode && globalWebServer != nil {
		randBytes := make([]byte, 4)
		rand.Read(randBytes)
		webSessionID = fmt.Sprintf("%s-%d-%s", cfg.Backend, time.Now().UnixMilli(), hex.EncodeToString(randBytes))
		globalWebServer.StartSession(webSessionID, cfg.Backend, taskSpec.Task)
	}

	prefixMsg := func(msg string) string {
		if taskSpec.ID == "" {
			return msg
		}
		return fmt.Sprintf("[Task: %s] %s", taskSpec.ID, msg)
	}

	var logInfoFn func(string)
	var logWarnFn func(string)
	var logErrorFn func(string)

	if silent {
		// Silent mode: only persist to file when available; avoid stderr noise.
		logInfoFn = func(msg string) {
			if logger != nil {
				logger.Info(prefixMsg(msg))
			}
		}
		logWarnFn = func(msg string) {
			if logger != nil {
				logger.Warn(prefixMsg(msg))
			}
		}
		logErrorFn = func(msg string) {
			if logger != nil {
				logger.Error(prefixMsg(msg))
			}
		}
	} else {
		logInfoFn = func(msg string) { logInfo(prefixMsg(msg)) }
		logWarnFn = func(msg string) { logWarn(prefixMsg(msg)) }
		logErrorFn = func(msg string) { logError(prefixMsg(msg)) }
	}

	stderrBuf := &tailBuffer{limit: stderrCaptureLimit}

	var stdoutLogger *logWriter
	var stderrLogger *logWriter

	var tempLogger *Logger
	if logger == nil && silent && activeLogger() == nil {
		if l, err := NewLogger(); err == nil {
			setLogger(l)
			tempLogger = l
			logger = l
		}
	}
	defer func() {
		if tempLogger != nil {
			_ = closeLogger()
		}
	}()
	defer func() {
		if result.LogPath != "" || logger == nil {
			return
		}
		result.LogPath = logger.Path()
	}()
	if logger == nil {
		logger = activeLogger()
	}
	if logger != nil {
		result.LogPath = logger.Path()
	}

	if !silent {
		// Note: Empty prefix ensures backend output is logged as-is without any wrapper format.
		// This preserves the original stdout/stderr content from codex/claude/gemini backends.
		// Trade-off: Reduces distinguishability between stdout/stderr in logs, but maintains
		// output fidelity which is critical for debugging backend-specific issues.
		stdoutLogger = newLogWriter("", codexLogLineLimit)
		stderrLogger = newLogWriter("", codexLogLineLimit)
	}

	ctx := parentCtx
	ctx, cancel := context.WithTimeout(ctx, time.Duration(timeoutSec)*time.Second)
	defer cancel()
	ctx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	attachStderr := func(msg string) string {
		return fmt.Sprintf("%s; stderr: %s", msg, stderrBuf.String())
	}

	cmd := newCommandRunner(ctx, commandName, codexArgs...)

	if cfg.Backend == "claude" {
		if env := loadMinimalEnvSettings(); len(env) > 0 {
			cmd.SetEnv(env)
		}
	}

	// For backends that don't support -C flag (claude, gemini), set working directory via cmd.Dir
	// Codex passes workdir via -C flag, so we skip setting Dir for it to avoid conflicts
	if cfg.Mode != "resume" && commandName != "codex" && cfg.WorkDir != "" {
		cmd.SetDir(cfg.WorkDir)
	}

	stderrWriters := []io.Writer{stderrBuf}
	if stderrLogger != nil {
		stderrWriters = append(stderrWriters, stderrLogger)
	}

	// Filter noisy stderr output for all backends
	var stderrFilter *filteringWriter
	if !silent {
		stderrFilter = newFilteringWriter(os.Stderr, noisePatterns)
		defer stderrFilter.Flush()
		stderrWriters = append([]io.Writer{stderrFilter}, stderrWriters...)
	}
	if len(stderrWriters) == 1 {
		cmd.SetStderr(stderrWriters[0])
	} else {
		cmd.SetStderr(io.MultiWriter(stderrWriters...))
	}

	var stdinPipe io.WriteCloser
	var err error
	if useStdin {
		stdinPipe, err = cmd.StdinPipe()
		if err != nil {
			logErrorFn("Failed to create stdin pipe: " + err.Error())
			result.ExitCode = 1
			result.Error = attachStderr("failed to create stdin pipe: " + err.Error())
			return result
		}
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		logErrorFn("Failed to create stdout pipe: " + err.Error())
		result.ExitCode = 1
		result.Error = attachStderr("failed to create stdout pipe: " + err.Error())
		return result
	}

	stdoutReader := io.Reader(stdout)
	if stdoutLogger != nil {
		stdoutReader = io.TeeReader(stdout, stdoutLogger)
	}

	// Start parse goroutine BEFORE starting the command to avoid race condition
	// where fast-completing commands close stdout before parser starts reading
	messageSeen := make(chan struct{}, 1)
	completeSeen := make(chan struct{}, 1)
	parseCh := make(chan parseResult, 1)

	// Create onContent callback for streaming to WebServer
	var onContentCallback func(content, contentType string)
	if globalWebServer != nil && webSessionID != "" {
		sessionID := webSessionID
		backendName := cfg.Backend
		onContentCallback = func(content, contentType string) {
			globalWebServer.SendContentWithType(sessionID, backendName, content, contentType)
		}
	}

	go func() {
		msg, tid := parseJSONStreamInternalWithContent(stdoutReader, logWarnFn, logInfoFn, func() {
			select {
			case messageSeen <- struct{}{}:
			default:
			}
		}, func() {
			select {
			case completeSeen <- struct{}{}:
			default:
			}
			// Notify WebServer that session is complete
			if globalWebServer != nil && webSessionID != "" {
				globalWebServer.EndSession(webSessionID, cfg.Backend)
			}
		}, onContentCallback)
		select {
		case completeSeen <- struct{}{}:
		default:
		}
		parseCh <- parseResult{message: msg, threadID: tid}
	}()

	logInfoFn(fmt.Sprintf("Starting %s with args: %s %s...", commandName, commandName, strings.Join(codexArgs[:min(5, len(codexArgs))], " ")))

	if err := cmd.Start(); err != nil {
		if strings.Contains(err.Error(), "executable file not found") {
			msg := fmt.Sprintf("%s command not found in PATH", commandName)
			logErrorFn(msg)
			result.ExitCode = 127
			result.Error = attachStderr(msg)
			return result
		}
		logErrorFn("Failed to start " + commandName + ": " + err.Error())
		result.ExitCode = 1
		result.Error = attachStderr("failed to start " + commandName + ": " + err.Error())
		return result
	}

	logInfoFn(fmt.Sprintf("Starting %s with PID: %d", commandName, cmd.Process().Pid()))
	if logger != nil {
		logInfoFn(fmt.Sprintf("Log capturing to: %s", logger.Path()))
	}

	if useStdin && stdinPipe != nil {
		logInfoFn(fmt.Sprintf("Writing %d chars to stdin...", len(taskSpec.Task)))
		go func(data string) {
			defer stdinPipe.Close()
			_, _ = io.WriteString(stdinPipe, data)
		}(taskSpec.Task)
		logInfoFn("Stdin closed")
	}

	waitCh := make(chan error, 1)
	go func() { waitCh <- cmd.Wait() }()

	var (
		waitErr              error
		forceKillTimer       *forceKillTimer
		ctxCancelled         bool
		messageTimer         *time.Timer
		messageTimerCh       <-chan time.Time
		forcedAfterComplete  bool
		terminated           bool
		messageSeenObserved  bool
		completeSeenObserved bool
		// Fallback exit timer: ensures loop exits even if waitCh never returns
		// This handles Windows edge case where child processes hold stdout handles
		fallbackExitTimer   *time.Timer
		fallbackExitTimerCh <-chan time.Time
	)

waitLoop:
	for {
		select {
		case waitErr = <-waitCh:
			break waitLoop
		case <-ctx.Done():
			ctxCancelled = true
			logErrorFn(cancelReason(commandName, ctx))
			if !terminated {
				if timer := terminateCommandFn(cmd); timer != nil {
					forceKillTimer = timer
					terminated = true
				}
			}
			waitErr = <-waitCh
			break waitLoop
		case <-messageTimerCh:
			forcedAfterComplete = true
			messageTimerCh = nil
			if !terminated {
				logWarnFn(fmt.Sprintf("%s output parsed; terminating lingering backend", commandName))
				// FIX: Close stdout FIRST to unblock cmd.Wait() on Windows.
				// On Windows, child processes may hold stdout handles open even after
				// the main process is killed via taskkill. cmd.Wait() blocks until ALL
				// stdout handles are closed. Closing stdout here ensures the parser
				// goroutine receives EOF and cmd.Wait() can complete.
				closeWithReason(stdout, "messageTimer")
				if timer := terminateCommandFn(cmd); timer != nil {
					forceKillTimer = timer
					terminated = true
				}
			}
			// Start fallback exit timer: if waitCh doesn't return within forceKillDelay + 2 seconds,
			// force exit the loop. This handles Windows edge case where child processes hold handles
			// and cmd.Wait() blocks forever even after the main process is killed.
			if fallbackExitTimer == nil {
				fallbackDelay := time.Duration(forceKillDelay.Load()+2) * time.Second
				fallbackExitTimer = time.NewTimer(fallbackDelay)
				fallbackExitTimerCh = fallbackExitTimer.C
				logWarnFn(fmt.Sprintf("Fallback exit timer started: %v", fallbackDelay))
			}
		case <-fallbackExitTimerCh:
			// Fallback exit: waitCh didn't return in time, force exit
			logWarnFn("Fallback exit timer fired: forcing loop exit (waitCh blocked)")
			forcedAfterComplete = true
			break waitLoop
		case <-completeSeen:
			completeSeenObserved = true
			if messageTimer != nil {
				continue
			}
			messageTimer = time.NewTimer(resolvePostMessageDelay())
			messageTimerCh = messageTimer.C
		case <-messageSeen:
			messageSeenObserved = true
		}
	}

	// Clean up fallback exit timer
	if fallbackExitTimer != nil {
		if !fallbackExitTimer.Stop() {
			select {
			case <-fallbackExitTimer.C:
			default:
			}
		}
	}

	if messageTimer != nil {
		if !messageTimer.Stop() {
			select {
			case <-messageTimer.C:
			default:
			}
		}
	}

	if forceKillTimer != nil {
		forceKillTimer.Stop()
	}

	var parsed parseResult
	switch {
	case ctxCancelled:
		closeWithReason(stdout, stdoutCloseReasonCtx)
		parsed = <-parseCh
	case messageSeenObserved || completeSeenObserved:
		closeWithReason(stdout, stdoutCloseReasonWait)
		parsed = <-parseCh
	default:
		drainTimer := time.NewTimer(stdoutDrainTimeout)
		defer drainTimer.Stop()

		select {
		case parsed = <-parseCh:
			closeWithReason(stdout, stdoutCloseReasonWait)
		case <-messageSeen:
			messageSeenObserved = true
			closeWithReason(stdout, stdoutCloseReasonWait)
			parsed = <-parseCh
		case <-completeSeen:
			completeSeenObserved = true
			closeWithReason(stdout, stdoutCloseReasonWait)
			parsed = <-parseCh
		case <-drainTimer.C:
			closeWithReason(stdout, stdoutCloseReasonDrain)
			parsed = <-parseCh
		}
	}

	if ctxErr := ctx.Err(); ctxErr != nil {
		if errors.Is(ctxErr, context.DeadlineExceeded) {
			result.ExitCode = 124
			result.Error = attachStderr(fmt.Sprintf("%s execution timeout", commandName))
			return result
		}
		result.ExitCode = 130
		result.Error = attachStderr("execution cancelled")
		return result
	}

	if waitErr != nil {
		if forcedAfterComplete && parsed.message != "" {
			logWarnFn(fmt.Sprintf("%s terminated after delivering output", commandName))
		} else {
			if exitErr, ok := waitErr.(*exec.ExitError); ok {
				code := exitErr.ExitCode()
				logErrorFn(fmt.Sprintf("%s exited with status %d", commandName, code))
				result.ExitCode = code
				result.Error = attachStderr(fmt.Sprintf("%s exited with status %d", commandName, code))
				return result
			}
			logErrorFn(commandName + " error: " + waitErr.Error())
			result.ExitCode = 1
			result.Error = attachStderr(commandName + " error: " + waitErr.Error())
			return result
		}
	}

	message := parsed.message
	threadID := parsed.threadID
	if message == "" {
		logErrorFn(fmt.Sprintf("%s completed without agent_message output", commandName))
		result.ExitCode = 1
		result.Error = attachStderr(fmt.Sprintf("%s completed without agent_message output", commandName))
		return result
	}

	if stdoutLogger != nil {
		stdoutLogger.Flush()
	}
	if stderrLogger != nil {
		stderrLogger.Flush()
	}

	result.ExitCode = 0
	result.Message = message
	result.SessionID = threadID
	if result.LogPath == "" && injectedLogger != nil {
		result.LogPath = injectedLogger.Path()
	}

	return result
}

func forwardSignals(ctx context.Context, cmd commandRunner, logErrorFn func(string)) {
	notify := signalNotifyFn
	stop := signalStopFn
	if notify == nil {
		notify = signal.Notify
	}
	if stop == nil {
		stop = signal.Stop
	}

	sigCh := make(chan os.Signal, 1)
	notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		defer stop(sigCh)
		select {
		case sig := <-sigCh:
			logErrorFn(fmt.Sprintf("Received signal: %v", sig))
			if proc := cmd.Process(); proc != nil {
				// Windows does not support SIGTERM - use taskkill /T to kill process tree
				if isWindows() {
					if err := killProcessTree(proc.Pid()); err != nil {
						_ = proc.Kill()
					}
				} else {
					_ = proc.Signal(syscall.SIGTERM)
					time.AfterFunc(time.Duration(forceKillDelay.Load())*time.Second, func() {
						if p := cmd.Process(); p != nil {
							_ = p.Kill()
						}
					})
				}
			}
		case <-ctx.Done():
		}
	}()
}

func cancelReason(commandName string, ctx context.Context) string {
	if ctx == nil {
		return "Context cancelled"
	}

	if commandName == "" {
		commandName = codexCommand
	}

	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return fmt.Sprintf("%s execution timeout", commandName)
	}

	return fmt.Sprintf("Execution cancelled, terminating %s process", commandName)
}

type stdoutReasonCloser interface {
	CloseWithReason(string) error
}

func closeWithReason(rc io.ReadCloser, reason string) {
	if rc == nil {
		return
	}
	if c, ok := rc.(stdoutReasonCloser); ok {
		_ = c.CloseWithReason(reason)
		return
	}
	_ = rc.Close()
}

type forceKillTimer struct {
	timer   *time.Timer
	done    chan struct{}
	stopped atomic.Bool
	drained atomic.Bool
}

func (t *forceKillTimer) Stop() {
	if t == nil || t.timer == nil {
		return
	}
	if !t.timer.Stop() {
		<-t.done
		t.drained.Store(true)
	}
	t.stopped.Store(true)
}

// killProcessTree terminates a process and all its child processes on Windows.
// Uses taskkill /T /F /PID which recursively kills the entire process tree.
// This is necessary because Codex CLI may spawn child processes (Node.js workers, etc.)
// that inherit stdout handles and prevent the parent from exiting cleanly.
// Returns nil on non-Windows platforms or if the process has already exited.
func killProcessTree(pid int) error {
	if !isWindows() {
		return nil
	}
	if pid <= 0 {
		return nil
	}

	// taskkill /T = kill process tree, /F = force, /PID = process ID
	cmd := exec.Command("taskkill", "/T", "/F", "/PID", fmt.Sprintf("%d", pid))
	cmd.Stdout = nil
	cmd.Stderr = nil
	return cmd.Run()
}

func terminateCommand(cmd commandRunner) *forceKillTimer {
	if cmd == nil {
		return nil
	}
	proc := cmd.Process()
	if proc == nil {
		return nil
	}

	// Windows does not support SIGTERM - it silently fails without terminating the process.
	// This causes codeagent-wrapper to hang waiting for the process to exit.
	// On Windows, we use taskkill /T to kill the entire process tree, not just the main process.
	// This is critical because Codex CLI spawns child processes that hold stdout handles open.
	if isWindows() {
		pid := proc.Pid()
		if err := killProcessTree(pid); err != nil {
			// Fallback to direct Kill() if taskkill fails
			_ = proc.Kill()
		}
	} else {
		_ = proc.Signal(syscall.SIGTERM)
	}

	done := make(chan struct{}, 1)
	timer := time.AfterFunc(time.Duration(forceKillDelay.Load())*time.Second, func() {
		if p := cmd.Process(); p != nil {
			if isWindows() {
				_ = killProcessTree(p.Pid())
			} else {
				_ = p.Kill()
			}
		}
		close(done)
	})

	return &forceKillTimer{timer: timer, done: done}
}

func terminateProcess(cmd commandRunner) *time.Timer {
	if cmd == nil {
		return nil
	}
	proc := cmd.Process()
	if proc == nil {
		return nil
	}

	// Windows does not support SIGTERM - use taskkill /T to kill process tree
	if isWindows() {
		pid := proc.Pid()
		if err := killProcessTree(pid); err != nil {
			_ = proc.Kill()
		}
	} else {
		_ = proc.Signal(syscall.SIGTERM)
	}

	return time.AfterFunc(time.Duration(forceKillDelay.Load())*time.Second, func() {
		if p := cmd.Process(); p != nil {
			if isWindows() {
				_ = killProcessTree(p.Pid())
			} else {
				_ = p.Kill()
			}
		}
	})
}
