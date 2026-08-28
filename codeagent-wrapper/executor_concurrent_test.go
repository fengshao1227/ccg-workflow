package main

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

var executorTestTaskCounter atomic.Int64

func nextExecutorTestTaskID(prefix string) string {
	return fmt.Sprintf("%s-%d", prefix, executorTestTaskCounter.Add(1))
}

type execFakeProcess struct {
	pid     int
	signals []os.Signal
	killed  atomic.Int32
	mu      sync.Mutex
}

func (p *execFakeProcess) Pid() int { return p.pid }
func (p *execFakeProcess) Kill() error {
	p.killed.Add(1)
	return nil
}
func (p *execFakeProcess) Signal(sig os.Signal) error {
	p.mu.Lock()
	p.signals = append(p.signals, sig)
	p.mu.Unlock()
	return nil
}

type writeCloserStub struct {
	bytes.Buffer
	closed atomic.Bool
}

func (w *writeCloserStub) Close() error {
	w.closed.Store(true)
	return nil
}

type reasonReadCloser struct {
	r       io.Reader
	closed  []string
	mu      sync.Mutex
	closedC chan struct{}
}

func newReasonReadCloser(data string) *reasonReadCloser {
	return &reasonReadCloser{r: strings.NewReader(data), closedC: make(chan struct{}, 1)}
}

func (rc *reasonReadCloser) Read(p []byte) (int, error) { return rc.r.Read(p) }
func (rc *reasonReadCloser) Close() error               { rc.record("close"); return nil }
func (rc *reasonReadCloser) CloseWithReason(reason string) error {
	rc.record(reason)
	return nil
}

func (rc *reasonReadCloser) record(reason string) {
	rc.mu.Lock()
	rc.closed = append(rc.closed, reason)
	rc.mu.Unlock()
	select {
	case rc.closedC <- struct{}{}:
	default:
	}
}

type execFakeRunner struct {
	stdout          io.ReadCloser
	process         processHandle
	stdin           io.WriteCloser
	dir             string
	env             map[string]string
	waitErr         error
	waitDelay       time.Duration
	startErr        error
	stdoutErr       error
	stdinErr        error
	allowNilProcess bool
	started         atomic.Bool
}

func (f *execFakeRunner) Start() error {
	if f.startErr != nil {
		return f.startErr
	}
	f.started.Store(true)
	return nil
}
func (f *execFakeRunner) Wait() error {
	if f.waitDelay > 0 {
		time.Sleep(f.waitDelay)
	}
	return f.waitErr
}
func (f *execFakeRunner) StdoutPipe() (io.ReadCloser, error) {
	if f.stdoutErr != nil {
		return nil, f.stdoutErr
	}
	if f.stdout == nil {
		f.stdout = io.NopCloser(strings.NewReader(""))
	}
	return f.stdout, nil
}
func (f *execFakeRunner) StdinPipe() (io.WriteCloser, error) {
	if f.stdinErr != nil {
		return nil, f.stdinErr
	}
	if f.stdin != nil {
		return f.stdin, nil
	}
	return &writeCloserStub{}, nil
}
func (f *execFakeRunner) SetStderr(io.Writer) {}
func (f *execFakeRunner) SetDir(dir string)   { f.dir = dir }
func (f *execFakeRunner) SetEnv(env map[string]string) {
	if len(env) == 0 {
		return
	}
	if f.env == nil {
		f.env = make(map[string]string, len(env))
	}
	for k, v := range env {
		f.env[k] = v
	}
}
func (f *execFakeRunner) Process() processHandle {
	if f.process != nil {
		return f.process
	}
	if f.allowNilProcess {
		return nil
	}
	return &execFakeProcess{pid: 1}
}

func TestExecutorHelperCoverage(t *testing.T) {
	t.Run("realCmdAndProcess", func(t *testing.T) {
		rc := &realCmd{}
		if err := rc.Start(); err == nil {
			t.Fatalf("expected error for nil command")
		}
		if err := rc.Wait(); err == nil {
			t.Fatalf("expected error for nil command")
		}
		if _, err := rc.StdoutPipe(); err == nil {
			t.Fatalf("expected error for nil command")
		}
		if _, err := rc.StdinPipe(); err == nil {
			t.Fatalf("expected error for nil command")
		}
		rc.SetStderr(io.Discard)
		if rc.Process() != nil {
			t.Fatalf("expected nil process")
		}
		rcWithCmd := &realCmd{cmd: &exec.Cmd{}}
		rcWithCmd.SetStderr(io.Discard)
		rcWithCmd.SetDir("/tmp")
		if rcWithCmd.cmd.Dir != "/tmp" {
			t.Fatalf("expected SetDir to set cmd.Dir, got %q", rcWithCmd.cmd.Dir)
		}
		echoCmd := exec.Command("echo", "ok")
		rcProc := &realCmd{cmd: echoCmd}
		stdoutPipe, err := rcProc.StdoutPipe()
		if err != nil {
			t.Fatalf("StdoutPipe error: %v", err)
		}
		stdinPipe, err := rcProc.StdinPipe()
		if err != nil {
			t.Fatalf("StdinPipe error: %v", err)
		}
		rcProc.SetStderr(io.Discard)
		if err := rcProc.Start(); err != nil {
			t.Fatalf("Start failed: %v", err)
		}
		_, _ = stdinPipe.Write([]byte{})
		_ = stdinPipe.Close()
		procHandle := rcProc.Process()
		if procHandle == nil {
			t.Fatalf("expected process handle")
		}
		_ = procHandle.Signal(syscall.SIGTERM)
		_ = procHandle.Kill()
		_ = rcProc.Wait()
		_, _ = io.ReadAll(stdoutPipe)

		rp := &realProcess{}
		if rp.Pid() != 0 {
			t.Fatalf("nil process should have pid 0")
		}
		if rp.Kill() != nil {
			t.Fatalf("nil process Kill should be nil")
		}
		if rp.Signal(syscall.SIGTERM) != nil {
			t.Fatalf("nil process Signal should be nil")
		}
		rpLive := &realProcess{proc: &os.Process{Pid: 99}}
		if rpLive.Pid() != 99 {
			t.Fatalf("expected pid 99, got %d", rpLive.Pid())
		}
		_ = rpLive.Kill()
		_ = rpLive.Signal(syscall.SIGTERM)
	})

	t.Run("topologicalSortAndSkip", func(t *testing.T) {
		layers, err := topologicalSort([]TaskSpec{{ID: "root"}, {ID: "child", Dependencies: []string{"root"}}})
		if err != nil || len(layers) != 2 {
			t.Fatalf("unexpected topological sort result: layers=%d err=%v", len(layers), err)
		}
		if _, err := topologicalSort([]TaskSpec{{ID: "cycle", Dependencies: []string{"cycle"}}}); err == nil {
			t.Fatalf("expected cycle detection error")
		}

		failed := map[string]TaskResult{"root": {ExitCode: 1}}
		if skip, _ := shouldSkipTask(TaskSpec{ID: "child", Dependencies: []string{"root"}}, failed); !skip {
			t.Fatalf("should skip when dependency failed")
		}
		if skip, _ := shouldSkipTask(TaskSpec{ID: "leaf"}, failed); skip {
			t.Fatalf("should not skip task without dependencies")
		}
		if skip, _ := shouldSkipTask(TaskSpec{ID: "child-ok", Dependencies: []string{"root"}}, map[string]TaskResult{}); skip {
			t.Fatalf("should not skip when dependencies succeeded")
		}
	})

	t.Run("cancelledTaskResult", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		res := cancelledTaskResult("t1", ctx)
		if res.ExitCode != 130 {
			t.Fatalf("expected cancel exit code, got %d", res.ExitCode)
		}

		timeoutCtx, timeoutCancel := context.WithTimeout(context.Background(), 0)
		defer timeoutCancel()
		res = cancelledTaskResult("t2", timeoutCtx)
		if res.ExitCode != 124 {
			t.Fatalf("expected timeout exit code, got %d", res.ExitCode)
		}
	})

	t.Run("generateFinalOutputAndArgs", func(t *testing.T) {
		const key = "CODEX_REQUIRE_APPROVAL"
		t.Cleanup(func() { os.Unsetenv(key) })
		os.Unsetenv(key)

		out := generateFinalOutput([]TaskResult{
			{TaskID: "ok", ExitCode: 0},
			{TaskID: "fail", ExitCode: 1, Error: "boom"},
		})
		if !strings.Contains(out, "ok") || !strings.Contains(out, "fail") {
			t.Fatalf("unexpected summary output: %s", out)
		}
		// Test summary mode (default) - should have new format with ### headers
		out = generateFinalOutput([]TaskResult{{TaskID: "rich", ExitCode: 0, SessionID: "sess", LogPath: "/tmp/log", Message: "hello"}})
		if !strings.Contains(out, "### rich") {
			t.Fatalf("summary output missing task header: %s", out)
		}
		// Test full output mode - should have Session and Message
		out = generateFinalOutputWithMode([]TaskResult{{TaskID: "rich", ExitCode: 0, SessionID: "sess", LogPath: "/tmp/log", Message: "hello"}}, false)
		if !strings.Contains(out, "Session: sess") || !strings.Contains(out, "Log: /tmp/log") || !strings.Contains(out, "hello") {
			t.Fatalf("full output missing fields: %s", out)
		}

		args := buildCodexArgs(&Config{Mode: "new", WorkDir: "/tmp"}, "task")
		if !slices.Equal(args, []string{"e", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "-c", "mcp_servers={}", "-C", "/tmp", "--json", "task"}) {
			t.Fatalf("unexpected codex args: %+v", args)
		}
		args = buildCodexArgs(&Config{Mode: "resume", SessionID: "sess"}, "target")
		if !slices.Equal(args, []string{"e", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "-c", "mcp_servers={}", "--json", "resume", "sess", "target"}) {
			t.Fatalf("unexpected resume args: %+v", args)
		}
	})

	t.Run("generateFinalOutputASCIIMode", func(t *testing.T) {
		t.Setenv("CODEAGENT_ASCII_MODE", "true")

		results := []TaskResult{
			{TaskID: "ok", ExitCode: 0, Coverage: "92%", CoverageNum: 92, CoverageTarget: 90, KeyOutput: "done"},
			{TaskID: "warn", ExitCode: 0, Coverage: "80%", CoverageNum: 80, CoverageTarget: 90, KeyOutput: "did"},
			{TaskID: "bad", ExitCode: 2, Error: "boom"},
		}
		out := generateFinalOutput(results)

		for _, sym := range []string{"PASS", "WARN", "FAIL"} {
			if !strings.Contains(out, sym) {
				t.Fatalf("ASCII mode should include %q, got: %s", sym, out)
			}
		}
		for _, sym := range []string{"✓", "⚠️", "✗"} {
			if strings.Contains(out, sym) {
				t.Fatalf("ASCII mode should not include %q, got: %s", sym, out)
			}
		}
	})

	t.Run("generateFinalOutputUnicodeMode", func(t *testing.T) {
		t.Setenv("CODEAGENT_ASCII_MODE", "false")

		results := []TaskResult{
			{TaskID: "ok", ExitCode: 0, Coverage: "92%", CoverageNum: 92, CoverageTarget: 90, KeyOutput: "done"},
			{TaskID: "warn", ExitCode: 0, Coverage: "80%", CoverageNum: 80, CoverageTarget: 90, KeyOutput: "did"},
			{TaskID: "bad", ExitCode: 2, Error: "boom"},
		}
		out := generateFinalOutput(results)

		for _, sym := range []string{"✓", "⚠️", "✗"} {
			if !strings.Contains(out, sym) {
				t.Fatalf("Unicode mode should include %q, got: %s", sym, out)
			}
		}
	})

	t.Run("executeConcurrentWrapper", func(t *testing.T) {
		orig := runCodexTaskFn
		defer func() { runCodexTaskFn = orig }()
		runCodexTaskFn = func(task TaskSpec, timeout int) TaskResult {
			return TaskResult{TaskID: task.ID, ExitCode: 0, Message: "done"}
		}
		os.Setenv("CODEAGENT_MAX_PARALLEL_WORKERS", "1")
		defer os.Unsetenv("CODEAGENT_MAX_PARALLEL_WORKERS")

		results := executeConcurrent([][]TaskSpec{{{ID: "wrap"}}}, 1)
		if len(results) != 1 || results[0].TaskID != "wrap" {
			t.Fatalf("unexpected wrapper results: %+v", results)
		}

		unbounded := executeConcurrentWithContext(context.Background(), [][]TaskSpec{{{ID: "unbounded"}}}, 1, 0)
		if len(unbounded) != 1 || unbounded[0].ExitCode != 0 {
			t.Fatalf("unexpected unbounded result: %+v", unbounded)
		}

		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		cancelled := executeConcurrentWithContext(ctx, [][]TaskSpec{{{ID: "cancel"}}}, 1, 1)
		if cancelled[0].ExitCode == 0 {
			t.Fatalf("expected cancelled result, got %+v", cancelled[0])
		}
	})
}

func TestExecutorRunCodexTaskWithContext(t *testing.T) {
	origRunner := newCommandRunner
	defer func() { newCommandRunner = origRunner }()

	t.Run("resumeMissingSessionID", func(t *testing.T) {
		newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
			t.Fatalf("unexpected command execution for invalid resume config")
			return nil
		}

		res := runCodexTaskWithContext(context.Background(), TaskSpec{Task: "payload", WorkDir: ".", Mode: "resume"}, nil, nil, false, false, 1)
		if res.ExitCode == 0 || !strings.Contains(res.Error, "session_id") {
			t.Fatalf("expected validation error, got %+v", res)
		}
	})

	t.Run("success", func(t *testing.T) {
		var firstStdout *reasonReadCloser
		newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
			rc := newReasonReadCloser(`{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}`)
			if firstStdout == nil {
				firstStdout = rc
			}
			return &execFakeRunner{stdout: rc, process: &execFakeProcess{pid: 1234}}
		}

		res := runCodexTaskWithContext(context.Background(), TaskSpec{ID: "task-1", Task: "payload", WorkDir: "."}, nil, nil, false, false, 1)
		if res.Error != "" || res.Message != "hello" || res.ExitCode != 0 {
			t.Fatalf("unexpected result: %+v", res)
		}

		select {
		case <-firstStdout.closedC:
		case <-time.After(1 * time.Second):
			t.Fatalf("stdout not closed with reason")
		}

		orig := runCodexTaskFn
		runCodexTaskFn = func(task TaskSpec, timeout int) TaskResult {
			return TaskResult{TaskID: task.ID, ExitCode: 0, Message: "ok"}
		}
		t.Cleanup(func() { runCodexTaskFn = orig })

		if res := runCodexTask(TaskSpec{Task: "task-text", WorkDir: "."}, true, 1); res.ExitCode != 0 {
			t.Fatalf("runCodexTask failed: %+v", res)
		}

		msg, threadID, code := runCodexProcess(context.Background(), []string{"arg"}, "content", false, 1)
		if code != 0 || msg == "" {
			t.Fatalf("runCodexProcess unexpected result: msg=%q code=%d threadID=%s", msg, code, threadID)
		}
	})

	t.Run("startErrors", func(t *testing.T) {
		newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
			return &execFakeRunner{startErr: errors.New("executable file not found"), process: &execFakeProcess{pid: 1}}
		}
		res := runCodexTaskWithContext(context.Background(), TaskSpec{Task: "payload", WorkDir: "."}, nil, nil, false, false, 1)
		if res.ExitCode != 127 {
			t.Fatalf("expected missing executable exit code, got %d", res.ExitCode)
		}

		newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
			return &execFakeRunner{startErr: errors.New("start failed"), process: &execFakeProcess{pid: 2}}
		}
		res = runCodexTaskWithContext(context.Background(), TaskSpec{Task: "payload", WorkDir: "."}, nil, nil, false, false, 1)
		if res.ExitCode == 0 {
			t.Fatalf("expected non-zero exit on start failure")
		}
	})

	t.Run("timeoutAndPipes", func(t *testing.T) {
		newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
			return &execFakeRunner{
				stdout:    newReasonReadCloser(`{"type":"item.completed","item":{"type":"agent_message","text":"slow"}}`),
				process:   &execFakeProcess{pid: 5},
				waitDelay: 20 * time.Millisecond,
			}
		}
		res := runCodexTaskWithContext(context.Background(), TaskSpec{Task: "payload", WorkDir: ".", UseStdin: true}, nil, nil, false, false, 0)
		if res.ExitCode == 0 {
			t.Fatalf("expected timeout result, got %+v", res)
		}
	})

	t.Run("pipeErrors", func(t *testing.T) {
		newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
			return &execFakeRunner{stdoutErr: errors.New("stdout fail"), process: &execFakeProcess{pid: 6}}
		}
		res := runCodexTaskWithContext(context.Background(), TaskSpec{Task: "payload", WorkDir: "."}, nil, nil, false, false, 1)
		if res.ExitCode == 0 {
			t.Fatalf("expected failure on stdout pipe error")
		}

		newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
			return &execFakeRunner{stdinErr: errors.New("stdin fail"), process: &execFakeProcess{pid: 7}}
		}
		res = runCodexTaskWithContext(context.Background(), TaskSpec{Task: "payload", WorkDir: ".", UseStdin: true}, nil, nil, false, false, 1)
		if res.ExitCode == 0 {
			t.Fatalf("expected failure on stdin pipe error")
		}
	})

	t.Run("waitExitError", func(t *testing.T) {
		err := exec.Command("false").Run()
		exitErr, _ := err.(*exec.ExitError)
		if exitErr == nil {
			t.Fatalf("expected exec.ExitError")
		}
		newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
			return &execFakeRunner{
				stdout:  newReasonReadCloser(`{"type":"item.completed","item":{"type":"agent_message","text":"ignored"}}`),
				process: &execFakeProcess{pid: 8},
				waitErr: exitErr,
			}
		}
		res := runCodexTaskWithContext(context.Background(), TaskSpec{Task: "payload", WorkDir: "."}, nil, nil, false, false, 1)
		if res.ExitCode == 0 {
			t.Fatalf("expected non-zero exit on wait error")
		}
	})

	t.Run("contextCancelled", func(t *testing.T) {
		newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
			return &execFakeRunner{
				stdout:    newReasonReadCloser(`{"type":"item.completed","item":{"type":"agent_message","text":"cancel"}}`),
				process:   &execFakeProcess{pid: 9},
				waitDelay: 10 * time.Millisecond,
			}
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		res := runCodexTaskWithContext(ctx, TaskSpec{Task: "payload", WorkDir: "."}, nil, nil, false, false, 1)
		if res.ExitCode == 0 {
			t.Fatalf("expected cancellation result")
		}
	})

	t.Run("silentLogger", func(t *testing.T) {
		newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
			return &execFakeRunner{
				stdout:  newReasonReadCloser(`{"type":"item.completed","item":{"type":"agent_message","text":"quiet"}}`),
				process: &execFakeProcess{pid: 10},
			}
		}
		_ = closeLogger()
		res := runCodexTaskWithContext(context.Background(), TaskSpec{Task: "payload", WorkDir: "."}, nil, nil, false, true, 1)
		if res.ExitCode != 0 || res.LogPath == "" {
			t.Fatalf("expected success with temp logger, got %+v", res)
		}
		_ = closeLogger()
	})

	t.Run("injectedLogger", func(t *testing.T) {
		newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
			return &execFakeRunner{
				stdout:  newReasonReadCloser(`{"type":"item.completed","item":{"type":"agent_message","text":"injected"}}`),
				process: &execFakeProcess{pid: 12},
			}
		}
		_ = closeLogger()

		injected, err := NewLoggerWithSuffix("executor-injected")
		if err != nil {
			t.Fatalf("NewLoggerWithSuffix() error = %v", err)
		}
		defer func() {
			_ = injected.Close()
			_ = os.Remove(injected.Path())
		}()

		ctx := withTaskLogger(context.Background(), injected)
		res := runCodexTaskWithContext(ctx, TaskSpec{ID: "task-injected", Task: "payload", WorkDir: "."}, nil, nil, false, true, 1)
		if res.ExitCode != 0 || res.LogPath != injected.Path() {
			t.Fatalf("expected injected logger path, got %+v", res)
		}
		if activeLogger() != nil {
			t.Fatalf("expected no global logger to be created when injected")
		}

		injected.Flush()
		data, err := os.ReadFile(injected.Path())
		if err != nil {
			t.Fatalf("failed to read injected log file: %v", err)
		}
		if !strings.Contains(string(data), "task-injected") {
			t.Fatalf("injected log missing task prefix, content: %s", string(data))
		}
	})

	t.Run("contextLoggerWithoutParent", func(t *testing.T) {
		newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
			return &execFakeRunner{
				stdout:  newReasonReadCloser(`{"type":"item.completed","item":{"type":"agent_message","text":"ctx"}}`),
				process: &execFakeProcess{pid: 14},
			}
		}
		_ = closeLogger()

		taskLogger, err := NewLoggerWithSuffix("executor-taskctx")
		if err != nil {
			t.Fatalf("NewLoggerWithSuffix() error = %v", err)
		}
		t.Cleanup(func() {
			_ = taskLogger.Close()
			_ = os.Remove(taskLogger.Path())
		})

		ctx := withTaskLogger(context.Background(), taskLogger)
		res := runCodexTaskWithContext(nil, TaskSpec{ID: "task-context", Task: "payload", WorkDir: ".", Context: ctx}, nil, nil, false, true, 1)
		if res.ExitCode != 0 || res.LogPath != taskLogger.Path() {
			t.Fatalf("expected task logger to be reused from spec context, got %+v", res)
		}
		if activeLogger() != nil {
			t.Fatalf("expected no global logger to be created when task context provides one")
		}

		taskLogger.Flush()
		data, err := os.ReadFile(taskLogger.Path())
		if err != nil {
			t.Fatalf("failed to read task log: %v", err)
		}
		if !strings.Contains(string(data), "task-context") {
			t.Fatalf("task log missing task id, content: %s", string(data))
		}
	})

	t.Run("backendSetsDirAndNilContext", func(t *testing.T) {
		var rc *execFakeRunner
		newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
			rc = &execFakeRunner{
				stdout:  newReasonReadCloser(`{"type":"item.completed","item":{"type":"agent_message","text":"backend"}}`),
				process: &execFakeProcess{pid: 13},
			}
			return rc
		}

		_ = closeLogger()
		res := runCodexTaskWithContext(nil, TaskSpec{ID: "task-backend", Task: "payload", WorkDir: "/tmp"}, ClaudeBackend{}, nil, false, false, 1)
		if res.ExitCode != 0 || res.Message != "backend" {
			t.Fatalf("unexpected result: %+v", res)
		}
		if rc == nil || rc.dir != "/tmp" {
			t.Fatalf("expected backend to set cmd.Dir, got runner=%v dir=%q", rc, rc.dir)
		}
	})

	t.Run("missingMessage", func(t *testing.T) {
		newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
			return &execFakeRunner{
				stdout:  newReasonReadCloser(`{"type":"item.completed","item":{"type":"task","text":"noop"}}`),
				process: &execFakeProcess{pid: 11},
			}
		}
		res := runCodexTaskWithContext(context.Background(), TaskSpec{Task: "payload", WorkDir: "."}, nil, nil, false, false, 1)
		if res.ExitCode == 0 {
			t.Fatalf("expected failure when no agent_message returned")
		}
	})
}

func TestExecutorParallelLogIsolation(t *testing.T) {
	mainLogger, err := NewLoggerWithSuffix("executor-main")
	if err != nil {
		t.Fatalf("NewLoggerWithSuffix() error = %v", err)
	}
	setLogger(mainLogger)
	t.Cleanup(func() {
		_ = closeLogger()
		_ = os.Remove(mainLogger.Path())
	})

	taskA := nextExecutorTestTaskID("iso-a")
	taskB := nextExecutorTestTaskID("iso-b")
	markerA := "ISOLATION_MARKER:" + taskA
	markerB := "ISOLATION_MARKER:" + taskB

	origRun := runCodexTaskFn
	runCodexTaskFn = func(task TaskSpec, timeout int) TaskResult {
		logger := taskLoggerFromContext(task.Context)
		if logger == nil {
			return TaskResult{TaskID: task.ID, ExitCode: 1, Error: "missing task logger"}
		}
		switch task.ID {
		case taskA:
			logger.Info(markerA)
		case taskB:
			logger.Info(markerB)
		default:
			logger.Info("unexpected task: " + task.ID)
		}
		return TaskResult{TaskID: task.ID, ExitCode: 0}
	}
	t.Cleanup(func() { runCodexTaskFn = origRun })

	stderrR, stderrW, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe() error = %v", err)
	}
	oldStderr := os.Stderr
	os.Stderr = stderrW
	defer func() { os.Stderr = oldStderr }()

	results := executeConcurrentWithContext(nil, [][]TaskSpec{{{ID: taskA}, {ID: taskB}}}, 1, -1)

	_ = stderrW.Close()
	os.Stderr = oldStderr
	stderrData, _ := io.ReadAll(stderrR)
	_ = stderrR.Close()
	stderrOut := string(stderrData)

	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}

	paths := map[string]string{}
	for _, res := range results {
		if res.ExitCode != 0 {
			t.Fatalf("unexpected failure: %+v", res)
		}
		if res.LogPath == "" {
			t.Fatalf("missing LogPath for task %q", res.TaskID)
		}
		paths[res.TaskID] = res.LogPath
	}
	if paths[taskA] == paths[taskB] {
		t.Fatalf("expected distinct task log paths, got %q", paths[taskA])
	}

	if strings.Contains(stderrOut, mainLogger.Path()) {
		t.Fatalf("stderr should not print main log path: %s", stderrOut)
	}
	if !strings.Contains(stderrOut, paths[taskA]) || !strings.Contains(stderrOut, paths[taskB]) {
		t.Fatalf("stderr should include task log paths, got: %s", stderrOut)
	}

	mainLogger.Flush()
	mainData, err := os.ReadFile(mainLogger.Path())
	if err != nil {
		t.Fatalf("failed to read main log: %v", err)
	}
	if strings.Contains(string(mainData), markerA) || strings.Contains(string(mainData), markerB) {
		t.Fatalf("main log should not contain task markers, content: %s", string(mainData))
	}

	taskAData, err := os.ReadFile(paths[taskA])
	if err != nil {
		t.Fatalf("failed to read task A log: %v", err)
	}
	taskBData, err := os.ReadFile(paths[taskB])
	if err != nil {
		t.Fatalf("failed to read task B log: %v", err)
	}
	if !strings.Contains(string(taskAData), markerA) || strings.Contains(string(taskAData), markerB) {
		t.Fatalf("task A log isolation failed, content: %s", string(taskAData))
	}
	if !strings.Contains(string(taskBData), markerB) || strings.Contains(string(taskBData), markerA) {
		t.Fatalf("task B log isolation failed, content: %s", string(taskBData))
	}

	_ = os.Remove(paths[taskA])
	_ = os.Remove(paths[taskB])
}

func TestConcurrentExecutorParallelLogIsolationAndClosure(t *testing.T) {
	tempDir := t.TempDir()
	t.Setenv("TMPDIR", tempDir)

	oldArgs := os.Args
	os.Args = []string{defaultWrapperName}
	t.Cleanup(func() { os.Args = oldArgs })

	mainLogger, err := NewLoggerWithSuffix("concurrent-main")
	if err != nil {
		t.Fatalf("NewLoggerWithSuffix() error = %v", err)
	}
	setLogger(mainLogger)
	t.Cleanup(func() {
		mainLogger.Flush()
		_ = closeLogger()
		_ = os.Remove(mainLogger.Path())
	})

	const taskCount = 16
	const writersPerTask = 4
	const logsPerWriter = 50
	const expectedTaskLines = writersPerTask * logsPerWriter

	taskIDs := make([]string, 0, taskCount)
	tasks := make([]TaskSpec, 0, taskCount)
	for i := 0; i < taskCount; i++ {
		id := nextExecutorTestTaskID("iso")
		taskIDs = append(taskIDs, id)
		tasks = append(tasks, TaskSpec{ID: id})
	}

	type taskLoggerInfo struct {
		taskID string
		logger *Logger
	}
	loggerCh := make(chan taskLoggerInfo, taskCount)
	readyCh := make(chan struct{}, taskCount)
	startCh := make(chan struct{})

	go func() {
		for i := 0; i < taskCount; i++ {
			<-readyCh
		}
		close(startCh)
	}()

	origRun := runCodexTaskFn
	runCodexTaskFn = func(task TaskSpec, timeout int) TaskResult {
		readyCh <- struct{}{}

		logger := taskLoggerFromContext(task.Context)
		loggerCh <- taskLoggerInfo{taskID: task.ID, logger: logger}
		if logger == nil {
			return TaskResult{TaskID: task.ID, ExitCode: 1, Error: "missing task logger"}
		}

		<-startCh

		var wg sync.WaitGroup
		wg.Add(writersPerTask)
		for g := 0; g < writersPerTask; g++ {
			go func(g int) {
				defer wg.Done()
				for i := 0; i < logsPerWriter; i++ {
					logger.Info(fmt.Sprintf("TASK=%s g=%d i=%d", task.ID, g, i))
				}
			}(g)
		}
		wg.Wait()

		return TaskResult{TaskID: task.ID, ExitCode: 0}
	}
	t.Cleanup(func() { runCodexTaskFn = origRun })

	results := executeConcurrentWithContext(context.Background(), [][]TaskSpec{tasks}, 1, 0)

	if len(results) != taskCount {
		t.Fatalf("expected %d results, got %d", taskCount, len(results))
	}

	taskLogPaths := make(map[string]string, taskCount)
	seenPaths := make(map[string]struct{}, taskCount)
	for _, res := range results {
		if res.ExitCode != 0 || res.Error != "" {
			t.Fatalf("unexpected task failure: %+v", res)
		}
		if res.LogPath == "" {
			t.Fatalf("missing LogPath for task %q", res.TaskID)
		}
		if _, ok := taskLogPaths[res.TaskID]; ok {
			t.Fatalf("duplicate TaskID in results: %q", res.TaskID)
		}
		taskLogPaths[res.TaskID] = res.LogPath
		if _, ok := seenPaths[res.LogPath]; ok {
			t.Fatalf("expected unique log path per task; duplicate path %q", res.LogPath)
		}
		seenPaths[res.LogPath] = struct{}{}
	}
	if len(taskLogPaths) != taskCount {
		t.Fatalf("expected %d unique task IDs, got %d", taskCount, len(taskLogPaths))
	}

	prefix := primaryLogPrefix()
	pid := os.Getpid()
	for _, id := range taskIDs {
		path := taskLogPaths[id]
		if path == "" {
			t.Fatalf("missing log path for task %q", id)
		}
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("task log file not created for %q: %v", id, err)
		}
		wantBase := fmt.Sprintf("%s-%d-%s.log", prefix, pid, id)
		if got := filepath.Base(path); got != wantBase {
			t.Fatalf("unexpected log filename for %q: got %q, want %q", id, got, wantBase)
		}
	}

	loggers := make(map[string]*Logger, taskCount)
	for i := 0; i < taskCount; i++ {
		info := <-loggerCh
		if info.taskID == "" {
			t.Fatalf("missing taskID in logger info")
		}
		if info.logger == nil {
			t.Fatalf("missing logger in context for task %q", info.taskID)
		}
		if prev, ok := loggers[info.taskID]; ok && prev != info.logger {
			t.Fatalf("task %q received multiple logger instances", info.taskID)
		}
		loggers[info.taskID] = info.logger
	}
	if len(loggers) != taskCount {
		t.Fatalf("expected %d task loggers, got %d", taskCount, len(loggers))
	}

	for taskID, logger := range loggers {
		if !logger.closed.Load() {
			t.Fatalf("expected task logger to be closed for %q", taskID)
		}
		if logger.file == nil {
			t.Fatalf("expected task logger file to be non-nil for %q", taskID)
		}
		if _, err := logger.file.Write([]byte("x")); err == nil {
			t.Fatalf("expected task logger file to be closed for %q", taskID)
		}
	}

	mainLogger.Flush()
	mainData, err := os.ReadFile(mainLogger.Path())
	if err != nil {
		t.Fatalf("failed to read main log: %v", err)
	}
	mainText := string(mainData)
	if !strings.Contains(mainText, "parallel: worker_limit=") {
		t.Fatalf("expected main log to include concurrency planning, content: %s", mainText)
	}
	if strings.Contains(mainText, "TASK=") {
		t.Fatalf("main log should not contain task output, content: %s", mainText)
	}

	for taskID, path := range taskLogPaths {
		f, err := os.Open(path)
		if err != nil {
			t.Fatalf("failed to open task log for %q: %v", taskID, err)
		}

		scanner := bufio.NewScanner(f)
		lines := 0
		for scanner.Scan() {
			line := scanner.Text()
			if strings.Contains(line, "parallel:") {
				t.Fatalf("task log should not contain main log entries for %q: %s", taskID, line)
			}
			gotID, ok := parseTaskIDFromLogLine(line)
			if !ok {
				t.Fatalf("task log entry missing task marker for %q: %s", taskID, line)
			}
			if gotID != taskID {
				t.Fatalf("task log isolation failed: file=%q got TASK=%q want TASK=%q", path, gotID, taskID)
			}
			lines++
		}
		if err := scanner.Err(); err != nil {
			_ = f.Close()
			t.Fatalf("scanner error for %q: %v", taskID, err)
		}
		if err := f.Close(); err != nil {
			t.Fatalf("failed to close task log for %q: %v", taskID, err)
		}
		if lines != expectedTaskLines {
			t.Fatalf("unexpected task log line count for %q: got %d, want %d", taskID, lines, expectedTaskLines)
		}
	}

	for _, path := range taskLogPaths {
		_ = os.Remove(path)
	}
}

func parseTaskIDFromLogLine(line string) (string, bool) {
	const marker = "TASK="
	idx := strings.Index(line, marker)
	if idx == -1 {
		return "", false
	}
	rest := line[idx+len(marker):]
	end := strings.IndexByte(rest, ' ')
	if end == -1 {
		return rest, rest != ""
	}
	return rest[:end], rest[:end] != ""
}

func TestExecutorTaskLoggerContext(t *testing.T) {
	if taskLoggerFromContext(nil) != nil {
		t.Fatalf("expected nil logger from nil context")
	}
	if taskLoggerFromContext(context.Background()) != nil {
		t.Fatalf("expected nil logger when context has no logger")
	}

	logger, err := NewLoggerWithSuffix("executor-taskctx")
	if err != nil {
		t.Fatalf("NewLoggerWithSuffix() error = %v", err)
	}
	defer func() {
		_ = logger.Close()
		_ = os.Remove(logger.Path())
	}()

	ctx := withTaskLogger(context.Background(), logger)
	if got := taskLoggerFromContext(ctx); got != logger {
		t.Fatalf("expected logger roundtrip, got %v", got)
	}

	if taskLoggerFromContext(withTaskLogger(context.Background(), nil)) != nil {
		t.Fatalf("expected nil logger when injected logger is nil")
	}
}

func TestExecutorExecuteConcurrentWithContextBranches(t *testing.T) {
	devNull, err := os.OpenFile(os.DevNull, os.O_WRONLY, 0)
	if err != nil {
		t.Fatalf("failed to open %s: %v", os.DevNull, err)
	}
	oldStderr := os.Stderr
	os.Stderr = devNull
	t.Cleanup(func() {
		os.Stderr = oldStderr
		_ = devNull.Close()
	})

	t.Run("skipOnFailedDependencies", func(t *testing.T) {
		root := nextExecutorTestTaskID("root")
		child := nextExecutorTestTaskID("child")

		orig := runCodexTaskFn
		runCodexTaskFn = func(task TaskSpec, timeout int) TaskResult {
			if task.ID == root {
				return TaskResult{TaskID: task.ID, ExitCode: 1, Error: "boom"}
			}
			return TaskResult{TaskID: task.ID, ExitCode: 0}
		}
		t.Cleanup(func() { runCodexTaskFn = orig })

		results := executeConcurrentWithContext(context.Background(), [][]TaskSpec{
			{{ID: root}},
			{{ID: child, Dependencies: []string{root}}},
		}, 1, 0)

		foundChild := false
		for _, res := range results {
			if res.LogPath != "" {
				_ = os.Remove(res.LogPath)
			}
			if res.TaskID != child {
				continue
			}
			foundChild = true
			if res.ExitCode == 0 || !strings.Contains(res.Error, "skipped") {
				t.Fatalf("expected skipped child task result, got %+v", res)
			}
		}
		if !foundChild {
			t.Fatalf("expected child task to be present in results")
		}
	})

	t.Run("panicRecovered", func(t *testing.T) {
		taskID := nextExecutorTestTaskID("panic")

		orig := runCodexTaskFn
		runCodexTaskFn = func(task TaskSpec, timeout int) TaskResult {
			panic("boom")
		}
		t.Cleanup(func() { runCodexTaskFn = orig })

		results := executeConcurrentWithContext(context.Background(), [][]TaskSpec{{{ID: taskID}}}, 1, 0)
		if len(results) != 1 {
			t.Fatalf("expected 1 result, got %d", len(results))
		}
		if results[0].ExitCode == 0 || !strings.Contains(results[0].Error, "panic") {
			t.Fatalf("expected panic result, got %+v", results[0])
		}
		if results[0].LogPath == "" {
			t.Fatalf("expected LogPath on panic result")
		}
		_ = os.Remove(results[0].LogPath)
	})

	t.Run("cancelWhileWaitingForWorker", func(t *testing.T) {
		task1 := nextExecutorTestTaskID("slot")
		task2 := nextExecutorTestTaskID("slot")

		parentCtx, cancel := context.WithCancel(context.Background())
		started := make(chan struct{})
		unblock := make(chan struct{})
		var startedOnce sync.Once

		orig := runCodexTaskFn
		runCodexTaskFn = func(task TaskSpec, timeout int) TaskResult {
			startedOnce.Do(func() { close(started) })
			<-unblock
			return TaskResult{TaskID: task.ID, ExitCode: 0}
		}
		t.Cleanup(func() { runCodexTaskFn = orig })

		go func() {
			<-started
			cancel()
			time.Sleep(50 * time.Millisecond)
			close(unblock)
		}()

		results := executeConcurrentWithContext(parentCtx, [][]TaskSpec{{{ID: task1}, {ID: task2}}}, 1, 1)
		foundCancelled := false
		for _, res := range results {
			if res.LogPath != "" {
				_ = os.Remove(res.LogPath)
			}
			if res.ExitCode == 130 {
				foundCancelled = true
			}
		}
		if !foundCancelled {
			t.Fatalf("expected a task to be cancelled")
		}
	})

	t.Run("loggerCreateFails", func(t *testing.T) {
		taskID := nextExecutorTestTaskID("bad") + "/id"

		orig := runCodexTaskFn
		runCodexTaskFn = func(task TaskSpec, timeout int) TaskResult {
			return TaskResult{TaskID: task.ID, ExitCode: 0}
		}
		t.Cleanup(func() { runCodexTaskFn = orig })

		results := executeConcurrentWithContext(context.Background(), [][]TaskSpec{{{ID: taskID}}}, 1, 0)
		if len(results) != 1 || results[0].ExitCode != 0 {
			t.Fatalf("unexpected results: %+v", results)
		}
	})

	t.Run("TestConcurrentTaskLoggerFailure", func(t *testing.T) {
		// Create a writable temp dir for the main logger, then flip TMPDIR to a read-only
		// location so task-specific loggers fail to open.
		writable := t.TempDir()
		t.Setenv("TMPDIR", writable)

		mainLogger, err := NewLoggerWithSuffix("shared-main")
		if err != nil {
			t.Fatalf("NewLoggerWithSuffix() error = %v", err)
		}
		setLogger(mainLogger)
		t.Cleanup(func() {
			mainLogger.Flush()
			_ = closeLogger()
			_ = os.Remove(mainLogger.Path())
		})

		noWrite := filepath.Join(writable, "ro")
		if err := os.Mkdir(noWrite, 0o500); err != nil {
			t.Fatalf("failed to create read-only temp dir: %v", err)
		}
		t.Setenv("TMPDIR", noWrite)

		taskA := nextExecutorTestTaskID("shared-a")
		taskB := nextExecutorTestTaskID("shared-b")

		orig := runCodexTaskFn
		runCodexTaskFn = func(task TaskSpec, timeout int) TaskResult {
			logger := taskLoggerFromContext(task.Context)
			if logger != mainLogger {
				return TaskResult{TaskID: task.ID, ExitCode: 1, Error: "unexpected logger"}
			}
			logger.Info("TASK=" + task.ID)
			return TaskResult{TaskID: task.ID, ExitCode: 0}
		}
		t.Cleanup(func() { runCodexTaskFn = orig })

		stderrR, stderrW, err := os.Pipe()
		if err != nil {
			t.Fatalf("os.Pipe() error = %v", err)
		}
		oldStderr := os.Stderr
		os.Stderr = stderrW

		results := executeConcurrentWithContext(context.Background(), [][]TaskSpec{{{ID: taskA}, {ID: taskB}}}, 1, 0)

		_ = stderrW.Close()
		os.Stderr = oldStderr
		stderrData, _ := io.ReadAll(stderrR)
		_ = stderrR.Close()
		stderrOut := string(stderrData)

		if len(results) != 2 {
			t.Fatalf("expected 2 results, got %d", len(results))
		}
		for _, res := range results {
			if res.ExitCode != 0 || res.Error != "" {
				t.Fatalf("task failed unexpectedly: %+v", res)
			}
			if res.LogPath != mainLogger.Path() {
				t.Fatalf("shared log path mismatch: got %q want %q", res.LogPath, mainLogger.Path())
			}
			if !res.sharedLog {
				t.Fatalf("expected sharedLog flag for %+v", res)
			}
			if !strings.Contains(stderrOut, "Log (shared)") {
				t.Fatalf("stderr missing shared marker: %s", stderrOut)
			}
		}

		// Test full output mode for shared marker (summary mode doesn't show it)
		summary := generateFinalOutputWithMode(results, false)
		if !strings.Contains(summary, "(shared)") {
			t.Fatalf("full output missing shared marker: %s", summary)
		}

		mainLogger.Flush()
		data, err := os.ReadFile(mainLogger.Path())
		if err != nil {
			t.Fatalf("failed to read main log: %v", err)
		}
		content := string(data)
		if !strings.Contains(content, "TASK="+taskA) || !strings.Contains(content, "TASK="+taskB) {
			t.Fatalf("expected shared log to contain both tasks, got: %s", content)
		}
	})

	t.Run("TestSanitizeTaskID", func(t *testing.T) {
		tempDir := t.TempDir()
		t.Setenv("TMPDIR", tempDir)

		orig := runCodexTaskFn
		runCodexTaskFn = func(task TaskSpec, timeout int) TaskResult {
			logger := taskLoggerFromContext(task.Context)
			if logger == nil {
				return TaskResult{TaskID: task.ID, ExitCode: 1, Error: "missing logger"}
			}
			logger.Info("TASK=" + task.ID)
			return TaskResult{TaskID: task.ID, ExitCode: 0}
		}
		t.Cleanup(func() { runCodexTaskFn = orig })

		idA := "../bad id"
		idB := "tab\tid"
		results := executeConcurrentWithContext(context.Background(), [][]TaskSpec{{{ID: idA}, {ID: idB}}}, 1, 0)

		if len(results) != 2 {
			t.Fatalf("expected 2 results, got %d", len(results))
		}

		expected := map[string]string{
			idA: sanitizeLogSuffix(idA),
			idB: sanitizeLogSuffix(idB),
		}

		for _, res := range results {
			if res.ExitCode != 0 || res.Error != "" {
				t.Fatalf("unexpected failure: %+v", res)
			}
			safe, ok := expected[res.TaskID]
			if !ok {
				t.Fatalf("unexpected task id %q in results", res.TaskID)
			}
			wantBase := fmt.Sprintf("%s-%d-%s.log", primaryLogPrefix(), os.Getpid(), safe)
			if filepath.Base(res.LogPath) != wantBase {
				t.Fatalf("log filename for %q = %q, want %q", res.TaskID, filepath.Base(res.LogPath), wantBase)
			}
			data, err := os.ReadFile(res.LogPath)
			if err != nil {
				t.Fatalf("failed to read log %q: %v", res.LogPath, err)
			}
			if !strings.Contains(string(data), "TASK="+res.TaskID) {
				t.Fatalf("log for %q missing task marker, content: %s", res.TaskID, string(data))
			}
			_ = os.Remove(res.LogPath)
		}
	})
}

func TestExecutorSignalAndTermination(t *testing.T) {
	forceKillDelay.Store(0)
	defer forceKillDelay.Store(5)

	proc := &execFakeProcess{pid: 42}
	cmd := &execFakeRunner{process: proc}

	origNotify := signalNotifyFn
	origStop := signalStopFn
	defer func() {
		signalNotifyFn = origNotify
		signalStopFn = origStop
	}()

	signalNotifyFn = func(c chan<- os.Signal, sigs ...os.Signal) {
		go func() { c <- syscall.SIGINT }()
	}
	signalStopFn = func(c chan<- os.Signal) {}

	forwardSignals(context.Background(), cmd, func(string) {})
	time.Sleep(20 * time.Millisecond)

	proc.mu.Lock()
	signalled := len(proc.signals)
	proc.mu.Unlock()
	if signalled == 0 {
		t.Fatalf("process did not receive signal")
	}
	if proc.killed.Load() == 0 {
		t.Fatalf("process was not killed after signal")
	}

	timer := terminateProcess(cmd)
	if timer == nil {
		t.Fatalf("terminateProcess returned nil timer")
	}
	timer.Stop()

	ft := terminateCommand(cmd)
	if ft == nil {
		t.Fatalf("terminateCommand returned nil")
	}
	ft.Stop()

	cmdKill := &execFakeRunner{process: &execFakeProcess{pid: 50}}
	ftKill := terminateCommand(cmdKill)
	time.Sleep(10 * time.Millisecond)
	if p, ok := cmdKill.process.(*execFakeProcess); ok && p.killed.Load() == 0 {
		t.Fatalf("terminateCommand did not kill process")
	}
	ftKill.Stop()

	cmdKill2 := &execFakeRunner{process: &execFakeProcess{pid: 51}}
	timer2 := terminateProcess(cmdKill2)
	time.Sleep(10 * time.Millisecond)
	if p, ok := cmdKill2.process.(*execFakeProcess); ok && p.killed.Load() == 0 {
		t.Fatalf("terminateProcess did not kill process")
	}
	timer2.Stop()

	if terminateCommand(nil) != nil {
		t.Fatalf("terminateCommand should return nil for nil cmd")
	}
	if terminateCommand(&execFakeRunner{allowNilProcess: true}) != nil {
		t.Fatalf("terminateCommand should return nil when process is nil")
	}
	if terminateProcess(nil) != nil {
		t.Fatalf("terminateProcess should return nil for nil cmd")
	}
	if terminateProcess(&execFakeRunner{allowNilProcess: true}) != nil {
		t.Fatalf("terminateProcess should return nil when process is nil")
	}

	signalNotifyFn = func(c chan<- os.Signal, sigs ...os.Signal) {}
	ctxDone, cancelDone := context.WithCancel(context.Background())
	cancelDone()
	forwardSignals(ctxDone, &execFakeRunner{process: &execFakeProcess{pid: 70}}, func(string) {})
}

func TestExecutorCancelReasonAndCloseWithReason(t *testing.T) {
	if reason := cancelReason("", nil); !strings.Contains(reason, "Context") {
		t.Fatalf("unexpected cancelReason for nil ctx: %s", reason)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 0)
	defer cancel()
	if !strings.Contains(cancelReason("cmd", ctx), "timeout") {
		t.Fatalf("expected timeout reason")
	}
	cancelCtx, cancelFn := context.WithCancel(context.Background())
	cancelFn()
	if !strings.Contains(cancelReason("cmd", cancelCtx), "Execution cancelled") {
		t.Fatalf("expected cancellation reason")
	}
	if !strings.Contains(cancelReason("", cancelCtx), "codex") {
		t.Fatalf("expected default command name in cancel reason")
	}

	rc := &reasonReadCloser{r: strings.NewReader("data"), closedC: make(chan struct{}, 1)}
	closeWithReason(rc, "why")
	select {
	case <-rc.closedC:
	default:
		t.Fatalf("CloseWithReason was not called")
	}

	plain := io.NopCloser(strings.NewReader("x"))
	closeWithReason(plain, "noop")
	closeWithReason(nil, "noop")
}

func TestExecutorForceKillTimerStop(t *testing.T) {
	done := make(chan struct{}, 1)
	ft := &forceKillTimer{timer: time.AfterFunc(50*time.Millisecond, func() { done <- struct{}{} }), done: done}
	ft.Stop()

	done2 := make(chan struct{}, 1)
	ft2 := &forceKillTimer{timer: time.AfterFunc(0, func() { done2 <- struct{}{} }), done: done2}
	time.Sleep(10 * time.Millisecond)
	ft2.Stop()

	var nilTimer *forceKillTimer
	nilTimer.Stop()
	(&forceKillTimer{}).Stop()
}

func TestExecutorForwardSignalsDefaults(t *testing.T) {
	origNotify := signalNotifyFn
	origStop := signalStopFn
	signalNotifyFn = nil
	signalStopFn = nil
	defer func() {
		signalNotifyFn = origNotify
		signalStopFn = origStop
	}()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	forwardSignals(ctx, &execFakeRunner{process: &execFakeProcess{pid: 80}}, func(string) {})
	time.Sleep(10 * time.Millisecond)
}

func TestExecutorSharedLogFalseWhenCustomLogPath(t *testing.T) {
	devNull, err := os.OpenFile(os.DevNull, os.O_WRONLY, 0)
	if err != nil {
		t.Fatalf("failed to open %s: %v", os.DevNull, err)
	}
	oldStderr := os.Stderr
	os.Stderr = devNull
	t.Cleanup(func() {
		os.Stderr = oldStderr
		_ = devNull.Close()
	})

	tempDir := t.TempDir()
	t.Setenv("TMPDIR", tempDir)

	// Setup: 创建主 logger
	mainLogger, err := NewLoggerWithSuffix("shared-main")
	if err != nil {
		t.Fatalf("NewLoggerWithSuffix() error = %v", err)
	}
	setLogger(mainLogger)
	defer func() {
		_ = closeLogger()
		_ = os.Remove(mainLogger.Path())
	}()

	// 模拟场景：task logger 创建失败（通过设置只读的 TMPDIR），
	// 回退到主 logger（handle.shared=true），
	// 但 runCodexTaskFn 返回自定义的 LogPath（不等于主 logger 的路径）
	roDir := filepath.Join(tempDir, "ro")
	if err := os.Mkdir(roDir, 0o500); err != nil {
		t.Fatalf("failed to create read-only dir: %v", err)
	}
	t.Setenv("TMPDIR", roDir)

	orig := runCodexTaskFn
	customLogPath := "/custom/path/to.log"
	runCodexTaskFn = func(task TaskSpec, timeout int) TaskResult {
		// 返回自定义 LogPath，不等于主 logger 的路径
		return TaskResult{
			TaskID:   task.ID,
			ExitCode: 0,
			LogPath:  customLogPath,
		}
	}
	defer func() { runCodexTaskFn = orig }()

	// 执行任务
	results := executeConcurrentWithContext(context.Background(), [][]TaskSpec{{{ID: "task1"}}}, 1, 0)

	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	res := results[0]
	// 关键断言：即使 handle.shared=true（因为 task logger 创建失败），
	// 但因为 LogPath 不等于主 logger 的路径，sharedLog 应为 false
	if res.sharedLog {
		t.Fatalf("expected sharedLog=false when LogPath differs from shared logger, got true")
	}

	// 验证 LogPath 确实是自定义的
	if res.LogPath != customLogPath {
		t.Fatalf("expected custom LogPath %s, got %s", customLogPath, res.LogPath)
	}
}
