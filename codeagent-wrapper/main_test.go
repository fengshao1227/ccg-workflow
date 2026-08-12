package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

// Helper to reset test hooks
func resetTestHooks() {
	stdinReader = os.Stdin
	isTerminalFn = defaultIsTerminal
	codexCommand = "codex"
	cleanupHook = nil
	cleanupLogsFn = cleanupOldLogs
	signalNotifyFn = signal.Notify
	signalStopFn = signal.Stop
	buildCodexArgsFn = buildCodexArgs
	selectBackendFn = selectBackend
	commandContext = exec.CommandContext
	newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
		return &realCmd{cmd: commandContext(ctx, name, args...)}
	}
	jsonMarshal = json.Marshal
	forceKillDelay.Store(5)
	closeLogger()
	executablePathFn = os.Executable
	runTaskFn = runCodexTask
	runCodexTaskFn = defaultRunCodexTaskFn
	exitFn = os.Exit
}

type capturedStdout struct {
	buf    bytes.Buffer
	old    *os.File
	reader *os.File
	writer *os.File
}

type errReader struct {
	err error
}

func (e errReader) Read([]byte) (int, error) {
	return 0, e.err
}

type testBackend struct {
	name    string
	command string
	argsFn  func(*Config, string) []string
}

func (t testBackend) Name() string {
	if t.name != "" {
		return t.name
	}
	return "test-backend"
}

func (t testBackend) BuildArgs(cfg *Config, targetArg string) []string {
	if t.argsFn != nil {
		return t.argsFn(cfg, targetArg)
	}
	return []string{targetArg}
}

func (t testBackend) Command() string {
	if t.command != "" {
		return t.command
	}
	return "echo"
}

func withBackend(command string, argsFn func(*Config, string) []string) func() {
	prev := selectBackendFn
	selectBackendFn = func(name string) (Backend, error) {
		return testBackend{name: name, command: command, argsFn: argsFn}, nil
	}
	return func() { selectBackendFn = prev }
}

func captureStdoutPipe() *capturedStdout {
	r, w, _ := os.Pipe()
	state := &capturedStdout{old: os.Stdout, reader: r, writer: w}
	os.Stdout = w
	return state
}

func restoreStdoutPipe(c *capturedStdout) {
	if c == nil {
		return
	}
	c.writer.Close()
	os.Stdout = c.old
	io.Copy(&c.buf, c.reader)
}

func (c *capturedStdout) String() string {
	if c == nil {
		return ""
	}
	return c.buf.String()
}

func captureOutput(t *testing.T, fn func()) string {
	t.Helper()
	r, w, _ := os.Pipe()
	old := os.Stdout
	os.Stdout = w
	fn()
	w.Close()
	os.Stdout = old

	var buf bytes.Buffer
	io.Copy(&buf, r)
	return buf.String()
}

func captureStderr(t *testing.T, fn func()) string {
	t.Helper()
	r, w, _ := os.Pipe()
	old := os.Stderr
	os.Stderr = w
	fn()
	w.Close()
	os.Stderr = old

	var buf bytes.Buffer
	io.Copy(&buf, r)
	return buf.String()
}

type ctxAwareReader struct {
	reader io.ReadCloser
	mu     sync.Mutex
	reason string
	closed bool
}

func newCtxAwareReader(r io.ReadCloser) *ctxAwareReader {
	return &ctxAwareReader{reader: r}
}

func (r *ctxAwareReader) Read(p []byte) (int, error) {
	if r.reader == nil {
		return 0, io.EOF
	}
	return r.reader.Read(p)
}

func (r *ctxAwareReader) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed || r.reader == nil {
		r.closed = true
		return nil
	}
	r.closed = true
	return r.reader.Close()
}

func (r *ctxAwareReader) CloseWithReason(reason string) error {
	r.mu.Lock()
	if !r.closed {
		r.reason = reason
	}
	r.mu.Unlock()
	return r.Close()
}

func (r *ctxAwareReader) Reason() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.reason
}

type drainBlockingStdout struct {
	inner *ctxAwareReader
}

func newDrainBlockingStdout(inner *ctxAwareReader) *drainBlockingStdout {
	return &drainBlockingStdout{inner: inner}
}

func (d *drainBlockingStdout) Read(p []byte) (int, error) {
	return d.inner.Read(p)
}

func (d *drainBlockingStdout) Close() error {
	return d.inner.Close()
}

func (d *drainBlockingStdout) CloseWithReason(reason string) error {
	if reason != stdoutCloseReasonDrain {
		return nil
	}
	return d.inner.CloseWithReason(reason)
}

type drainBlockingCmd struct {
	inner    *fakeCmd
	injected atomic.Bool
}

func newDrainBlockingCmd(inner *fakeCmd) *drainBlockingCmd {
	return &drainBlockingCmd{inner: inner}
}

func (d *drainBlockingCmd) Start() error {
	return d.inner.Start()
}

func (d *drainBlockingCmd) Wait() error {
	return d.inner.Wait()
}

func (d *drainBlockingCmd) StdoutPipe() (io.ReadCloser, error) {
	stdout, err := d.inner.StdoutPipe()
	if err != nil {
		return nil, err
	}
	ctxReader, ok := stdout.(*ctxAwareReader)
	if !ok {
		return stdout, nil
	}
	d.injected.Store(true)
	return newDrainBlockingStdout(ctxReader), nil
}

func (d *drainBlockingCmd) StdinPipe() (io.WriteCloser, error) {
	return d.inner.StdinPipe()
}

func (d *drainBlockingCmd) SetStderr(w io.Writer) {
	d.inner.SetStderr(w)
}

func (d *drainBlockingCmd) SetDir(dir string) {
	d.inner.SetDir(dir)
}

func (d *drainBlockingCmd) SetEnv(env map[string]string) {
	d.inner.SetEnv(env)
}

func (d *drainBlockingCmd) Process() processHandle {
	return d.inner.Process()
}

type bufferWriteCloser struct {
	buf    bytes.Buffer
	mu     sync.Mutex
	closed bool
}

func newBufferWriteCloser() *bufferWriteCloser {
	return &bufferWriteCloser{}
}

func (b *bufferWriteCloser) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return 0, io.ErrClosedPipe
	}
	return b.buf.Write(p)
}

func (b *bufferWriteCloser) Close() error {
	b.mu.Lock()
	b.closed = true
	b.mu.Unlock()
	return nil
}

func (b *bufferWriteCloser) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

type fakeProcess struct {
	pid         int
	killed      atomic.Bool
	mu          sync.Mutex
	signals     []os.Signal
	signalCount atomic.Int32
	killCount   atomic.Int32
	onSignal    func(os.Signal)
	onKill      func()
}

func newFakeProcess(pid int) *fakeProcess {
	if pid == 0 {
		pid = 4242
	}
	return &fakeProcess{pid: pid}
}

func (p *fakeProcess) Pid() int {
	return p.pid
}

func (p *fakeProcess) Kill() error {
	p.killed.Store(true)
	p.killCount.Add(1)
	if p.onKill != nil {
		p.onKill()
	}
	return nil
}

func (p *fakeProcess) Signal(sig os.Signal) error {
	p.mu.Lock()
	p.signals = append(p.signals, sig)
	p.mu.Unlock()
	p.signalCount.Add(1)
	if p.onSignal != nil {
		p.onSignal(sig)
	}
	return nil
}

func (p *fakeProcess) Signals() []os.Signal {
	p.mu.Lock()
	defer p.mu.Unlock()
	cp := make([]os.Signal, len(p.signals))
	copy(cp, p.signals)
	return cp
}

func (p *fakeProcess) Killed() bool {
	return p.killed.Load()
}

func (p *fakeProcess) SignalCount() int {
	return int(p.signalCount.Load())
}

func (p *fakeProcess) KillCount() int {
	return int(p.killCount.Load())
}

type fakeStdoutEvent struct {
	Delay time.Duration
	Data  string
}

type fakeCmdConfig struct {
	StdoutPlan          []fakeStdoutEvent
	WaitDelay           time.Duration
	WaitErr             error
	StartErr            error
	PID                 int
	KeepStdoutOpen      bool
	BlockWait           bool
	ReleaseWaitOnKill   bool
	ReleaseWaitOnSignal bool
}

type fakeCmd struct {
	mu sync.Mutex

	stdout         *ctxAwareReader
	stdoutWriter   *io.PipeWriter
	stdoutPlan     []fakeStdoutEvent
	stdoutOnce     sync.Once
	stdoutClaim    bool
	keepStdoutOpen bool

	stdoutWriteMu sync.Mutex

	stdinWriter *bufferWriteCloser
	stdinClaim  bool

	stderr io.Writer

	env map[string]string

	waitDelay time.Duration
	waitErr   error
	startErr  error

	waitOnce        sync.Once
	waitDone        chan struct{}
	waitResult      error
	waitReleaseCh   chan struct{}
	waitReleaseOnce sync.Once
	waitBlocked     bool

	started bool

	startCount      atomic.Int32
	waitCount       atomic.Int32
	stdoutPipeCount atomic.Int32

	process *fakeProcess
}

func newFakeCmd(cfg fakeCmdConfig) *fakeCmd {
	r, w := io.Pipe()
	cmd := &fakeCmd{
		stdout:         newCtxAwareReader(r),
		stdoutWriter:   w,
		stdoutPlan:     append([]fakeStdoutEvent(nil), cfg.StdoutPlan...),
		stdinWriter:    newBufferWriteCloser(),
		waitDelay:      cfg.WaitDelay,
		waitErr:        cfg.WaitErr,
		startErr:       cfg.StartErr,
		waitDone:       make(chan struct{}),
		keepStdoutOpen: cfg.KeepStdoutOpen,
		process:        newFakeProcess(cfg.PID),
	}
	if len(cmd.stdoutPlan) == 0 {
		cmd.stdoutPlan = nil
	}
	if cfg.BlockWait {
		cmd.waitBlocked = true
		cmd.waitReleaseCh = make(chan struct{})
		releaseOnSignal := cfg.ReleaseWaitOnSignal
		releaseOnKill := cfg.ReleaseWaitOnKill
		if !releaseOnSignal && !releaseOnKill {
			releaseOnKill = true
		}
		cmd.process.onSignal = func(os.Signal) {
			if releaseOnSignal {
				cmd.releaseWait()
			}
		}
		cmd.process.onKill = func() {
			if releaseOnKill {
				cmd.releaseWait()
			}
		}
	}
	return cmd
}

func (f *fakeCmd) Start() error {
	f.mu.Lock()
	if f.started {
		f.mu.Unlock()
		return errors.New("start already called")
	}
	f.started = true
	f.mu.Unlock()

	f.startCount.Add(1)

	if f.startErr != nil {
		f.waitOnce.Do(func() {
			f.waitResult = f.startErr
			close(f.waitDone)
		})
		return f.startErr
	}

	go f.runStdoutScript()
	return nil
}

func (f *fakeCmd) Wait() error {
	f.waitCount.Add(1)
	f.waitOnce.Do(func() {
		if f.waitBlocked && f.waitReleaseCh != nil {
			<-f.waitReleaseCh
		} else if f.waitDelay > 0 {
			time.Sleep(f.waitDelay)
		}
		f.waitResult = f.waitErr
		close(f.waitDone)
	})
	<-f.waitDone
	return f.waitResult
}

func (f *fakeCmd) StdoutPipe() (io.ReadCloser, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.stdoutClaim {
		return nil, errors.New("stdout pipe already claimed")
	}
	f.stdoutClaim = true
	f.stdoutPipeCount.Add(1)
	return f.stdout, nil
}

func (f *fakeCmd) StdinPipe() (io.WriteCloser, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.stdinClaim {
		return nil, errors.New("stdin pipe already claimed")
	}
	f.stdinClaim = true
	return f.stdinWriter, nil
}

func (f *fakeCmd) SetStderr(w io.Writer) {
	f.stderr = w
}

func (f *fakeCmd) SetDir(string) {}

func (f *fakeCmd) SetEnv(env map[string]string) {
	if len(env) == 0 {
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.env == nil {
		f.env = make(map[string]string, len(env))
	}
	for k, v := range env {
		f.env[k] = v
	}
}

func (f *fakeCmd) Process() processHandle {
	if f == nil {
		return nil
	}
	return f.process
}

func (f *fakeCmd) runStdoutScript() {
	if len(f.stdoutPlan) == 0 {
		if !f.keepStdoutOpen {
			f.CloseStdout(nil)
		}
		return
	}
	for _, ev := range f.stdoutPlan {
		if ev.Delay > 0 {
			time.Sleep(ev.Delay)
		}
		f.WriteStdout(ev.Data)
	}
	if !f.keepStdoutOpen {
		f.CloseStdout(nil)
	}
}

func (f *fakeCmd) releaseWait() {
	if f.waitReleaseCh == nil {
		return
	}
	f.waitReleaseOnce.Do(func() {
		close(f.waitReleaseCh)
	})
}

func (f *fakeCmd) WriteStdout(data string) {
	if data == "" {
		return
	}
	f.stdoutWriteMu.Lock()
	defer f.stdoutWriteMu.Unlock()
	if f.stdoutWriter != nil {
		_, _ = io.WriteString(f.stdoutWriter, data)
	}
}

func (f *fakeCmd) CloseStdout(err error) {
	f.stdoutOnce.Do(func() {
		if f.stdoutWriter == nil {
			return
		}
		if err != nil {
			_ = f.stdoutWriter.CloseWithError(err)
			return
		}
		_ = f.stdoutWriter.Close()
	})
}

func (f *fakeCmd) StdinContents() string {
	if f.stdinWriter == nil {
		return ""
	}
	return f.stdinWriter.String()
}

func createFakeCodexScript(t *testing.T, threadID, message string) string {
	t.Helper()
	scriptPath := filepath.Join(t.TempDir(), "codex.sh")
	script := fmt.Sprintf(`#!/bin/sh
printf '%%s\n' '{"type":"thread.started","thread_id":"%s"}'
printf '%%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"%s"}}'
`, threadID, message)
	if err := os.WriteFile(scriptPath, []byte(script), 0o755); err != nil {
		t.Fatalf("failed to create fake codex script: %v", err)
	}
	return scriptPath
}

func TestFakeCmdInfra(t *testing.T) {
	t.Run("pipes and wait scheduling", func(t *testing.T) {
		fake := newFakeCmd(fakeCmdConfig{
			StdoutPlan: []fakeStdoutEvent{
				{Data: "line1\n"},
				{Delay: 5 * time.Millisecond, Data: "line2\n"},
			},
			WaitDelay: 20 * time.Millisecond,
		})

		stdout, err := fake.StdoutPipe()
		if err != nil {
			t.Fatalf("StdoutPipe() error = %v", err)
		}

		if err := fake.Start(); err != nil {
			t.Fatalf("Start() error = %v", err)
		}

		scanner := bufio.NewScanner(stdout)
		var lines []string
		for scanner.Scan() {
			lines = append(lines, scanner.Text())
			if len(lines) == 2 {
				break
			}
		}
		if err := scanner.Err(); err != nil {
			t.Fatalf("scanner error: %v", err)
		}
		if len(lines) != 2 || lines[0] != "line1" || lines[1] != "line2" {
			t.Fatalf("unexpected stdout lines: %v", lines)
		}

		ctxReader, ok := stdout.(*ctxAwareReader)
		if !ok {
			t.Fatalf("stdout pipe is %T, want *ctxAwareReader", stdout)
		}
		if err := ctxReader.CloseWithReason("test-complete"); err != nil {
			t.Fatalf("CloseWithReason error: %v", err)
		}
		if ctxReader.Reason() != "test-complete" {
			t.Fatalf("CloseWithReason reason mismatch: %q", ctxReader.Reason())
		}

		waitStart := time.Now()
		if err := fake.Wait(); err != nil {
			t.Fatalf("Wait() error = %v", err)
		}
		if elapsed := time.Since(waitStart); elapsed < 20*time.Millisecond {
			t.Fatalf("Wait() returned too early: %v", elapsed)
		}

		if fake.startCount.Load() != 1 {
			t.Fatalf("Start() count = %d, want 1", fake.startCount.Load())
		}
		if fake.waitCount.Load() != 1 {
			t.Fatalf("Wait() count = %d, want 1", fake.waitCount.Load())
		}
		if fake.stdoutPipeCount.Load() != 1 {
			t.Fatalf("StdoutPipe() count = %d, want 1", fake.stdoutPipeCount.Load())
		}
	})

	t.Run("integration with runCodexTask", func(t *testing.T) {
		defer resetTestHooks()

		fake := newFakeCmd(fakeCmdConfig{
			StdoutPlan: []fakeStdoutEvent{
				{Data: `{"type":"thread.started","thread_id":"fake-thread"}` + "\n"},
				{
					Delay: time.Millisecond,
					Data:  `{"type":"item.completed","item":{"type":"agent_message","text":"fake-msg"}}` + "\n",
				},
			},
			WaitDelay: 5 * time.Millisecond,
		})

		newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
			return fake
		}
		buildCodexArgsFn = func(cfg *Config, targetArg string) []string {
			return []string{targetArg}
		}
		codexCommand = "fake-cmd"

		res := runCodexTask(TaskSpec{Task: "ignored"}, false, 2)
		if res.ExitCode != 0 {
			t.Fatalf("runCodexTask exit = %d, want 0 (%s)", res.ExitCode, res.Error)
		}
		if res.Message != "fake-msg" {
			t.Fatalf("message = %q, want fake-msg", res.Message)
		}
		if res.SessionID != "fake-thread" {
			t.Fatalf("sessionID = %q, want fake-thread", res.SessionID)
		}
		if fake.startCount.Load() != 1 {
			t.Fatalf("Start() count = %d, want 1", fake.startCount.Load())
		}
		if fake.waitCount.Load() != 1 {
			t.Fatalf("Wait() count = %d, want 1", fake.waitCount.Load())
		}
	})
}

func TestRunCodexTask_WaitBeforeParse(t *testing.T) {
	defer resetTestHooks()

	const (
		threadID   = "wait-first-thread"
		message    = "wait-first-message"
		waitDelay  = 100 * time.Millisecond
		extraDelay = 2 * time.Second
	)

	fake := newFakeCmd(fakeCmdConfig{
		StdoutPlan: []fakeStdoutEvent{
			{Data: fmt.Sprintf(`{"type":"thread.started","thread_id":"%s"}`+"\n", threadID)},
			{Data: fmt.Sprintf(`{"type":"item.completed","item":{"type":"agent_message","text":"%s"}}`+"\n", message)},
			{Delay: extraDelay},
		},
		WaitDelay: waitDelay,
	})

	newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
		return fake
	}
	buildCodexArgsFn = func(cfg *Config, targetArg string) []string {
		return []string{targetArg}
	}
	codexCommand = "fake-cmd"

	start := time.Now()
	result := runCodexTask(TaskSpec{Task: "ignored"}, false, 5)
	elapsed := time.Since(start)

	if result.ExitCode != 0 {
		t.Fatalf("runCodexTask exit = %d, want 0 (%s)", result.ExitCode, result.Error)
	}
	if result.Message != message {
		t.Fatalf("message = %q, want %q", result.Message, message)
	}
	if result.SessionID != threadID {
		t.Fatalf("sessionID = %q, want %q", result.SessionID, threadID)
	}
	if elapsed >= extraDelay {
		t.Fatalf("runCodexTask took %v, want < %v", elapsed, extraDelay)
	}

	if fake.stdout == nil {
		t.Fatalf("stdout reader not initialized")
	}
	if reason := fake.stdout.Reason(); reason != stdoutCloseReasonWait {
		t.Fatalf("stdout close reason = %q, want %q", reason, stdoutCloseReasonWait)
	}
}

func TestRunCodexTask_ParseStall(t *testing.T) {
	defer resetTestHooks()

	const threadID = "stall-thread"
	startG := runtime.NumGoroutine()

	fake := newFakeCmd(fakeCmdConfig{
		StdoutPlan: []fakeStdoutEvent{
			{Data: fmt.Sprintf(`{"type":"thread.started","thread_id":"%s"}`+"\n", threadID)},
		},
		KeepStdoutOpen: true,
	})

	blockingCmd := newDrainBlockingCmd(fake)
	newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
		return blockingCmd
	}
	buildCodexArgsFn = func(cfg *Config, targetArg string) []string {
		return []string{targetArg}
	}
	codexCommand = "fake-cmd"

	start := time.Now()
	result := runCodexTask(TaskSpec{Task: "stall"}, false, 60)
	elapsed := time.Since(start)
	if !blockingCmd.injected.Load() {
		t.Fatalf("stdout wrapper was not installed")
	}

	if result.ExitCode == 0 || result.Error == "" {
		t.Fatalf("expected runCodexTask to error when parse stalls, got %+v", result)
	}
	errText := strings.ToLower(result.Error)
	if !strings.Contains(errText, "drain timeout") && !strings.Contains(errText, "agent_message") {
		t.Fatalf("error %q does not mention drain timeout or missing agent_message", result.Error)
	}

	if elapsed < stdoutDrainTimeout {
		t.Fatalf("runCodexTask returned after %v (reason=%s), want >= %v to confirm drainTimer firing", elapsed, fake.stdout.Reason(), stdoutDrainTimeout)
	}
	maxDuration := stdoutDrainTimeout + time.Second
	if elapsed >= maxDuration {
		t.Fatalf("runCodexTask took %v, want < %v", elapsed, maxDuration)
	}

	if fake.stdout == nil {
		t.Fatalf("stdout reader not initialized")
	}
	if !fake.stdout.closed {
		t.Fatalf("stdout reader still open; drainTimer should force close")
	}
	if reason := fake.stdout.Reason(); reason != stdoutCloseReasonDrain {
		t.Fatalf("stdout close reason = %q, want %q", reason, stdoutCloseReasonDrain)
	}

	deadline := time.Now().Add(500 * time.Millisecond)
	allowed := startG + 8
	finalG := runtime.NumGoroutine()
	for finalG > allowed && time.Now().Before(deadline) {
		runtime.Gosched()
		time.Sleep(10 * time.Millisecond)
		runtime.GC()
		finalG = runtime.NumGoroutine()
	}
	if finalG > allowed {
		t.Fatalf("goroutines leaked: before=%d after=%d", startG, finalG)
	}
}

func TestRunCodexTask_ContextTimeout(t *testing.T) {
	defer resetTestHooks()
	forceKillDelay.Store(0)

	fake := newFakeCmd(fakeCmdConfig{
		KeepStdoutOpen:      true,
		BlockWait:           true,
		ReleaseWaitOnKill:   true,
		ReleaseWaitOnSignal: false,
	})

	newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
		return fake
	}
	buildCodexArgsFn = func(cfg *Config, targetArg string) []string {
		return []string{targetArg}
	}
	codexCommand = "fake-cmd"

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	var capturedTimer *forceKillTimer
	terminateCommandFn = func(cmd commandRunner) *forceKillTimer {
		timer := terminateCommand(cmd)
		capturedTimer = timer
		return timer
	}
	defer func() { terminateCommandFn = terminateCommand }()

	result := runCodexTaskWithContext(ctx, TaskSpec{Task: "ctx-timeout", WorkDir: defaultWorkdir}, nil, nil, false, false, 60)

	if result.ExitCode != 124 {
		t.Fatalf("exit code = %d, want 124 (%s)", result.ExitCode, result.Error)
	}
	if !strings.Contains(strings.ToLower(result.Error), "timeout") {
		t.Fatalf("error %q does not mention timeout", result.Error)
	}
	if fake.process == nil {
		t.Fatalf("fake process not initialized")
	}
	if fake.process.SignalCount() == 0 {
		t.Fatalf("expected SIGTERM to be sent, got 0")
	}
	if fake.process.KillCount() == 0 {
		t.Fatalf("expected Kill to eventually run, got 0")
	}
	if capturedTimer == nil {
		t.Fatalf("forceKillTimer not captured")
	}
	if !capturedTimer.stopped.Load() {
		t.Fatalf("forceKillTimer.Stop was not called")
	}
	if !capturedTimer.drained.Load() {
		t.Fatalf("forceKillTimer drain logic did not run")
	}
	if fake.stdout == nil {
		t.Fatalf("stdout reader not initialized")
	}
	if reason := fake.stdout.Reason(); reason != stdoutCloseReasonCtx {
		t.Fatalf("stdout close reason = %q, want %q", reason, stdoutCloseReasonCtx)
	}
}

func TestRunCodexTask_ForcesStopAfterCompletion(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping timing-sensitive integration test in short mode")
	}
	defer resetTestHooks()
	forceKillDelay.Store(0)

	fake := newFakeCmd(fakeCmdConfig{
		StdoutPlan: []fakeStdoutEvent{
			{Data: `{"type":"item.completed","item":{"type":"agent_message","text":"done"}}` + "\n"},
			{Data: `{"type":"thread.completed","thread_id":"tid"}` + "\n"},
		},
		KeepStdoutOpen:      true,
		BlockWait:           true,
		ReleaseWaitOnSignal: true,
		ReleaseWaitOnKill:   true,
	})

	newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
		return fake
	}
	buildCodexArgsFn = func(cfg *Config, targetArg string) []string { return []string{targetArg} }
	codexCommand = "fake-cmd"

	start := time.Now()
	result := runCodexTaskWithContext(context.Background(), TaskSpec{Task: "done", WorkDir: defaultWorkdir}, nil, nil, false, false, 60)
	duration := time.Since(start)

	if result.ExitCode != 0 || result.Message != "done" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if duration > 2*time.Second {
		t.Fatalf("runCodexTaskWithContext took too long: %v", duration)
	}
	if fake.process.SignalCount() == 0 {
		t.Fatalf("expected SIGTERM to be sent, got %d", fake.process.SignalCount())
	}
}

func TestRunCodexTask_DoesNotTerminateBeforeThreadCompleted(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping timing-sensitive integration test in short mode")
	}
	defer resetTestHooks()
	forceKillDelay.Store(0)

	fake := newFakeCmd(fakeCmdConfig{
		StdoutPlan: []fakeStdoutEvent{
			{Data: `{"type":"item.completed","item":{"type":"agent_message","text":"intermediate"}}` + "\n"},
			{Delay: 1100 * time.Millisecond, Data: `{"type":"item.completed","item":{"type":"agent_message","text":"final"}}` + "\n"},
			{Data: `{"type":"thread.completed","thread_id":"tid"}` + "\n"},
		},
		KeepStdoutOpen:      true,
		BlockWait:           true,
		ReleaseWaitOnSignal: true,
		ReleaseWaitOnKill:   true,
	})

	newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
		return fake
	}
	buildCodexArgsFn = func(cfg *Config, targetArg string) []string { return []string{targetArg} }
	codexCommand = "fake-cmd"

	start := time.Now()
	result := runCodexTaskWithContext(context.Background(), TaskSpec{Task: "done", WorkDir: defaultWorkdir}, nil, nil, false, false, 60)
	duration := time.Since(start)

	if result.ExitCode != 0 || result.Message != "final" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if duration > 5*time.Second {
		t.Fatalf("runCodexTaskWithContext took too long: %v", duration)
	}
	if fake.process.SignalCount() == 0 {
		t.Fatalf("expected SIGTERM to be sent, got %d", fake.process.SignalCount())
	}
}

func TestBackendParseArgs_NewMode(t *testing.T) {
	tests := []struct {
		name    string
		args    []string
		want    *Config
		wantErr bool
	}{
		{
			name: "simple task",
			args: []string{"codeagent-wrapper", "analyze code"},
			want: &Config{Mode: "new", Task: "analyze code", WorkDir: ".", ExplicitStdin: false, Backend: defaultBackendName},
		},
		{
			name: "task with workdir",
			args: []string{"codeagent-wrapper", "analyze code", "/path/to/dir"},
			want: &Config{Mode: "new", Task: "analyze code", WorkDir: "/path/to/dir", ExplicitStdin: false, Backend: defaultBackendName},
		},
		{
			name: "explicit stdin mode",
			args: []string{"codeagent-wrapper", "-"},
			want: &Config{Mode: "new", Task: "-", WorkDir: ".", ExplicitStdin: true, Backend: defaultBackendName},
		},
		{
			name: "stdin with workdir",
			args: []string{"codeagent-wrapper", "-", "/some/dir"},
			want: &Config{Mode: "new", Task: "-", WorkDir: "/some/dir", ExplicitStdin: true, Backend: defaultBackendName},
		},
		{name: "no args", args: []string{"codeagent-wrapper"}, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			os.Args = tt.args
			cfg, err := parseArgs()
			if tt.wantErr {
				if err == nil {
					t.Errorf("parseArgs() expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("parseArgs() unexpected error: %v", err)
			}
			if cfg.Mode != tt.want.Mode {
				t.Errorf("Mode = %v, want %v", cfg.Mode, tt.want.Mode)
			}
			if cfg.Task != tt.want.Task {
				t.Errorf("Task = %v, want %v", cfg.Task, tt.want.Task)
			}
			if cfg.WorkDir != tt.want.WorkDir {
				t.Errorf("WorkDir = %v, want %v", cfg.WorkDir, tt.want.WorkDir)
			}
			if cfg.ExplicitStdin != tt.want.ExplicitStdin {
				t.Errorf("ExplicitStdin = %v, want %v", cfg.ExplicitStdin, tt.want.ExplicitStdin)
			}
			if cfg.Backend != tt.want.Backend {
				t.Errorf("Backend = %v, want %v", cfg.Backend, tt.want.Backend)
			}
		})
	}
}

func TestBackendParseArgs_ResumeMode(t *testing.T) {
	tests := []struct {
		name    string
		args    []string
		want    *Config
		wantErr bool
	}{
		{
			name: "resume with task",
			args: []string{"codeagent-wrapper", "resume", "session-123", "continue task"},
			want: &Config{Mode: "resume", SessionID: "session-123", Task: "continue task", WorkDir: ".", ExplicitStdin: false, Backend: defaultBackendName},
		},
		{
			name: "resume with workdir",
			args: []string{"codeagent-wrapper", "resume", "session-456", "task", "/work"},
			want: &Config{Mode: "resume", SessionID: "session-456", Task: "task", WorkDir: "/work", ExplicitStdin: false, Backend: defaultBackendName},
		},
		{
			name: "resume with stdin",
			args: []string{"codeagent-wrapper", "resume", "session-789", "-"},
			want: &Config{Mode: "resume", SessionID: "session-789", Task: "-", WorkDir: ".", ExplicitStdin: true, Backend: defaultBackendName},
		},
		{name: "resume missing session_id", args: []string{"codeagent-wrapper", "resume"}, wantErr: true},
		{name: "resume missing task", args: []string{"codeagent-wrapper", "resume", "session-123"}, wantErr: true},
		{name: "resume empty session_id", args: []string{"codeagent-wrapper", "resume", "", "task"}, wantErr: true},
		{name: "resume whitespace session_id", args: []string{"codeagent-wrapper", "resume", "   ", "task"}, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			os.Args = tt.args
			cfg, err := parseArgs()
			if tt.wantErr {
				if err == nil {
					t.Errorf("parseArgs() expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("parseArgs() unexpected error: %v", err)
			}
			if cfg.Mode != tt.want.Mode || cfg.SessionID != tt.want.SessionID || cfg.Task != tt.want.Task || cfg.WorkDir != tt.want.WorkDir || cfg.ExplicitStdin != tt.want.ExplicitStdin {
				t.Errorf("parseArgs() mismatch: %+v vs %+v", cfg, tt.want)
			}
			if cfg.Backend != tt.want.Backend {
				t.Errorf("Backend = %v, want %v", cfg.Backend, tt.want.Backend)
			}
		})
	}
}

func TestBackendParseArgs_BackendFlag(t *testing.T) {
	tests := []struct {
		name    string
		args    []string
		want    string
		wantErr bool
	}{
		{
			name: "claude backend",
			args: []string{"codeagent-wrapper", "--backend", "claude", "task"},
			want: "claude",
		},
		{
			name: "gemini resume",
			args: []string{"codeagent-wrapper", "--backend", "gemini", "resume", "sid", "task"},
			want: "gemini",
		},
		{
			name: "backend equals syntax",
			args: []string{"codeagent-wrapper", "--backend=claude", "task"},
			want: "claude",
		},
		{
			name:    "missing backend value",
			args:    []string{"codeagent-wrapper", "--backend"},
			wantErr: true,
		},
		{
			name:    "backend equals missing value",
			args:    []string{"codeagent-wrapper", "--backend=", "task"},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			os.Args = tt.args
			cfg, err := parseArgs()
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if cfg.Backend != tt.want {
				t.Fatalf("Backend = %q, want %q", cfg.Backend, tt.want)
			}
		})
	}
}

func TestBackendParseArgs_SkipPermissions(t *testing.T) {
	const envKey = "CODEAGENT_SKIP_PERMISSIONS"
	t.Cleanup(func() { os.Unsetenv(envKey) })

	os.Setenv(envKey, "true")
	os.Args = []string{"codeagent-wrapper", "task"}
	cfg, err := parseArgs()
	if err != nil {
		t.Fatalf("parseArgs() unexpected error: %v", err)
	}
	if !cfg.SkipPermissions {
		t.Fatalf("SkipPermissions should default to true when env is set")
	}

	os.Args = []string{"codeagent-wrapper", "--skip-permissions=false", "task"}
	cfg, err = parseArgs()
	if err != nil {
		t.Fatalf("parseArgs() unexpected error: %v", err)
	}
	if cfg.SkipPermissions {
		t.Fatalf("SkipPermissions should be false when flag overrides env")
	}

	os.Args = []string{"codeagent-wrapper", "--skip-permissions", "task"}
	cfg, err = parseArgs()
	if err != nil {
		t.Fatalf("parseArgs() unexpected error: %v", err)
	}
	if !cfg.SkipPermissions {
		t.Fatalf("SkipPermissions should be true for plain --skip-permissions flag")
	}

	os.Args = []string{"codeagent-wrapper", "--dangerously-skip-permissions", "task"}
	cfg, err = parseArgs()
	if err != nil {
		t.Fatalf("parseArgs() unexpected error: %v", err)
	}
	if !cfg.SkipPermissions {
		t.Fatalf("SkipPermissions should be true for dangerous flag")
	}

	os.Args = []string{"codeagent-wrapper", "--dangerously-skip-permissions=false", "task"}
	cfg, err = parseArgs()
	if err != nil {
		t.Fatalf("parseArgs() unexpected error: %v", err)
	}
	if cfg.SkipPermissions {
		t.Fatalf("SkipPermissions should be false when dangerous flag is set to false")
	}
}

func TestBackendParseBoolFlag(t *testing.T) {
	tests := []struct {
		name string
		val  string
		def  bool
		want bool
	}{
		{"true literal", "true", false, true},
		{"false literal", "false", true, false},
		{"default on unknown", "maybe", true, true},
		{"empty uses default", "", false, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := parseBoolFlag(tt.val, tt.def); got != tt.want {
				t.Fatalf("parseBoolFlag(%q,%v) = %v, want %v", tt.val, tt.def, got, tt.want)
			}
		})
	}
}

func TestBackendEnvFlagEnabled(t *testing.T) {
	const key = "TEST_FLAG_ENABLED"
	t.Cleanup(func() { os.Unsetenv(key) })

	os.Unsetenv(key)
	if envFlagEnabled(key) {
		t.Fatalf("envFlagEnabled should be false when unset")
	}

	os.Setenv(key, "true")
	if !envFlagEnabled(key) {
		t.Fatalf("envFlagEnabled should be true for 'true'")
	}

	os.Setenv(key, "no")
	if envFlagEnabled(key) {
		t.Fatalf("envFlagEnabled should be false for 'no'")
	}
}

func TestParallelParseConfig_Success(t *testing.T) {
	input := `---TASK---
id: task-1
dependencies: task-0
---CONTENT---
do something`

	cfg, err := parseParallelConfig([]byte(input))
	if err != nil {
		t.Fatalf("parseParallelConfig() unexpected error: %v", err)
	}
	if len(cfg.Tasks) != 1 {
		t.Fatalf("expected 1 task, got %d", len(cfg.Tasks))
	}
	task := cfg.Tasks[0]
	if task.ID != "task-1" || task.Task != "do something" || task.WorkDir != defaultWorkdir || len(task.Dependencies) != 1 || task.Dependencies[0] != "task-0" {
		t.Fatalf("task mismatch: %+v", task)
	}
}

func TestParallelParseConfig_Backend(t *testing.T) {
	input := `---TASK---
id: task-1
backend: gemini
session_id: sess-123
---CONTENT---
do something`

	cfg, err := parseParallelConfig([]byte(input))
	if err != nil {
		t.Fatalf("parseParallelConfig() unexpected error: %v", err)
	}
	if len(cfg.Tasks) != 1 {
		t.Fatalf("expected 1 task, got %d", len(cfg.Tasks))
	}
	task := cfg.Tasks[0]
	if task.Backend != "gemini" {
		t.Fatalf("backend = %q, want gemini", task.Backend)
	}
	if task.Mode != "resume" || task.SessionID != "sess-123" {
		t.Fatalf("expected resume mode with session, got mode=%q session=%q", task.Mode, task.SessionID)
	}
}

func TestParallelParseConfig_EmptySessionID(t *testing.T) {
	input := `---TASK---
id: task-1
session_id:
---CONTENT---
do something`

	if _, err := parseParallelConfig([]byte(input)); err == nil {
		t.Fatalf("expected error for empty session_id, got nil")
	}
}

func TestParallelParseConfig_InvalidFormat(t *testing.T) {
	if _, err := parseParallelConfig([]byte("invalid format")); err == nil {
		t.Fatalf("expected error for invalid format, got nil")
	}
}

func TestParallelParseConfig_EmptyTasks(t *testing.T) {
	input := `---TASK---
id: empty
---CONTENT---
`
	if _, err := parseParallelConfig([]byte(input)); err == nil {
		t.Fatalf("expected error for empty tasks array, got nil")
	}
}

func TestParallelParseConfig_MissingID(t *testing.T) {
	input := `---TASK---
---CONTENT---
do something`
	if _, err := parseParallelConfig([]byte(input)); err == nil {
		t.Fatalf("expected error for missing id, got nil")
	}
}

func TestParallelParseConfig_MissingTask(t *testing.T) {
	input := `---TASK---
id: task-1
---CONTENT---
`
	if _, err := parseParallelConfig([]byte(input)); err == nil {
		t.Fatalf("expected error for missing task, got nil")
	}
}

func TestParallelParseConfig_DuplicateID(t *testing.T) {
	input := `---TASK---
id: dup
---CONTENT---
one
---TASK---
id: dup
---CONTENT---
two`
	if _, err := parseParallelConfig([]byte(input)); err == nil {
		t.Fatalf("expected error for duplicate id, got nil")
	}
}

func TestParallelParseConfig_DelimiterFormat(t *testing.T) {
	input := `---TASK---
id: T1
workdir: /tmp
---CONTENT---
echo 'test'
---TASK---
id: T2
dependencies: T1
---CONTENT---
code with special chars: $var "quotes"`

	cfg, err := parseParallelConfig([]byte(input))
	if err != nil {
		t.Fatalf("parseParallelConfig() error = %v", err)
	}
	if len(cfg.Tasks) != 2 {
		t.Fatalf("expected 2 tasks, got %d", len(cfg.Tasks))
	}
}

func TestRunShouldUseStdin(t *testing.T) {
	tests := []struct {
		name  string
		task  string
		piped bool
		want  bool
	}{
		{"simple task", "analyze code", false, false},
		{"piped input", "analyze code", true, true},
		{"contains newline", "line1\nline2", false, true},
		{"contains backslash", "path\\to\\file", false, true},
		{"contains double quote", `say "hi"`, false, true},
		{"contains single quote", "it's tricky", false, true},
		{"contains backtick", "use `code`", false, true},
		{"contains dollar", "price is $5", false, true},
		{"long task", strings.Repeat("a", 801), false, true},
		{"exactly 800 chars", strings.Repeat("a", 800), false, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := shouldUseStdin(tt.task, tt.piped)
			if got != tt.want {
				t.Errorf("shouldUseStdin(%q, %v) = %v, want %v", truncate(tt.task, 20), tt.piped, got, tt.want)
			}
		})
	}
}

func TestRunBuildCodexArgs_NewMode(t *testing.T) {
	const key = "CODEX_REQUIRE_APPROVAL"
	t.Cleanup(func() { os.Unsetenv(key) })
	os.Unsetenv(key)

	cfg := &Config{Mode: "new", WorkDir: "/test/dir"}
	args := buildCodexArgs(cfg, "my task")
	expected := []string{
		"e",
		"--dangerously-bypass-approvals-and-sandbox",
		"--skip-git-repo-check",
		"-C", "/test/dir",
		"--json",
		"my task",
	}
	if len(args) != len(expected) {
		t.Fatalf("len mismatch")
	}
	for i := range args {
		if args[i] != expected[i] {
			t.Fatalf("args[%d]=%s, want %s", i, args[i], expected[i])
		}
	}
}

func TestRunBuildCodexArgs_ResumeMode(t *testing.T) {
	const key = "CODEX_REQUIRE_APPROVAL"
	t.Cleanup(func() { os.Unsetenv(key) })
	os.Unsetenv(key)

	cfg := &Config{Mode: "resume", SessionID: "session-abc"}
	args := buildCodexArgs(cfg, "-")
	expected := []string{
		"e",
		"--dangerously-bypass-approvals-and-sandbox",
		"--skip-git-repo-check",
		"--json",
		"resume",
		"session-abc",
		"-",
	}
	if len(args) != len(expected) {
		t.Fatalf("len mismatch")
	}
	for i := range args {
		if args[i] != expected[i] {
			t.Fatalf("args[%d]=%s, want %s", i, args[i], expected[i])
		}
	}
}

func TestRunBuildCodexArgs_ResumeMode_EmptySessionHandledGracefully(t *testing.T) {
	const key = "CODEX_REQUIRE_APPROVAL"
	t.Cleanup(func() { os.Unsetenv(key) })
	os.Unsetenv(key)

	cfg := &Config{Mode: "resume", SessionID: "   ", WorkDir: "/test/dir"}
	args := buildCodexArgs(cfg, "task")
	expected := []string{"e", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "-C", "/test/dir", "--json", "task"}
	if len(args) != len(expected) {
		t.Fatalf("len mismatch")
	}
	for i := range args {
		if args[i] != expected[i] {
			t.Fatalf("args[%d]=%s, want %s", i, args[i], expected[i])
		}
	}
}

func TestRunBuildCodexArgs_RequireApprovalDisablesBypass(t *testing.T) {
	t.Setenv("CODEX_REQUIRE_APPROVAL", "true")

	cfg := &Config{Mode: "new", WorkDir: "/test/dir"}
	args := buildCodexArgs(cfg, "my task")
	for _, arg := range args {
		if arg == "--dangerously-bypass-approvals-and-sandbox" {
			t.Fatalf("bypass flag should NOT be present when CODEX_REQUIRE_APPROVAL=true, got %v", args)
		}
	}
}

func TestBackendSelectBackend(t *testing.T) {
	tests := []struct {
		name string
		in   string
		kind Backend
	}{
		{"codex", "codex", CodexBackend{}},
		{"claude mixed case", "ClAuDe", ClaudeBackend{}},
		{"gemini", "gemini", GeminiBackend{}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := selectBackend(tt.in)
			if err != nil {
				t.Fatalf("selectBackend() error = %v", err)
			}
			switch tt.kind.(type) {
			case CodexBackend:
				if _, ok := got.(CodexBackend); !ok {
					t.Fatalf("expected CodexBackend, got %T", got)
				}
			case ClaudeBackend:
				if _, ok := got.(ClaudeBackend); !ok {
					t.Fatalf("expected ClaudeBackend, got %T", got)
				}
			case GeminiBackend:
				if _, ok := got.(GeminiBackend); !ok {
					t.Fatalf("expected GeminiBackend, got %T", got)
				}
			}
		})
	}
}

func TestBackendSelectBackend_Invalid(t *testing.T) {
	if _, err := selectBackend("unknown"); err == nil {
		t.Fatalf("expected error for invalid backend")
	}
}

func TestBackendSelectBackend_DefaultOnEmpty(t *testing.T) {
	backend, err := selectBackend("")
	if err != nil {
		t.Fatalf("selectBackend(\"\") error = %v", err)
	}
	if _, ok := backend.(CodexBackend); !ok {
		t.Fatalf("expected default CodexBackend, got %T", backend)
	}
}

func TestBackendBuildArgs_CodexBackend(t *testing.T) {
	backend := CodexBackend{}
	cfg := &Config{Mode: "new", WorkDir: "/test/dir"}
	got := backend.BuildArgs(cfg, "task")
	want := []string{
		"e",
		"--dangerously-bypass-approvals-and-sandbox",
		"--skip-git-repo-check",
		"-C", "/test/dir",
		"--json",
		"task",
	}
	if len(got) != len(want) {
		t.Fatalf("length mismatch")
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("index %d got %s want %s", i, got[i], want[i])
		}
	}
}

func TestBackendBuildArgs_ClaudeBackend(t *testing.T) {
	backend := ClaudeBackend{}
	cfg := &Config{Mode: "new", WorkDir: defaultWorkdir}
	got := backend.BuildArgs(cfg, "todo")
	want := []string{"-p", "--dangerously-skip-permissions", "--setting-sources", "", "--output-format", "stream-json", "--verbose", "todo"}
	if len(got) != len(want) {
		t.Fatalf("args length=%d, want %d: %v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("index %d got %q want %q (args=%v)", i, got[i], want[i], got)
		}
	}

	if backend.BuildArgs(nil, "ignored") != nil {
		t.Fatalf("nil config should return nil args")
	}
}

func TestClaudeBackendBuildArgs_OutputValidation(t *testing.T) {
	backend := ClaudeBackend{}
	cfg := &Config{Mode: "resume"}
	target := "ensure-flags"

	args := backend.BuildArgs(cfg, target)
	want := []string{"-p", "--dangerously-skip-permissions", "--setting-sources", "", "--output-format", "stream-json", "--verbose", target}
	if len(args) != len(want) {
		t.Fatalf("args length=%d, want %d: %v", len(args), len(want), args)
	}
	for i := range want {
		if args[i] != want[i] {
			t.Fatalf("index %d got %q want %q (args=%v)", i, args[i], want[i], args)
		}
	}
}

func TestBackendBuildArgs_GeminiBackend(t *testing.T) {
	backend := GeminiBackend{}
	cfg := &Config{Mode: "new"}
	got := backend.BuildArgs(cfg, "task")
	want := []string{"-o", "stream-json", "-y", "-p", "task"}
	if len(got) != len(want) {
		t.Fatalf("length mismatch")
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("index %d got %s want %s", i, got[i], want[i])
		}
	}

	if backend.BuildArgs(nil, "ignored") != nil {
		t.Fatalf("nil config should return nil args")
	}
}

func TestGeminiBackendBuildArgs_OutputValidation(t *testing.T) {
	backend := GeminiBackend{}
	cfg := &Config{Mode: "resume"}
	target := "prompt-data"

	args := backend.BuildArgs(cfg, target)
	expected := []string{"-o", "stream-json", "-y", "-p"}

	if len(args) != len(expected)+1 {
		t.Fatalf("args length=%d, want %d", len(args), len(expected)+1)
	}
	for i, val := range expected {
		if args[i] != val {
			t.Fatalf("args[%d]=%q, want %q", i, args[i], val)
		}
	}
	if args[len(args)-1] != target {
		t.Fatalf("last arg=%q, want target %q", args[len(args)-1], target)
	}
}

func TestBackendNamesAndCommands(t *testing.T) {
	tests := []Backend{CodexBackend{}, ClaudeBackend{}, GeminiBackend{}}
	expected := []struct {
		name    string
		command string
	}{
		{"codex", "codex"},
		{"claude", "claude"},
		{"gemini", "gemini"},
	}

	for i, backend := range tests {
		if backend.Name() != expected[i].name {
			t.Fatalf("backend %d name = %s, want %s", i, backend.Name(), expected[i].name)
		}
		if backend.Command() != expected[i].command {
			t.Fatalf("backend %d command = %s, want %s", i, backend.Command(), expected[i].command)
		}
	}
}

func TestRunResolveTimeout(t *testing.T) {
	tests := []struct {
		name   string
		envVal string
		want   int
	}{
		{"empty env", "", 7200},
		{"milliseconds", "7200000", 7200},
		{"seconds", "3600", 3600},
		{"invalid", "invalid", 7200},
		{"negative", "-100", 7200},
		{"zero", "0", 7200},
		{"small milliseconds", "5000", 5000},
		{"boundary", "10000", 10000},
		{"above boundary", "10001", 10},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			os.Setenv("CODEX_TIMEOUT", tt.envVal)
			defer os.Unsetenv("CODEX_TIMEOUT")
			got := resolveTimeout()
			if got != tt.want {
				t.Errorf("resolveTimeout() with env=%q = %v, want %v", tt.envVal, got, tt.want)
			}
		})
	}
}

func TestRunNormalizeText(t *testing.T) {
	tests := []struct {
		name  string
		input interface{}
		want  string
	}{
		{"string", "hello world", "hello world"},
		{"string array", []interface{}{"hello", " ", "world"}, "hello world"},
		{"empty array", []interface{}{}, ""},
		{"mixed array", []interface{}{"text", 123, "more"}, "textmore"},
		{"nil", nil, ""},
		{"number", 123, ""},
		{"empty string", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := normalizeText(tt.input)
			if got != tt.want {
				t.Errorf("normalizeText(%v) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestBackendParseJSONStream(t *testing.T) {
	type testCase struct {
		name         string
		input        string
		wantMessage  string
		wantThreadID string
	}

	longText := strings.Repeat("a", 2*1024*1024)

	tests := []testCase{
		{"thread started and agent message", `{"type":"thread.started","thread_id":"abc-123"}
{"type":"item.completed","item":{"type":"agent_message","text":"Hello world"}}`, "Hello world", "abc-123"},
		{"multiple agent messages", `{"type":"item.completed","item":{"type":"agent_message","text":"First"}}
{"type":"item.completed","item":{"type":"agent_message","text":"Second"}}`, "Second", ""},
		{"text as array", `{"type":"item.completed","item":{"type":"agent_message","text":["Hello"," ","World"]}}`, "Hello World", ""},
		{"ignore other event types", `{"type":"other.event","data":"ignored"}
{"type":"item.completed","item":{"type":"other_type","text":"ignored"}}
{"type":"item.completed","item":{"type":"agent_message","text":"Valid"}}`, "Valid", ""},
		{"super long single line", `{"type":"item.completed","item":{"type":"agent_message","text":"` + longText + `"}}`, longText, ""},
		{"empty input", "", "", ""},
		{"item completed with nil item", strings.Join([]string{`{"type":"thread.started","thread_id":"nil-item-thread"}`, `{"type":"item.completed","item":null}`}, "\n"), "", "nil-item-thread"},
		{"agent message with non-string text", `{"type":"item.completed","item":{"type":"agent_message","text":12345}}`, "", ""},
		{"corrupted json does not break stream", strings.Join([]string{`{"type":"item.completed","item":{"type":"agent_message","text":"before"}}`, `{"type":"item.completed","item":{"type":"agent_message","text":"broken"}`, `{"type":"thread.started","thread_id":"after-thread"}`, `{"type":"item.completed","item":{"type":"agent_message","text":"after"}}`}, "\n"), "after", "after-thread"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotMessage, gotThreadID := parseJSONStream(strings.NewReader(tt.input))
			if gotMessage != tt.wantMessage {
				t.Errorf("message = %q, want %q", gotMessage, tt.wantMessage)
			}
			if gotThreadID != tt.wantThreadID {
				t.Errorf("threadID = %q, want %q", gotThreadID, tt.wantThreadID)
			}
		})
	}
}

func TestBackendParseJSONStream_ClaudeEvents(t *testing.T) {
	input := `{"type":"system","subtype":"init","session_id":"abc123"}
{"type":"result","subtype":"success","result":"Hello!","session_id":"abc123"}`

	message, threadID := parseJSONStream(strings.NewReader(input))

	if message != "Hello!" {
		t.Fatalf("message=%q, want %q", message, "Hello!")
	}
	if threadID != "abc123" {
		t.Fatalf("threadID=%q, want %q", threadID, "abc123")
	}
}

func TestBackendParseJSONStream_ClaudeEvents_ItemDoesNotForceCodex(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{
			name:  "null item",
			input: `{"type":"result","result":"OK","session_id":"abc123","item":null}`,
		},
		{
			name:  "empty object item",
			input: `{"type":"result","subtype":"x","result":"OK","session_id":"abc123","item":{}}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			message, threadID := parseJSONStream(strings.NewReader(tt.input))
			if message != "OK" {
				t.Fatalf("message=%q, want %q", message, "OK")
			}
			if threadID != "abc123" {
				t.Fatalf("threadID=%q, want %q", threadID, "abc123")
			}
		})
	}
}

func TestBackendParseJSONStream_GeminiEvents(t *testing.T) {
	input := `{"type":"init","session_id":"xyz789"}
{"type":"message","role":"assistant","content":"Hi","delta":true,"session_id":"xyz789"}
{"type":"message","role":"assistant","content":" there","delta":true}
{"type":"result","status":"success","session_id":"xyz789"}`

	message, threadID := parseJSONStream(strings.NewReader(input))

	if message != "Hi there" {
		t.Fatalf("message=%q, want %q", message, "Hi there")
	}
	if threadID != "xyz789" {
		t.Fatalf("threadID=%q, want %q", threadID, "xyz789")
	}
}

func TestBackendParseJSONStream_GeminiEvents_DeltaFalseStillDetected(t *testing.T) {
	input := `{"type":"init","session_id":"xyz789"}
{"type":"message","content":"Hi","delta":false,"session_id":"xyz789"}
{"type":"result","status":"success","session_id":"xyz789"}`

	message, threadID := parseJSONStream(strings.NewReader(input))

	if message != "Hi" {
		t.Fatalf("message=%q, want %q", message, "Hi")
	}
	if threadID != "xyz789" {
		t.Fatalf("threadID=%q, want %q", threadID, "xyz789")
	}
}

func TestBackendParseJSONStream_GeminiEvents_OnMessageTriggeredOnStatus(t *testing.T) {
	input := `{"type":"init","session_id":"xyz789"}
{"type":"message","role":"assistant","content":"Hi","delta":true,"session_id":"xyz789"}
{"type":"message","content":" there","delta":true}
{"type":"result","status":"success","session_id":"xyz789"}`

	var called int
	message, threadID := parseJSONStreamInternal(strings.NewReader(input), nil, nil, func() {
		called++
	}, nil)

	if message != "Hi there" {
		t.Fatalf("message=%q, want %q", message, "Hi there")
	}
	if threadID != "xyz789" {
		t.Fatalf("threadID=%q, want %q", threadID, "xyz789")
	}
	if called != 1 {
		t.Fatalf("onMessage called=%d, want %d", called, 1)
	}
}

func TestBackendParseJSONStreamWithWarn_InvalidLine(t *testing.T) {
	var warnings []string
	warnFn := func(msg string) { warnings = append(warnings, msg) }
	message, threadID := parseJSONStreamWithWarn(strings.NewReader("not-json"), warnFn)
	if message != "" || threadID != "" {
		t.Fatalf("expected empty output, got message=%q thread=%q", message, threadID)
	}
	if len(warnings) == 0 {
		t.Fatalf("expected warning to be emitted")
	}
}

func TestBackendParseJSONStream_OnMessage(t *testing.T) {
	var called int
	message, threadID := parseJSONStreamInternal(strings.NewReader(`{"type":"item.completed","item":{"type":"agent_message","text":"hook"}}`), nil, nil, func() {
		called++
	}, nil)
	if message != "hook" {
		t.Fatalf("message = %q, want hook", message)
	}
	if threadID != "" {
		t.Fatalf("threadID = %q, want empty", threadID)
	}
	if called == 0 {
		t.Fatalf("onMessage hook not invoked")
	}
}

func TestBackendParseJSONStream_OnComplete_CodexThreadCompleted(t *testing.T) {
	input := `{"type":"item.completed","item":{"type":"agent_message","text":"first"}}` + "\n" +
		`{"type":"item.completed","item":{"type":"agent_message","text":"second"}}` + "\n" +
		`{"type":"thread.completed","thread_id":"t-1"}`

	var onMessageCalls int
	var onCompleteCalls int
	message, threadID := parseJSONStreamInternal(strings.NewReader(input), nil, nil, func() {
		onMessageCalls++
	}, func() {
		onCompleteCalls++
	})
	if message != "second" {
		t.Fatalf("message = %q, want second", message)
	}
	if threadID != "t-1" {
		t.Fatalf("threadID = %q, want t-1", threadID)
	}
	if onMessageCalls != 2 {
		t.Fatalf("onMessage calls = %d, want 2", onMessageCalls)
	}
	if onCompleteCalls != 1 {
		t.Fatalf("onComplete calls = %d, want 1", onCompleteCalls)
	}
}

func TestBackendParseJSONStream_OnComplete_ClaudeResult(t *testing.T) {
	input := `{"type":"message","subtype":"stream","session_id":"s-1"}` + "\n" +
		`{"type":"result","result":"OK","session_id":"s-1"}`

	var onMessageCalls int
	var onCompleteCalls int
	message, threadID := parseJSONStreamInternal(strings.NewReader(input), nil, nil, func() {
		onMessageCalls++
	}, func() {
		onCompleteCalls++
	})
	if message != "OK" {
		t.Fatalf("message = %q, want OK", message)
	}
	if threadID != "s-1" {
		t.Fatalf("threadID = %q, want s-1", threadID)
	}
	if onMessageCalls != 1 {
		t.Fatalf("onMessage calls = %d, want 1", onMessageCalls)
	}
	if onCompleteCalls != 1 {
		t.Fatalf("onComplete calls = %d, want 1", onCompleteCalls)
	}
}

func TestBackendParseJSONStream_OnComplete_GeminiTerminalResultStatus(t *testing.T) {
	input := `{"type":"message","role":"assistant","content":"Hi","delta":true,"session_id":"g-1"}` + "\n" +
		`{"type":"result","status":"success","session_id":"g-1"}`

	var onMessageCalls int
	var onCompleteCalls int
	message, threadID := parseJSONStreamInternal(strings.NewReader(input), nil, nil, func() {
		onMessageCalls++
	}, func() {
		onCompleteCalls++
	})
	if message != "Hi" {
		t.Fatalf("message = %q, want Hi", message)
	}
	if threadID != "g-1" {
		t.Fatalf("threadID = %q, want g-1", threadID)
	}
	if onMessageCalls != 1 {
		t.Fatalf("onMessage calls = %d, want 1", onMessageCalls)
	}
	if onCompleteCalls != 1 {
		t.Fatalf("onComplete calls = %d, want 1", onCompleteCalls)
	}
}

func TestBackendParseJSONStream_ScannerError(t *testing.T) {
	var warnings []string
	warnFn := func(msg string) { warnings = append(warnings, msg) }
	message, threadID := parseJSONStreamInternal(errReader{err: errors.New("scan-fail")}, warnFn, nil, nil, nil)
	if message != "" || threadID != "" {
		t.Fatalf("expected empty output on scanner error, got message=%q threadID=%q", message, threadID)
	}
	if len(warnings) == 0 {
		t.Fatalf("expected warning on scanner error")
	}
}

func TestBackendDiscardInvalidJSON(t *testing.T) {
	reader := bufio.NewReader(strings.NewReader("line1\nline2\n"))
	newReader, err := discardInvalidJSON(nil, reader)
	if err != nil && !errors.Is(err, io.EOF) {
		t.Fatalf("unexpected error: %v", err)
	}
	line, _ := newReader.ReadString('\n')
	if strings.TrimSpace(line) != "line2" {
		t.Fatalf("expected to continue with remaining data, got %q", line)
	}

	readerNoNewline := bufio.NewReader(strings.NewReader("no newline"))
	if _, err := discardInvalidJSON(nil, readerNoNewline); err == nil {
		t.Fatalf("expected error when no newline present")
	}
}

func TestBackendHasKey(t *testing.T) {
	raw := map[string]json.RawMessage{
		"present": json.RawMessage(`true`),
	}

	if !hasKey(raw, "present") {
		t.Fatalf("expected key 'present' to be found")
	}
	if hasKey(raw, "absent") {
		t.Fatalf("did not expect key 'absent' to be found")
	}
}

func TestRunGetEnv(t *testing.T) {
	tests := []struct {
		name       string
		key        string
		defaultVal string
		envVal     string
		setEnv     bool
		want       string
	}{
		{"env set", "TEST_KEY", "default", "custom", true, "custom"},
		{"env not set", "TEST_KEY_MISSING", "default", "", false, "default"},
		{"env empty", "TEST_KEY_EMPTY", "default", "", true, "default"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			os.Unsetenv(tt.key)
			if tt.setEnv {
				os.Setenv(tt.key, tt.envVal)
				defer os.Unsetenv(tt.key)
			}

			got := getEnv(tt.key, tt.defaultVal)
			if got != tt.want {
				t.Errorf("getEnv(%q, %q) = %q, want %q", tt.key, tt.defaultVal, got, tt.want)
			}
		})
	}
}

func TestRunTruncate(t *testing.T) {
	tests := []struct {
		name   string
		input  string
		maxLen int
		want   string
	}{
		{"short string", "hello", 10, "hello"},
		{"exact length", "hello", 5, "hello"},
		{"truncate", "hello world", 5, "hello..."},
		{"empty", "", 5, ""},
		{"zero maxLen", "hello", 0, "..."},
		{"negative maxLen", "hello", -1, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := truncate(tt.input, tt.maxLen)
			if got != tt.want {
				t.Errorf("truncate(%q, %d) = %q, want %q", tt.input, tt.maxLen, got, tt.want)
			}
		})
	}

	if got := truncate("data", -1); got != "" {
		t.Fatalf("truncate should return empty string for negative maxLen, got %q", got)
	}
}

func TestRunMin(t *testing.T) {
	tests := []struct {
		a, b, want int
	}{{1, 2, 1}, {2, 1, 1}, {5, 5, 5}, {-1, 0, -1}, {0, -1, -1}}
	for _, tt := range tests {
		t.Run("", func(t *testing.T) {
			got := min(tt.a, tt.b)
			if got != tt.want {
				t.Errorf("min(%d, %d) = %d, want %d", tt.a, tt.b, got, tt.want)
			}
		})
	}
}

func TestTailBufferWrite(t *testing.T) {
	buf := &tailBuffer{limit: 5}
	if n, _ := buf.Write([]byte("123")); n != 3 || buf.String() != "123" {
		t.Fatalf("unexpected buffer content %q", buf.String())
	}

	if _, _ = buf.Write([]byte("4567")); buf.String() != "34567" {
		t.Fatalf("overflow case mismatch, got %q", buf.String())
	}

	if _, _ = buf.Write([]byte("abcdefgh")); buf.String() != "defgh" {
		t.Fatalf("len>=limit case mismatch, got %q", buf.String())
	}

	noLimit := &tailBuffer{limit: 0}
	if _, _ = noLimit.Write([]byte("ignored")); noLimit.String() != "" {
		t.Fatalf("limit<=0 should not retain data")
	}
}

func TestRunLogFunctions(t *testing.T) {
	defer resetTestHooks()
	tempDir := t.TempDir()
	t.Setenv("TMPDIR", tempDir)

	logger, err := NewLogger()
	if err != nil {
		t.Fatalf("NewLogger() error = %v", err)
	}
	setLogger(logger)
	defer closeLogger()

	logInfo("info message")
	logWarn("warn message")
	logError("error message")
	logger.Flush()

	data, err := os.ReadFile(logger.Path())
	if err != nil {
		t.Fatalf("failed to read log file: %v", err)
	}

	output := string(data)
	if !strings.Contains(output, "info message") {
		t.Errorf("logInfo output missing, got: %s", output)
	}
	if !strings.Contains(output, "warn message") {
		t.Errorf("logWarn output missing, got: %s", output)
	}
	if !strings.Contains(output, "error message") {
		t.Errorf("logError output missing, got: %s", output)
	}
}

func TestLoggerPathAndRemoveNil(t *testing.T) {
	var logger *Logger
	if logger.Path() != "" {
		t.Fatalf("nil logger path should be empty")
	}
	if err := logger.RemoveLogFile(); err != nil {
		t.Fatalf("expected nil logger RemoveLogFile to be no-op, got %v", err)
	}
}

func TestLoggerLogDropOnDone(t *testing.T) {
	logger := &Logger{
		ch:   make(chan logEntry),
		done: make(chan struct{}),
	}
	close(logger.done)
	logger.log("INFO", "dropped")
	logger.pendingWG.Wait()
}

func TestLoggerLogAfterClose(t *testing.T) {
	defer resetTestHooks()
	logger, err := NewLogger()
	if err != nil {
		t.Fatalf("NewLogger error: %v", err)
	}
	if err := logger.Close(); err != nil {
		t.Fatalf("Close error: %v", err)
	}
	logger.log("INFO", "should be ignored")
}

func TestLogWriterLogLine(t *testing.T) {
	defer resetTestHooks()
	logger, err := NewLogger()
	if err != nil {
		t.Fatalf("NewLogger error: %v", err)
	}
	setLogger(logger)
	lw := &logWriter{prefix: "P:", maxLen: 3}
	lw.buf.WriteString("abcdef")
	lw.logLine(false)
	lw.logLine(false) // empty buffer path
	logger.Flush()
	data, _ := os.ReadFile(logger.Path())
	if !strings.Contains(string(data), "P:abc") {
		t.Fatalf("log output missing truncated entry, got %q", string(data))
	}
	closeLogger()
}

func TestNewLogWriterDefaultMaxLen(t *testing.T) {
	lw := newLogWriter("X:", 0)
	if lw.maxLen != codexLogLineLimit {
		t.Fatalf("expected default maxLen %d, got %d", codexLogLineLimit, lw.maxLen)
	}
}

func TestBackendPrintHelp(t *testing.T) {
	oldStdout := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w
	printHelp()
	w.Close()
	os.Stdout = oldStdout

	var buf bytes.Buffer
	io.Copy(&buf, r)
	output := buf.String()

	expected := []string{"codeagent-wrapper", "Usage:", "resume", "CODEX_TIMEOUT", "Exit Codes:"}
	for _, phrase := range expected {
		if !strings.Contains(output, phrase) {
			t.Errorf("printHelp() missing phrase %q", phrase)
		}
	}
}

func TestRunIsTerminal(t *testing.T) {
	defer resetTestHooks()
	tests := []struct {
		name   string
		mockFn func() bool
		want   bool
	}{{"is terminal", func() bool { return true }, true}, {"is not terminal", func() bool { return false }, false}}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isTerminalFn = tt.mockFn
			got := isTerminal()
			if got != tt.want {
				t.Errorf("isTerminal() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestRunReadPipedTask(t *testing.T) {
	defer resetTestHooks()
	tests := []struct {
		name       string
		isTerminal bool
		stdin      io.Reader
		want       string
		wantErr    bool
	}{
		{"terminal mode", true, strings.NewReader("ignored"), "", false},
		{"piped with data", false, strings.NewReader("task from pipe"), "task from pipe", false},
		{"piped empty", false, strings.NewReader(""), "", false},
		{"piped read error", false, errReader{errors.New("boom")}, "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			isTerminalFn = func() bool { return tt.isTerminal }
			stdinReader = tt.stdin
			got, err := readPipedTask()
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Errorf("readPipedTask() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestRunCodexTask_CommandNotFound(t *testing.T) {
	defer resetTestHooks()
	codexCommand = "nonexistent-command-xyz"
	buildCodexArgsFn = func(cfg *Config, targetArg string) []string { return []string{targetArg} }
	res := runCodexTask(TaskSpec{Task: "task"}, false, 10)
	if res.ExitCode != 127 {
		t.Errorf("exitCode = %d, want 127", res.ExitCode)
	}
	if res.Error == "" {
		t.Errorf("expected error message")
	}
}

func TestRunCodexTask_StartError(t *testing.T) {
	defer resetTestHooks()
	tmpFile, err := os.CreateTemp("", "start-error")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())

	codexCommand = tmpFile.Name()
	buildCodexArgsFn = func(cfg *Config, targetArg string) []string { return []string{} }

	res := runCodexTask(TaskSpec{Task: "task"}, false, 1)
	if res.ExitCode != 1 || !strings.Contains(res.Error, "failed to start") {
		t.Fatalf("unexpected result: %+v", res)
	}
}

func TestRunCodexTask_WithEcho(t *testing.T) {
	defer resetTestHooks()
	codexCommand = "echo"
	buildCodexArgsFn = func(cfg *Config, targetArg string) []string { return []string{targetArg} }

	jsonOutput := `{"type":"thread.started","thread_id":"test-session"}
{"type":"item.completed","item":{"type":"agent_message","text":"Test output"}}`

	res := runCodexTask(TaskSpec{Task: jsonOutput}, false, 10)
	if res.ExitCode != 0 || res.Message != "Test output" || res.SessionID != "test-session" {
		t.Fatalf("unexpected result: %+v", res)
	}
}

func TestRunCodexTaskFn_UsesTaskBackend(t *testing.T) {
	defer resetTestHooks()

	fake := newFakeCmd(fakeCmdConfig{
		StdoutPlan: []fakeStdoutEvent{
			{Data: `{"type":"thread.started","thread_id":"backend-thread"}` + "\n"},
			{Data: `{"type":"item.completed","item":{"type":"agent_message","text":"backend-msg"}}` + "\n"},
		},
	})

	var seenName string
	var seenArgs []string
	newCommandRunner = func(ctx context.Context, name string, args ...string) commandRunner {
		seenName = name
		seenArgs = append([]string(nil), args...)
		return fake
	}
	selectBackendFn = func(name string) (Backend, error) {
		return testBackend{
			name:    strings.ToLower(name),
			command: "custom-cli",
			argsFn: func(cfg *Config, targetArg string) []string {
				return []string{"do", targetArg}
			},
		}, nil
	}

	res := runCodexTaskFn(TaskSpec{ID: "task-1", Task: "payload", Backend: "Custom"}, 5)

	if res.ExitCode != 0 || res.Message != "backend-msg" || res.SessionID != "backend-thread" {
		t.Fatalf("unexpected result: %+v", res)
	}
	if seenName != "custom-cli" {
		t.Fatalf("command name = %q, want custom-cli", seenName)
	}
	expectedArgs := []string{"do", "payload"}
	if len(seenArgs) != len(expectedArgs) {
		t.Fatalf("args len = %d, want %d", len(seenArgs), len(expectedArgs))
	}
	for i, want := range expectedArgs {
		if seenArgs[i] != want {
			t.Fatalf("args[%d]=%q, want %q", i, seenArgs[i], want)
		}
	}
}

func TestRunCodexTaskFn_InvalidBackend(t *testing.T) {
	defer resetTestHooks()

	selectBackendFn = func(name string) (Backend, error) {
		return nil, fmt.Errorf("invalid backend: %s", name)
	}

	res := runCodexTaskFn(TaskSpec{ID: "bad-task", Task: "noop", Backend: "unknown"}, 5)
	if res.ExitCode == 0 {
		t.Fatalf("expected failure for invalid backend")
	}
	if res.TaskID != "bad-task" {
		t.Fatalf("TaskID = %q, want bad-task", res.TaskID)
	}
	if !strings.Contains(res.Error, "invalid backend") {
		t.Fatalf("error %q missing backend message", res.Error)
	}
}

func TestRunCodexTask_LogPathWithActiveLogger(t *testing.T) {
	defer resetTestHooks()

	logger, err := NewLoggerWithSuffix("active-logpath")
	if err != nil {
		t.Fatalf("failed to create logger: %v", err)
	}
	setLogger(logger)

	codexCommand = "echo"
	buildCodexArgsFn = func(cfg *Config, targetArg string) []string { return []string{targetArg} }

	jsonOutput := `{"type":"thread.started","thread_id":"fake-thread"}
{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}`

	result := runCodexTask(TaskSpec{Task: jsonOutput}, false, 5)
	if result.LogPath != logger.Path() {
		t.Fatalf("LogPath = %q, want %q", result.LogPath, logger.Path())
	}
	if result.ExitCode != 0 {
		t.Fatalf("exit = %d, want 0 (%s)", result.ExitCode, result.Error)
	}
}

func TestRunCodexTask_LogPathWithTempLogger(t *testing.T) {
	defer resetTestHooks()

	codexCommand = "echo"
	buildCodexArgsFn = func(cfg *Config, targetArg string) []string { return []string{targetArg} }

	jsonOutput := `{"type":"thread.started","thread_id":"temp-thread"}
{"type":"item.completed","item":{"type":"agent_message","text":"temp"}}`

	result := runCodexTask(TaskSpec{Task: jsonOutput}, true, 5)
	t.Cleanup(func() {
		if result.LogPath != "" {
			os.Remove(result.LogPath)
		}
	})
	if result.LogPath == "" {
		t.Fatalf("LogPath should not be empty for temp logger")
	}
	if _, err := os.Stat(result.LogPath); err != nil {
		t.Fatalf("log file %q should exist (err=%v)", result.LogPath, err)
	}
	if activeLogger() != nil {
		t.Fatalf("active logger should be cleared after silent run")
	}
}

func TestRunCodexTask_LogPathOnStartError(t *testing.T) {
	defer resetTestHooks()

	logger, err := NewLoggerWithSuffix("start-error")
	if err != nil {
		t.Fatalf("failed to create logger: %v", err)
	}
	setLogger(logger)

	tmpFile, err := os.CreateTemp("", "start-error")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())

	codexCommand = tmpFile.Name()
	buildCodexArgsFn = func(cfg *Config, targetArg string) []string { return []string{} }

	result := runCodexTask(TaskSpec{Task: "ignored"}, false, 5)
	if result.ExitCode == 0 {
		t.Fatalf("expected non-zero exit")
	}
	if result.LogPath != logger.Path() {
		t.Fatalf("LogPath = %q, want %q", result.LogPath, logger.Path())
	}
}

func TestRunCodexTask_NoMessage(t *testing.T) {
	defer resetTestHooks()
	codexCommand = "echo"
	buildCodexArgsFn = func(cfg *Config, targetArg string) []string { return []string{targetArg} }
	jsonOutput := `{"type":"thread.started","thread_id":"test-session"}`
	res := runCodexTask(TaskSpec{Task: jsonOutput}, false, 10)
	if res.ExitCode != 1 || res.Error == "" {
		t.Fatalf("expected error for missing agent_message, got %+v", res)
	}
}

func TestRunCodexTask_WithStdin(t *testing.T) {
	defer resetTestHooks()
	codexCommand = "cat"
	buildCodexArgsFn = func(cfg *Config, targetArg string) []string { return []string{} }
	jsonInput := `{"type":"item.completed","item":{"type":"agent_message","text":"from stdin"}}`
	res := runCodexTask(TaskSpec{Task: jsonInput, UseStdin: true}, false, 10)
	if res.ExitCode != 0 || res.Message != "from stdin" {
		t.Fatalf("unexpected result: %+v", res)
	}
}

func TestRunCodexProcess_WithStdin(t *testing.T) {
	defer resetTestHooks()
	codexCommand = "cat"
	jsonOutput := `{"type":"thread.started","thread_id":"proc"}`
	jsonOutput += "\n"
	jsonOutput += `{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}`

	msg, tid, exit := runCodexProcess(context.Background(), []string{}, jsonOutput, true, 5)
	if exit != 0 {
		t.Fatalf("exit code %d, want 0", exit)
	}
	if msg != "ok" || tid != "proc" {
		t.Fatalf("unexpected output msg=%q tid=%q", msg, tid)
	}
}

func TestRunCodexTask_ExitError(t *testing.T) {
	defer resetTestHooks()
	codexCommand = "false"
	buildCodexArgsFn = func(cfg *Config, targetArg string) []string { return []string{} }
	res := runCodexTask(TaskSpec{Task: "noop"}, false, 10)
	if res.ExitCode == 0 || res.Error == "" {
		t.Fatalf("expected failure, got %+v", res)
	}
}

func TestRunCodexTask_StdinPipeError(t *testing.T) {
	defer resetTestHooks()
	commandContext = func(ctx context.Context, name string, args ...string) *exec.Cmd {
		cmd := exec.CommandContext(ctx, "cat")
		cmd.Stdin = os.Stdin
		return cmd
	}
	buildCodexArgsFn = func(cfg *Config, targetArg string) []string { return []string{} }
	res := runCodexTask(TaskSpec{Task: "data", UseStdin: true}, false, 1)
	if res.ExitCode != 1 || !strings.Contains(res.Error, "stdin pipe") {
		t.Fatalf("expected stdin pipe error, got %+v", res)
	}
}

func TestRunCodexTask_StdoutPipeError(t *testing.T) {
	defer resetTestHooks()
	commandContext = func(ctx context.Context, name string, args ...string) *exec.Cmd {
		cmd := exec.CommandContext(ctx, "echo", "noop")
		cmd.Stdout = os.Stdout
		return cmd
	}
	buildCodexArgsFn = func(cfg *Config, targetArg string) []string { return []string{} }
	res := runCodexTask(TaskSpec{Task: "noop"}, false, 1)
	if res.ExitCode != 1 || !strings.Contains(res.Error, "stdout pipe") {
		t.Fatalf("expected stdout pipe error, got %+v", res)
	}
}

func TestRunCodexTask_Timeout(t *testing.T) {
	defer resetTestHooks()
	codexCommand = "sleep"
	buildCodexArgsFn = func(cfg *Config, targetArg string) []string { return []string{"2"} }
	res := runCodexTask(TaskSpec{Task: "ignored"}, false, 1)
	if res.ExitCode != 124 || !strings.Contains(res.Error, "timeout") {
		t.Fatalf("expected timeout, got %+v", res)
	}
}

func TestRunCodexTask_SignalHandling(t *testing.T) {
	defer resetTestHooks()
	codexCommand = "sleep"
	buildCodexArgsFn = func(cfg *Config, targetArg string) []string { return []string{"5"} }

	resultCh := make(chan TaskResult, 1)
	go func() { resultCh <- runCodexTask(TaskSpec{Task: "ignored"}, false, 5) }()

	time.Sleep(200 * time.Millisecond)
	syscall.Kill(os.Getpid(), syscall.SIGTERM)

	res := <-resultCh
	signal.Reset(syscall.SIGINT, syscall.SIGTERM)

	if res.ExitCode == 0 || res.Error == "" {
		t.Fatalf("expected non-zero exit after signal, got %+v", res)
	}
}

func TestForwardSignals_ContextCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	forwardSignals(ctx, &realCmd{cmd: &exec.Cmd{}}, func(string) {})
	cancel()
	time.Sleep(10 * time.Millisecond)
}

func TestCancelReason(t *testing.T) {
	const cmdName = "codex"

	if got := cancelReason(cmdName, nil); got != "Context cancelled" {
		t.Fatalf("cancelReason(nil) = %q, want %q", got, "Context cancelled")
	}

	ctxTimeout, cancelTimeout := context.WithTimeout(context.Background(), 1*time.Nanosecond)
	defer cancelTimeout()
	<-ctxTimeout.Done()
	wantTimeout := fmt.Sprintf("%s execution timeout", cmdName)
	if got := cancelReason(cmdName, ctxTimeout); got != wantTimeout {
		t.Fatalf("cancelReason(deadline) = %q, want %q", got, wantTimeout)
	}

	ctxCancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if got := cancelReason(cmdName, ctxCancelled); got != "Execution cancelled, terminating codex process" {
		t.Fatalf("cancelReason(cancelled) = %q, want %q", got, "Execution cancelled, terminating codex process")
	}
}

func TestRunCodexProcess(t *testing.T) {
	defer resetTestHooks()
	script := createFakeCodexScript(t, "proc-thread", "proc-msg")
	codexCommand = script

	msg, threadID, exitCode := runCodexProcess(context.Background(), nil, "ignored", false, 5)
	if exitCode != 0 {
		t.Fatalf("exit = %d, want 0", exitCode)
	}
	if msg != "proc-msg" {
		t.Fatalf("message = %q, want proc-msg", msg)
	}
	if threadID != "proc-thread" {
		t.Fatalf("threadID = %q, want proc-thread", threadID)
	}
}

func TestRunSilentMode(t *testing.T) {
	defer resetTestHooks()
	jsonOutput := `{"type":"thread.started","thread_id":"silent-session"}
{"type":"item.completed","item":{"type":"agent_message","text":"quiet"}}`
	codexCommand = "echo"
	buildCodexArgsFn = func(cfg *Config, targetArg string) []string { return []string{targetArg} }

	capture := func(silent bool) string {
		oldStderr := os.Stderr
		r, w, _ := os.Pipe()
		os.Stderr = w
		res := runCodexTask(TaskSpec{Task: jsonOutput}, silent, 10)
		if res.ExitCode != 0 {
			t.Fatalf("unexpected exitCode %d", res.ExitCode)
		}
		w.Close()
		os.Stderr = oldStderr
		var buf bytes.Buffer
		io.Copy(&buf, r)
		return buf.String()
	}

	verbose := capture(false)
	quiet := capture(true)

	// Silent mode (parallel tasks): no stderr output at all
	if quiet != "" {
		t.Fatalf("silent mode should suppress stderr, got: %q", quiet)
	}
	// Non-silent mode (single task): Session-ID is emitted to stderr
	// so Claude Code can capture it even if the task later fails/times out
	if !strings.Contains(verbose, "Session-ID: silent-session") {
		t.Fatalf("non-silent mode should emit Session-ID to stderr, got: %q", verbose)
	}
}

func TestRunGenerateFinalOutput(t *testing.T) {
	results := []TaskResult{{TaskID: "a", ExitCode: 0, Message: "ok"}, {TaskID: "b", ExitCode: 1, Error: "boom"}, {TaskID: "c", ExitCode: 0}}
	out := generateFinalOutput(results)
	if out == "" {
		t.Fatalf("generateFinalOutput() returned empty string")
	}
	// New format: "X tasks | Y passed | Z failed"
	if !strings.Contains(out, "3 tasks") || !strings.Contains(out, "2 passed") || !strings.Contains(out, "1 failed") {
		t.Fatalf("summary missing, got %q", out)
	}
	// New format uses ### task-id for each task
	if !strings.Contains(out, "### a") || !strings.Contains(out, "### b") {
		t.Fatalf("task entries missing in structured format")
	}
	// Should have Summary section
	if !strings.Contains(out, "## Summary") {
		t.Fatalf("Summary section missing, got %q", out)
	}
}

func TestRunGenerateFinalOutput_LogPath(t *testing.T) {
	results := []TaskResult{
		{
			TaskID:    "a",
			ExitCode:  0,
			Message:   "ok",
			SessionID: "sid",
			LogPath:   "/tmp/log-a",
		},
		{
			TaskID:   "b",
			ExitCode: 7,
			Error:    "bad",
			LogPath:  "/tmp/log-b",
		},
	}
	// Test summary mode (default) - should contain log paths
	out := generateFinalOutput(results)
	if !strings.Contains(out, "/tmp/log-b") {
		t.Fatalf("summary output missing log path for failed task: %q", out)
	}
	// Test full output mode - shows Session: and Log: lines
	out = generateFinalOutputWithMode(results, false)
	if !strings.Contains(out, "Session: sid") || !strings.Contains(out, "Log: /tmp/log-a") {
		t.Fatalf("full output missing log line after session: %q", out)
	}
	if !strings.Contains(out, "Log: /tmp/log-b") {
		t.Fatalf("full output missing log line for failed task: %q", out)
	}
}

func TestRunTopologicalSort_LinearChain(t *testing.T) {
	tasks := []TaskSpec{{ID: "a"}, {ID: "b", Dependencies: []string{"a"}}, {ID: "c", Dependencies: []string{"b"}}}
	layers, err := topologicalSort(tasks)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(layers) != 3 {
		t.Fatalf("expected 3 layers, got %d", len(layers))
	}
}

func TestRunTopologicalSort_Branching(t *testing.T) {
	tasks := []TaskSpec{{ID: "root"}, {ID: "left", Dependencies: []string{"root"}}, {ID: "right", Dependencies: []string{"root"}}, {ID: "leaf", Dependencies: []string{"left", "right"}}}
	layers, err := topologicalSort(tasks)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(layers) != 3 || len(layers[1]) != 2 {
		t.Fatalf("unexpected layers: %+v", layers)
	}
}

func TestParallelTopologicalSortTasks(t *testing.T) {
	tasks := []TaskSpec{{ID: "a"}, {ID: "b"}, {ID: "c"}}
	layers, err := topologicalSort(tasks)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(layers) != 1 || len(layers[0]) != 3 {
		t.Fatalf("unexpected result: %+v", layers)
	}
}

func TestRunShouldSkipTask(t *testing.T) {
	failed := map[string]TaskResult{"a": {TaskID: "a", ExitCode: 1}, "b": {TaskID: "b", ExitCode: 2}}
	tests := []struct {
		name           string
		task           TaskSpec
		skip           bool
		reasonContains []string
	}{
		{"no deps", TaskSpec{ID: "c"}, false, nil},
		{"missing deps not failed", TaskSpec{ID: "d", Dependencies: []string{"x"}}, false, nil},
		{"single failed dep", TaskSpec{ID: "e", Dependencies: []string{"a"}}, true, []string{"a"}},
		{"multiple failed deps", TaskSpec{ID: "f", Dependencies: []string{"a", "b"}}, true, []string{"a", "b"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			skip, reason := shouldSkipTask(tt.task, failed)
			if skip != tt.skip {
				t.Fatalf("skip=%v, want %v", skip, tt.skip)
			}
			for _, expect := range tt.reasonContains {
				if !strings.Contains(reason, expect) {
					t.Fatalf("reason %q missing %q", reason, expect)
				}
			}
		})
	}
}

func TestRunTopologicalSort_CycleDetection(t *testing.T) {
	tasks := []TaskSpec{{ID: "a", Dependencies: []string{"b"}}, {ID: "b", Dependencies: []string{"a"}}}
	if _, err := topologicalSort(tasks); err == nil || !strings.Contains(err.Error(), "cycle detected") {
		t.Fatalf("expected cycle error, got %v", err)
	}
}

func TestRunTopologicalSort_IndirectCycle(t *testing.T) {
	tasks := []TaskSpec{{ID: "a", Dependencies: []string{"c"}}, {ID: "b", Dependencies: []string{"a"}}, {ID: "c", Dependencies: []string{"b"}}}
	if _, err := topologicalSort(tasks); err == nil || !strings.Contains(err.Error(), "cycle detected") {
		t.Fatalf("expected cycle error, got %v", err)
	}
}

func TestRunTopologicalSort_MissingDependency(t *testing.T) {
	tasks := []TaskSpec{{ID: "a", Dependencies: []string{"missing"}}}
	if _, err := topologicalSort(tasks); err == nil || !strings.Contains(err.Error(), "dependency \"missing\" not found") {
		t.Fatalf("expected missing dependency error, got %v", err)
	}
}

func TestRunTopologicalSort_LargeGraph(t *testing.T) {
	const count = 200
	tasks := make([]TaskSpec, count)
	for i := 0; i < count; i++ {
		id := fmt.Sprintf("task-%d", i)
		if i == 0 {
			tasks[i] = TaskSpec{ID: id}
			continue
		}
		prev := fmt.Sprintf("task-%d", i-1)
		tasks[i] = TaskSpec{ID: id, Dependencies: []string{prev}}
	}

	layers, err := topologicalSort(tasks)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(layers) != count {
		t.Fatalf("expected %d layers, got %d", count, len(layers))
	}
}

func TestParallelExecuteConcurrent(t *testing.T) {
	orig := runCodexTaskFn
	defer func() { runCodexTaskFn = orig }()

	var maxParallel int64
	var current int64

	runCodexTaskFn = func(task TaskSpec, timeout int) TaskResult {
		cur := atomic.AddInt64(&current, 1)
		for {
			prev := atomic.LoadInt64(&maxParallel)
			if cur <= prev || atomic.CompareAndSwapInt64(&maxParallel, prev, cur) {
				break
			}
		}
		time.Sleep(150 * time.Millisecond)
		atomic.AddInt64(&current, -1)
		return TaskResult{TaskID: task.ID}
	}

	start := time.Now()
	layers := [][]TaskSpec{{{ID: "a"}, {ID: "b"}, {ID: "c"}}}
	results := executeConcurrent(layers, 10)
	elapsed := time.Since(start)

	if len(results) != 3 {
		t.Fatalf("expected 3 results, got %d", len(results))
	}
	if elapsed >= 400*time.Millisecond {
		t.Fatalf("expected concurrent execution, took %v", elapsed)
	}
	if maxParallel < 2 {
		t.Fatalf("expected parallelism >=2, got %d", maxParallel)
	}
}

func TestRunExecuteConcurrent_LayerOrdering(t *testing.T) {
	orig := runCodexTaskFn
	defer func() { runCodexTaskFn = orig }()

	var mu sync.Mutex
	var order []string

	runCodexTaskFn = func(task TaskSpec, timeout int) TaskResult {
		mu.Lock()
		order = append(order, task.ID)
		mu.Unlock()
		return TaskResult{TaskID: task.ID}
	}

	layers := [][]TaskSpec{{{ID: "first-1"}, {ID: "first-2"}}, {{ID: "second"}}}
	executeConcurrent(layers, 10)

	if len(order) != 3 || order[2] != "second" {
		t.Fatalf("unexpected order: %+v", order)
	}
}

func TestRunExecuteConcurrent_ErrorIsolation(t *testing.T) {
	orig := runCodexTaskFn
	defer func() { runCodexTaskFn = orig }()

	runCodexTaskFn = func(task TaskSpec, timeout int) TaskResult {
		if task.ID == "fail" {
			return TaskResult{TaskID: task.ID, ExitCode: 2, Error: "boom"}
		}
		return TaskResult{TaskID: task.ID, ExitCode: 0}
	}

	layers := [][]TaskSpec{{{ID: "ok"}, {ID: "fail"}}, {{ID: "after"}}}
	results := executeConcurrent(layers, 10)

	if len(results) != 3 {
		t.Fatalf("expected 3 results, got %d", len(results))
	}

	var failed, succeeded bool
	for _, res := range results {
		if res.TaskID == "fail" && res.ExitCode == 2 {
			failed = true
		}
		if res.TaskID == "after" && res.ExitCode == 0 {
			succeeded = true
		}
	}

	if !failed || !succeeded {
		t.Fatalf("expected failure isolation, got %+v", results)
	}
}

func TestRunExecuteConcurrent_PanicRecovered(t *testing.T) {
	orig := runCodexTaskFn
	defer func() { runCodexTaskFn = orig }()

	runCodexTaskFn = func(task TaskSpec, timeout int) TaskResult {
		panic("boom")
	}

	results := executeConcurrent([][]TaskSpec{{{ID: "panic"}}}, 10)
	if len(results) != 1 || results[0].Error == "" || results[0].ExitCode == 0 {
		t.Fatalf("panic should be captured, got %+v", results[0])
	}
}

func TestRunExecuteConcurrent_LargeFanout(t *testing.T) {
	orig := runCodexTaskFn
	defer func() { runCodexTaskFn = orig }()

	runCodexTaskFn = func(task TaskSpec, timeout int) TaskResult { return TaskResult{TaskID: task.ID} }
	layer := make([]TaskSpec, 0, 1200)
	for i := 0; i < 1200; i++ {
		layer = append(layer, TaskSpec{ID: fmt.Sprintf("id-%d", i)})
	}
	results := executeConcurrent([][]TaskSpec{layer}, 10)
	if len(results) != 1200 {
		t.Fatalf("expected 1200 results, got %d", len(results))
	}
}

func TestParallelBackendPropagation(t *testing.T) {
	defer resetTestHooks()
	cleanupLogsFn = func() (CleanupStats, error) { return CleanupStats{}, nil }

	orig := runCodexTaskFn
	var mu sync.Mutex
	seen := make(map[string]string)
	runCodexTaskFn = func(task TaskSpec, timeout int) TaskResult {
		mu.Lock()
		seen[task.ID] = task.Backend
		mu.Unlock()
		return TaskResult{TaskID: task.ID, ExitCode: 0, Message: "ok"}
	}
	t.Cleanup(func() { runCodexTaskFn = orig })

	stdinReader = strings.NewReader(`---TASK---
id: first
---CONTENT---
do one

---TASK---
id: second
backend: gemini
---CONTENT---
do two`)
	os.Args = []string{"codeagent-wrapper", "--backend", "claude", "--parallel"}

	if code := run(); code != 0 {
		t.Fatalf("run exit = %d, want 0", code)
	}

	mu.Lock()
	firstBackend, firstOK := seen["first"]
	secondBackend, secondOK := seen["second"]
	mu.Unlock()

	if !firstOK || firstBackend != "claude" {
		t.Fatalf("first backend = %q (present=%v), want claude", firstBackend, firstOK)
	}
	if !secondOK || secondBackend != "gemini" {
		t.Fatalf("second backend = %q (present=%v), want gemini", secondBackend, secondOK)
	}
}

func TestParallelFlag(t *testing.T) {
	oldArgs := os.Args
	defer func() { os.Args = oldArgs }()

	os.Args = []string{"codeagent-wrapper", "--parallel"}
	jsonInput := `---TASK---
id: T1
---CONTENT---
test`
	stdinReader = strings.NewReader(jsonInput)
	defer func() { stdinReader = os.Stdin }()

	runCodexTaskFn = func(task TaskSpec, timeout int) TaskResult {
		return TaskResult{TaskID: task.ID, ExitCode: 0, Message: "test output"}
	}
	defer func() {
		runCodexTaskFn = func(task TaskSpec, timeout int) TaskResult { return runCodexTask(task, true, timeout) }
	}()

	exitCode := run()
	if exitCode != 0 {
		t.Errorf("expected exit code 0, got %d", exitCode)
	}
}

func TestRunParallelWithFullOutput(t *testing.T) {
	defer resetTestHooks()
	cleanupLogsFn = func() (CleanupStats, error) { return CleanupStats{}, nil }

	oldArgs := os.Args
	t.Cleanup(func() { os.Args = oldArgs })
	os.Args = []string{"codeagent-wrapper", "--parallel", "--full-output"}

	stdinReader = strings.NewReader(`---TASK---
id: T1
---CONTENT---
noop`)
	t.Cleanup(func() { stdinReader = os.Stdin })

	orig := runCodexTaskFn
	runCodexTaskFn = func(task TaskSpec, timeout int) TaskResult {
		return TaskResult{TaskID: task.ID, ExitCode: 0, Message: "full output marker"}
	}
	t.Cleanup(func() { runCodexTaskFn = orig })

	out := captureOutput(t, func() {
		if code := run(); code != 0 {
			t.Fatalf("run exit = %d, want 0", code)
		}
	})

	if !strings.Contains(out, "=== Parallel Execution Summary ===") {
		t.Fatalf("output missing full-output header, got %q", out)
	}
	if !strings.Contains(out, "--- Task: T1 ---") {
		t.Fatalf("output missing task block, got %q", out)
	}
	if !strings.Contains(out, "full output marker") {
		t.Fatalf("output missing task message, got %q", out)
	}
	if strings.Contains(out, "=== Execution Report ===") {
		t.Fatalf("output should not include summary-only header, got %q", out)
	}
}

func TestParallelInvalidBackend(t *testing.T) {
	defer resetTestHooks()
	cleanupLogsFn = func() (CleanupStats, error) { return CleanupStats{}, nil }

	stdinReader = strings.NewReader(`---TASK---
id: only
---CONTENT---
noop`)
	os.Args = []string{"codeagent-wrapper", "--parallel", "--backend", "unknown"}

	if code := run(); code == 0 {
		t.Fatalf("expected non-zero exit for invalid backend in parallel mode")
	}
}

func TestParallelTriggersCleanup(t *testing.T) {
	defer resetTestHooks()
	oldArgs := os.Args
	defer func() { os.Args = oldArgs }()

	os.Args = []string{"codex-wrapper", "--parallel"}
	stdinReader = strings.NewReader(`---TASK---
id: only
---CONTENT---
noop`)

	cleanupCalls := 0
	cleanupLogsFn = func() (CleanupStats, error) {
		cleanupCalls++
		return CleanupStats{}, nil
	}

	orig := runCodexTaskFn
	runCodexTaskFn = func(task TaskSpec, timeout int) TaskResult {
		return TaskResult{TaskID: task.ID, ExitCode: 0, Message: "ok"}
	}
	defer func() { runCodexTaskFn = orig }()

	if exitCode := run(); exitCode != 0 {
		t.Fatalf("exit = %d, want 0", exitCode)
	}
	if cleanupCalls != 1 {
		t.Fatalf("cleanup called %d times, want 1", cleanupCalls)
	}
}

func TestVersionFlag(t *testing.T) {
	defer resetTestHooks()
	os.Args = []string{"codeagent-wrapper", "--version"}
	output := captureOutput(t, func() {
		if code := run(); code != 0 {
			t.Errorf("exit = %d, want 0", code)
		}
	})

	want := "codeagent-wrapper version 5.14.0\n"

	if output != want {
		t.Fatalf("output = %q, want %q", output, want)
	}
}

func TestVersionShortFlag(t *testing.T) {
	defer resetTestHooks()
	os.Args = []string{"codeagent-wrapper", "-v"}
	output := captureOutput(t, func() {
		if code := run(); code != 0 {
			t.Errorf("exit = %d, want 0", code)
		}
	})

	want := "codeagent-wrapper version 5.14.0\n"

	if output != want {
		t.Fatalf("output = %q, want %q", output, want)
	}
}

func TestVersionLegacyAlias(t *testing.T) {
	defer resetTestHooks()
	os.Args = []string{"codex-wrapper", "--version"}
	output := captureOutput(t, func() {
		if code := run(); code != 0 {
			t.Errorf("exit = %d, want 0", code)
		}
	})

	want := "codex-wrapper version 5.14.0\n"

	if output != want {
		t.Fatalf("output = %q, want %q", output, want)
	}
}

func TestRun_Help(t *testing.T) {
	defer resetTestHooks()
	os.Args = []string{"codeagent-wrapper", "--help"}
	if code := run(); code != 0 {
		t.Errorf("exit = %d, want 0", code)
	}
}

func TestRun_HelpShort(t *testing.T) {
	defer resetTestHooks()
	os.Args = []string{"codeagent-wrapper", "-h"}
	if code := run(); code != 0 {
		t.Errorf("exit = %d, want 0", code)
	}
}

func TestRun_HelpDoesNotTriggerCleanup(t *testing.T) {
	defer resetTestHooks()
	os.Args = []string{"codex-wrapper", "--help"}
	cleanupLogsFn = func() (CleanupStats, error) {
		t.Fatalf("cleanup should not run for --help")
		return CleanupStats{}, nil
	}

	if code := run(); code != 0 {
		t.Fatalf("exit = %d, want 0", code)
	}
}

func TestVersionDoesNotTriggerCleanup(t *testing.T) {
	defer resetTestHooks()
	os.Args = []string{"codex-wrapper", "--version"}
	cleanupLogsFn = func() (CleanupStats, error) {
		t.Fatalf("cleanup should not run for --version")
		return CleanupStats{}, nil
	}

	if code := run(); code != 0 {
		t.Fatalf("exit = %d, want 0", code)
	}
}

func TestVersionCoverageFullRun(t *testing.T) {
	t.Run("cleanupHelpers", func(t *testing.T) {
		defer resetTestHooks()
		cleanupLogsFn = nil
		runStartupCleanup()
		if code := runCleanupMode(); code == 0 {
			t.Fatalf("runCleanupMode exit = %d, want non-zero when cleanup is nil", code)
		}

		logger, err := NewLoggerWithSuffix("version-coverage")
		if err != nil {
			t.Fatalf("failed to create logger: %v", err)
		}
		setLogger(logger)

		cleanupLogsFn = func() (CleanupStats, error) {
			return CleanupStats{
				Scanned:      2,
				Deleted:      1,
				Kept:         1,
				DeletedFiles: []string{"old.log"},
				KeptFiles:    []string{"keep.log"},
				Errors:       1,
			}, fmt.Errorf("warn")
		}
		runStartupCleanup()

		cleanupLogsFn = func() (CleanupStats, error) {
			panic("panic cleanup")
		}
		runStartupCleanup()

		cleanupLogsFn = func() (CleanupStats, error) {
			return CleanupStats{
				Scanned:      2,
				Deleted:      1,
				Kept:         1,
				DeletedFiles: []string{"old.log"},
				KeptFiles:    []string{"keep.log"},
				Errors:       1,
			}, nil
		}
		if code := runCleanupMode(); code != 0 {
			t.Fatalf("runCleanupMode exit = %d, want 0", code)
		}

		cleanupLogsFn = func() (CleanupStats, error) {
			return CleanupStats{}, fmt.Errorf("expected failure")
		}
		if code := runCleanupMode(); code == 0 {
			t.Fatalf("runCleanupMode exit = %d, want non-zero on error", code)
		}

		printHelp()

		_ = closeLogger()
		_ = logger.RemoveLogFile()
		loggerPtr.Store(nil)
	})

	t.Run("parseArgsError", func(t *testing.T) {
		defer resetTestHooks()
		cleanupLogsFn = func() (CleanupStats, error) { return CleanupStats{}, nil }

		cleanupCalled := false
		cleanupHook = func() { cleanupCalled = true }

		selectBackendFn = func(name string) (Backend, error) {
			return testBackend{name: name, command: "echo"}, nil
		}
		runTaskFn = func(task TaskSpec, silent bool, timeout int) TaskResult {
			return TaskResult{ExitCode: 0}
		}

		os.Args = []string{"codeagent-wrapper"}
		if code := run(); code == 0 {
			t.Fatalf("run exit = %d, want non-zero for missing task", code)
		}
		if !cleanupCalled {
			t.Fatalf("cleanup hook not invoked on error path")
		}
	})

	t.Run("helpAndCleanup", func(t *testing.T) {
		defer resetTestHooks()
		cleanupLogsFn = func() (CleanupStats, error) { return CleanupStats{}, nil }

		os.Args = []string{"codeagent-wrapper", "--help"}
		if code := run(); code != 0 {
			t.Fatalf("run exit = %d, want 0 for help", code)
		}

		os.Args = []string{"codeagent-wrapper", "--cleanup"}
		if code := run(); code != 0 {
			t.Fatalf("run exit = %d, want 0 for cleanup", code)
		}
	})

	t.Run("happyPath", func(t *testing.T) {
		defer resetTestHooks()
		cleanupHook = func() {}
		cleanupLogsFn = func() (CleanupStats, error) { return CleanupStats{}, nil }

		selectBackendFn = func(name string) (Backend, error) {
			return testBackend{
				name:    name,
				command: "echo",
				argsFn: func(cfg *Config, targetArg string) []string {
					return []string{"--task", targetArg, "--workdir", cfg.WorkDir}
				},
			}, nil
		}
		runTaskFn = func(task TaskSpec, silent bool, timeout int) TaskResult {
			return TaskResult{TaskID: "task-id", ExitCode: 0, Message: "ok", SessionID: "sess-123"}
		}

		stdinReader = strings.NewReader("task line with $ and \\\nnext line with `tick` and \"quote\" and 'single'")
		isTerminalFn = func() bool { return false }
		os.Args = []string{"codeagent-wrapper", "-", "/tmp/workdir"}
		if code := run(); code != 0 {
			t.Fatalf("run exit = %d, want 0", code)
		}
	})

	t.Run("nonExplicitTaskFailure", func(t *testing.T) {
		defer resetTestHooks()
		cleanupCalled := false
		cleanupHook = func() { cleanupCalled = true }
		cleanupLogsFn = func() (CleanupStats, error) { return CleanupStats{}, nil }

		selectBackendFn = func(name string) (Backend, error) {
			return testBackend{
				name:    name,
				command: "echo",
				argsFn: func(cfg *Config, targetArg string) []string {
					return []string{"--task", targetArg}
				},
			}, nil
		}
		runTaskFn = func(task TaskSpec, silent bool, timeout int) TaskResult {
			return TaskResult{TaskID: "fail", ExitCode: 2, Message: "error"}
		}

		stdinReader = strings.NewReader("")
		isTerminalFn = func() bool { return true }
		os.Args = []string{"codeagent-wrapper", "raw-task"}
		if code := run(); code != 2 {
			t.Fatalf("run exit = %d, want 2", code)
		}
		if !cleanupCalled {
			t.Fatalf("cleanup hook not invoked on failure path")
		}
	})

	t.Run("pipedTaskLongInput", func(t *testing.T) {
		defer resetTestHooks()
		cleanupLogsFn = func() (CleanupStats, error) { return CleanupStats{}, nil }

		selectBackendFn = func(name string) (Backend, error) {
			return testBackend{
				name:    name,
				command: "echo",
				argsFn: func(cfg *Config, targetArg string) []string {
					return []string{"--task", targetArg}
				},
			}, nil
		}
		runTaskFn = func(task TaskSpec, silent bool, timeout int) TaskResult {
			return TaskResult{TaskID: "piped", ExitCode: 0, Message: "ok"}
		}

		stdinReader = strings.NewReader(strings.Repeat("x", 900))
		isTerminalFn = func() bool { return false }
		os.Args = []string{"codeagent-wrapper", "ignored"}
		if code := run(); code != 0 {
			t.Fatalf("run exit = %d, want 0 for piped input", code)
		}
	})

	t.Run("explicitStdinReadError", func(t *testing.T) {
		defer resetTestHooks()
		cleanupLogsFn = func() (CleanupStats, error) { return CleanupStats{}, nil }
		runTaskFn = func(task TaskSpec, silent bool, timeout int) TaskResult {
			return TaskResult{ExitCode: 0}
		}

		stdinReader = errReader{err: errors.New("read-fail")}
		os.Args = []string{"codeagent-wrapper", "-", "/tmp/workdir"}
		if code := run(); code == 0 {
			t.Fatalf("run exit = %d, want non-zero on stdin read error", code)
		}
	})

	t.Run("parallelFlow", func(t *testing.T) {
		defer resetTestHooks()
		cleanupHook = func() {}
		cleanupLogsFn = func() (CleanupStats, error) { return CleanupStats{}, nil }
		runCodexTaskFn = func(task TaskSpec, timeout int) TaskResult {
			return TaskResult{TaskID: task.ID, ExitCode: 0, Message: "ok"}
		}

		stdinReader = strings.NewReader(`---TASK---
id: first
---CONTENT---
do one

---TASK---
id: second
dependencies: first
---CONTENT---
do two`)
		os.Args = []string{"codeagent-wrapper", "--parallel"}
		if code := run(); code != 0 {
			t.Fatalf("run exit = %d, want 0", code)
		}
	})

	t.Run("parallelErrors", func(t *testing.T) {
		defer resetTestHooks()
		cleanupLogsFn = func() (CleanupStats, error) { return CleanupStats{}, nil }

		os.Args = []string{"codeagent-wrapper", "--parallel", "extra"}
		if code := run(); code == 0 {
			t.Fatalf("run exit = %d, want error for extra args", code)
		}

		stdinReader = strings.NewReader("invalid format")
		os.Args = []string{"codeagent-wrapper", "--parallel"}
		if code := run(); code == 0 {
			t.Fatalf("run exit = %d, want error for invalid config", code)
		}

		stdinReader = strings.NewReader(`---TASK---
id: second
dependencies: missing
---CONTENT---
task`)
		if code := run(); code == 0 {
			t.Fatalf("run exit = %d, want error for invalid DAG", code)
		}
	})
}

func TestVersionMainWrapper(t *testing.T) {
	defer resetTestHooks()
	exitCalled := -1
	exitFn = func(code int) { exitCalled = code }
	os.Args = []string{"codeagent-wrapper", "--version"}
	main()
	if exitCalled != 0 {
		t.Fatalf("main exit = %d, want 0", exitCalled)
	}
}

func TestBackendCleanupMode_Success(t *testing.T) {
	defer resetTestHooks()
	cleanupLogsFn = func() (CleanupStats, error) {
		return CleanupStats{
			Scanned:      5,
			Deleted:      3,
			Kept:         2,
			DeletedFiles: []string{"codex-wrapper-111.log", "codex-wrapper-222.log", "codex-wrapper-333.log"},
			KeptFiles:    []string{"codex-wrapper-444.log", "codex-wrapper-555.log"},
		}, nil
	}

	var exitCode int
	output := captureOutput(t, func() {
		exitCode = runCleanupMode()
	})
	if exitCode != 0 {
		t.Fatalf("exit = %d, want 0", exitCode)
	}
	want := "Cleanup completed\nFiles scanned: 5\nFiles deleted: 3\n  - codex-wrapper-111.log\n  - codex-wrapper-222.log\n  - codex-wrapper-333.log\nFiles kept: 2\n  - codex-wrapper-444.log\n  - codex-wrapper-555.log\n"
	if output != want {
		t.Fatalf("output = %q, want %q", output, want)
	}
}

func TestBackendCleanupMode_SuccessWithErrorsLine(t *testing.T) {
	defer resetTestHooks()
	cleanupLogsFn = func() (CleanupStats, error) {
		return CleanupStats{
			Scanned:      2,
			Deleted:      1,
			Kept:         0,
			Errors:       1,
			DeletedFiles: []string{"codex-wrapper-123.log"},
		}, nil
	}

	var exitCode int
	output := captureOutput(t, func() {
		exitCode = runCleanupMode()
	})
	if exitCode != 0 {
		t.Fatalf("exit = %d, want 0", exitCode)
	}
	want := "Cleanup completed\nFiles scanned: 2\nFiles deleted: 1\n  - codex-wrapper-123.log\nFiles kept: 0\nDeletion errors: 1\n"
	if output != want {
		t.Fatalf("output = %q, want %q", output, want)
	}
}

func TestBackendCleanupMode_ZeroStatsOutput(t *testing.T) {
	defer resetTestHooks()
	calls := 0
	cleanupLogsFn = func() (CleanupStats, error) {
		calls++
		return CleanupStats{}, nil
	}

	var exitCode int
	output := captureOutput(t, func() {
		exitCode = runCleanupMode()
	})
	if exitCode != 0 {
		t.Fatalf("exit = %d, want 0", exitCode)
	}
	want := "Cleanup completed\nFiles scanned: 0\nFiles deleted: 0\nFiles kept: 0\n"
	if output != want {
		t.Fatalf("output = %q, want %q", output, want)
	}
	if calls != 1 {
		t.Fatalf("cleanup called %d times, want 1", calls)
	}
}

func TestBackendCleanupMode_Error(t *testing.T) {
	defer resetTestHooks()
	cleanupLogsFn = func() (CleanupStats, error) {
		return CleanupStats{}, fmt.Errorf("boom")
	}

	var exitCode int
	errOutput := captureStderr(t, func() {
		exitCode = runCleanupMode()
	})
	if exitCode != 1 {
		t.Fatalf("exit = %d, want 1", exitCode)
	}
	if !strings.Contains(errOutput, "Cleanup failed") || !strings.Contains(errOutput, "boom") {
		t.Fatalf("stderr = %q, want error message", errOutput)
	}
}

func TestBackendCleanupMode_MissingFn(t *testing.T) {
	defer resetTestHooks()
	cleanupLogsFn = nil

	var exitCode int
	errOutput := captureStderr(t, func() {
		exitCode = runCleanupMode()
	})
	if exitCode != 1 {
		t.Fatalf("exit = %d, want 1", exitCode)
	}
	if !strings.Contains(errOutput, "log cleanup function not configured") {
		t.Fatalf("stderr = %q, want missing-fn message", errOutput)
	}
}

func TestRun_CleanupFlag(t *testing.T) {
	defer resetTestHooks()
	oldArgs := os.Args
	defer func() { os.Args = oldArgs }()

	os.Args = []string{"codex-wrapper", "--cleanup"}

	calls := 0
	cleanupLogsFn = func() (CleanupStats, error) {
		calls++
		return CleanupStats{Scanned: 1, Deleted: 1}, nil
	}

	var exitCode int
	output := captureOutput(t, func() {
		exitCode = run()
	})
	if exitCode != 0 {
		t.Fatalf("exit = %d, want 0", exitCode)
	}
	if calls != 1 {
		t.Fatalf("cleanup called %d times, want 1", calls)
	}
	want := "Cleanup completed\nFiles scanned: 1\nFiles deleted: 1\nFiles kept: 0\n"
	if output != want {
		t.Fatalf("output = %q, want %q", output, want)
	}
	if logger := activeLogger(); logger != nil {
		t.Fatalf("logger should not initialize for --cleanup mode")
	}
}

func TestRun_NoArgs(t *testing.T) {
	defer resetTestHooks()
	os.Args = []string{"codeagent-wrapper"}
	if code := run(); code != 1 {
		t.Errorf("exit = %d, want 1", code)
	}
}

func TestRun_ExplicitStdinEmpty(t *testing.T) {
	defer resetTestHooks()
	os.Args = []string{"codeagent-wrapper", "-"}
	stdinReader = strings.NewReader("")
	isTerminalFn = func() bool { return false }
	if code := run(); code != 1 {
		t.Errorf("exit = %d, want 1", code)
	}
}

func TestRun_ExplicitStdinReadError(t *testing.T) {
	defer resetTestHooks()
	tempDir := t.TempDir()
	t.Setenv("TMPDIR", tempDir)
	logPath := filepath.Join(tempDir, fmt.Sprintf("codeagent-wrapper-%d.log", os.Getpid()))

	var logOutput string
	cleanupHook = func() {
		data, err := os.ReadFile(logPath)
		if err == nil {
			logOutput = string(data)
		}
	}

	os.Args = []string{"codeagent-wrapper", "-"}
	stdinReader = errReader{errors.New("broken stdin")}
	isTerminalFn = func() bool { return false }

	exitCode := run()

	if exitCode != 1 {
		t.Fatalf("exit code %d, want 1", exitCode)
	}
	if !strings.Contains(logOutput, "Failed to read stdin: broken stdin") {
		t.Fatalf("log missing read error entry, got %q", logOutput)
	}
	// Log file is always removed after completion (new behavior)
	if _, err := os.Stat(logPath); !os.IsNotExist(err) {
		t.Fatalf("log file should be removed after completion")
	}
}

func TestRun_CommandFails(t *testing.T) {
	defer resetTestHooks()
	os.Args = []string{"codeagent-wrapper", "task"}
	stdinReader = strings.NewReader("")
	isTerminalFn = func() bool { return true }
	restore := withBackend("false", func(cfg *Config, targetArg string) []string { return []string{} })
	defer restore()
	if code := run(); code == 0 {
		t.Errorf("expected non-zero")
	}
}

func TestRun_InvalidBackend(t *testing.T) {
	defer resetTestHooks()
	os.Args = []string{"codeagent-wrapper", "--backend", "unknown", "task"}
	stdinReader = strings.NewReader("")
	isTerminalFn = func() bool { return true }
	if code := run(); code == 0 {
		t.Fatalf("expected non-zero exit for invalid backend")
	}
}

func TestRun_SuccessfulExecution(t *testing.T) {
	defer resetTestHooks()
	stdout := captureStdoutPipe()

	restore := withBackend(createFakeCodexScript(t, "tid-123", "ok"), buildCodexArgs)
	defer restore()
	stdinReader = strings.NewReader("")
	isTerminalFn = func() bool { return true }
	os.Args = []string{"codeagent-wrapper", "task"}

	exitCode := run()
	if exitCode != 0 {
		t.Fatalf("exit=%d, want 0", exitCode)
	}

	restoreStdoutPipe(stdout)
	output := stdout.String()
	if !strings.Contains(output, "ok") || !strings.Contains(output, "SESSION_ID: tid-123") {
		t.Fatalf("unexpected output: %q", output)
	}
}

func TestRun_ExplicitStdinSuccess(t *testing.T) {
	defer resetTestHooks()
	stdout := captureStdoutPipe()

	restore := withBackend(createFakeCodexScript(t, "tid-stdin", "from-stdin"), buildCodexArgs)
	defer restore()
	stdinReader = strings.NewReader("line1\nline2")
	isTerminalFn = func() bool { return false }
	os.Args = []string{"codeagent-wrapper", "-"}

	exitCode := run()
	restoreStdoutPipe(stdout)
	if exitCode != 0 {
		t.Fatalf("exit=%d, want 0", exitCode)
	}
	output := stdout.String()
	if !strings.Contains(output, "from-stdin") || !strings.Contains(output, "SESSION_ID: tid-stdin") {
		t.Fatalf("unexpected output: %q", output)
	}
}

func TestRun_PipedTaskReadError(t *testing.T) {
	defer resetTestHooks()
	tempDir := t.TempDir()
	t.Setenv("TMPDIR", tempDir)
	logPath := filepath.Join(tempDir, fmt.Sprintf("codeagent-wrapper-%d.log", os.Getpid()))

	var logOutput string
	cleanupHook = func() {
		data, err := os.ReadFile(logPath)
		if err == nil {
			logOutput = string(data)
		}
	}

	restore := withBackend(createFakeCodexScript(t, "tid-pipe", "piped-task"), buildCodexArgs)
	defer restore()
	isTerminalFn = func() bool { return false }
	stdinReader = errReader{errors.New("pipe failure")}
	os.Args = []string{"codeagent-wrapper", "cli-task"}

	exitCode := run()
	if exitCode != 1 {
		t.Fatalf("exit=%d, want 1", exitCode)
	}
	if !strings.Contains(logOutput, "Failed to read piped stdin: read stdin: pipe failure") {
		t.Fatalf("log missing piped read error, got %q", logOutput)
	}
	// Log file is always removed after completion (new behavior)
	if _, err := os.Stat(logPath); !os.IsNotExist(err) {
		t.Fatalf("log file should be removed after completion")
	}
}

func TestRun_PipedTaskSuccess(t *testing.T) {
	defer resetTestHooks()
	stdout := captureStdoutPipe()

	restore := withBackend(createFakeCodexScript(t, "tid-pipe", "piped-task"), buildCodexArgs)
	defer restore()
	isTerminalFn = func() bool { return false }
	stdinReader = strings.NewReader("piped task text")
	os.Args = []string{"codeagent-wrapper", "cli-task"}

	exitCode := run()
	restoreStdoutPipe(stdout)
	if exitCode != 0 {
		t.Fatalf("exit=%d, want 0", exitCode)
	}
	output := stdout.String()
	if !strings.Contains(output, "piped-task") || !strings.Contains(output, "SESSION_ID: tid-pipe") {
		t.Fatalf("unexpected output: %q", output)
	}
}

func TestRun_LoggerLifecycle(t *testing.T) {
	defer resetTestHooks()
	tempDir := t.TempDir()
	t.Setenv("TMPDIR", tempDir)
	logPath := filepath.Join(tempDir, fmt.Sprintf("codeagent-wrapper-%d.log", os.Getpid()))

	stdout := captureStdoutPipe()

	restore := withBackend(createFakeCodexScript(t, "tid-logger", "ok"), buildCodexArgs)
	defer restore()
	isTerminalFn = func() bool { return true }
	stdinReader = strings.NewReader("")
	os.Args = []string{"codeagent-wrapper", "task"}

	var fileExisted bool
	cleanupHook = func() {
		if _, err := os.Stat(logPath); err == nil {
			fileExisted = true
		}
	}

	exitCode := run()
	restoreStdoutPipe(stdout)

	if exitCode != 0 {
		t.Fatalf("exit=%d, want 0", exitCode)
	}
	if !fileExisted {
		t.Fatalf("log file was not present during run")
	}
	if _, err := os.Stat(logPath); !os.IsNotExist(err) {
		t.Fatalf("log file should be removed on success, but it exists")
	}
}

func TestRun_LoggerRemovedOnSignal(t *testing.T) {
	// Skip in CI due to unreliable signal delivery in containerized environments
	if os.Getenv("CI") != "" || os.Getenv("GITHUB_ACTIONS") != "" {
		t.Skip("Skipping signal test in CI environment")
	}

	defer resetTestHooks()
	defer signal.Reset(syscall.SIGINT, syscall.SIGTERM)

	// Set shorter delays for faster test
	forceKillDelay.Store(1)

	tempDir := t.TempDir()
	t.Setenv("TMPDIR", tempDir)
	logPath := filepath.Join(tempDir, fmt.Sprintf("codeagent-wrapper-%d.log", os.Getpid()))

	scriptPath := filepath.Join(tempDir, "sleepy-codex.sh")
	script := `#!/bin/sh
printf '%s\n' '{"type":"thread.started","thread_id":"sig-thread"}'
sleep 2
printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"late"}}'`
	if err := os.WriteFile(scriptPath, []byte(script), 0o755); err != nil {
		t.Fatalf("failed to write script: %v", err)
	}

	restore := withBackend(scriptPath, buildCodexArgs)
	defer restore()
	isTerminalFn = func() bool { return true }
	stdinReader = strings.NewReader("")
	os.Args = []string{"codeagent-wrapper", "task"}

	exitCh := make(chan int, 1)
	go func() { exitCh <- run() }()

	deadline := time.Now().Add(1 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(logPath); err == nil {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	_ = syscall.Kill(os.Getpid(), syscall.SIGINT)

	var exitCode int
	select {
	case exitCode = <-exitCh:
	case <-time.After(5 * time.Second):
		t.Fatalf("run() did not return after signal")
	}

	if exitCode != 130 {
		t.Fatalf("exit code = %d, want 130", exitCode)
	}
	// Log file is always removed after completion (new behavior)
	if _, err := os.Stat(logPath); !os.IsNotExist(err) {
		t.Fatalf("log file should be removed after completion")
	}
}

func TestRun_CleanupHookAlwaysCalled(t *testing.T) {
	defer resetTestHooks()
	called := false
	cleanupHook = func() { called = true }
	// Use a command that goes through normal flow, not --version which returns early
	restore := withBackend("echo", func(cfg *Config, targetArg string) []string {
		return []string{`{"type":"thread.started","thread_id":"x"}
{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}`}
	})
	defer restore()
	os.Args = []string{"codeagent-wrapper", "task"}
	if exitCode := run(); exitCode != 0 {
		t.Fatalf("exit = %d, want 0", exitCode)
	}
	if !called {
		t.Fatalf("cleanup hook not invoked")
	}
}

func TestBackendStartupCleanupNil(t *testing.T) {
	defer resetTestHooks()
	cleanupLogsFn = nil
	runStartupCleanup()
}

func TestBackendStartupCleanupErrorLogged(t *testing.T) {
	defer resetTestHooks()

	logger, err := NewLoggerWithSuffix("startup-error")
	if err != nil {
		t.Fatalf("failed to create logger: %v", err)
	}
	setLogger(logger)
	t.Cleanup(func() {
		logger.Flush()
		logger.Close()
		os.Remove(logger.Path())
	})

	cleanupLogsFn = func() (CleanupStats, error) {
		return CleanupStats{}, errors.New("zapped")
	}

	runStartupCleanup()
}

func TestRun_CleanupFailureDoesNotBlock(t *testing.T) {
	defer resetTestHooks()
	stdout := captureStdoutPipe()
	defer restoreStdoutPipe(stdout)

	cleanupCalled := 0
	cleanupLogsFn = func() (CleanupStats, error) {
		cleanupCalled++
		panic("boom")
	}

	codexCommand = createFakeCodexScript(t, "tid-cleanup", "ok")
	stdinReader = strings.NewReader("")
	isTerminalFn = func() bool { return true }
	os.Args = []string{"codex-wrapper", "task"}

	if exit := run(); exit != 0 {
		t.Fatalf("exit = %d, want 0", exit)
	}
	if cleanupCalled != 1 {
		t.Fatalf("cleanup called %d times, want 1", cleanupCalled)
	}
}

// Coverage helper reused by logger_test to keep focused runs exercising core paths.
func TestBackendParseJSONStream_CoverageSuite(t *testing.T) {
	suite := []struct {
		name string
		fn   func(*testing.T)
	}{
		{"TestBackendParseJSONStream", TestBackendParseJSONStream},
		{"TestRunNormalizeText", TestRunNormalizeText},
		{"TestRunTruncate", TestRunTruncate},
		{"TestRunMin", TestRunMin},
		{"TestRunGetEnv", TestRunGetEnv},
	}

	for _, tc := range suite {
		t.Run(tc.name, tc.fn)
	}
}

func TestRunHello(t *testing.T) {
	if got := hello(); got != "hello world" {
		t.Fatalf("hello() = %q, want %q", got, "hello world")
	}
}

func TestRunGreet(t *testing.T) {
	if got := greet("Linus"); got != "hello Linus" {
		t.Fatalf("greet() = %q, want %q", got, "hello Linus")
	}
}

func TestRunFarewell(t *testing.T) {
	if got := farewell("Linus"); got != "goodbye Linus" {
		t.Fatalf("farewell() = %q, want %q", got, "goodbye Linus")
	}
}

func TestRunFarewellEmpty(t *testing.T) {
	if got := farewell(""); got != "goodbye " {
		t.Fatalf("farewell(\"\") = %q, want %q", got, "goodbye ")
	}
}

func TestRunTailBuffer(t *testing.T) {
	tb := &tailBuffer{limit: 5}
	if n, err := tb.Write([]byte("abcd")); err != nil || n != 4 {
		t.Fatalf("Write returned (%d, %v), want (4, nil)", n, err)
	}
	if n, err := tb.Write([]byte("efg")); err != nil || n != 3 {
		t.Fatalf("Write returned (%d, %v), want (3, nil)", n, err)
	}
	if got := tb.String(); got != "cdefg" {
		t.Fatalf("tail buffer = %q, want %q", got, "cdefg")
	}
	if n, err := tb.Write([]byte("0123456")); err != nil || n != 7 {
		t.Fatalf("Write returned (%d, %v), want (7, nil)", n, err)
	}
	if got := tb.String(); got != "23456" {
		t.Fatalf("tail buffer = %q, want %q", got, "23456")
	}
}

func TestRunLogWriter(t *testing.T) {
	defer resetTestHooks()
	logger, err := NewLoggerWithSuffix("logwriter")
	if err != nil {
		t.Fatalf("failed to create logger: %v", err)
	}
	setLogger(logger)

	lw := newLogWriter("TEST: ", 10)
	if _, err := lw.Write([]byte("hello\n")); err != nil {
		t.Fatalf("write hello failed: %v", err)
	}
	if _, err := lw.Write([]byte("world-is-long")); err != nil {
		t.Fatalf("write world failed: %v", err)
	}
	lw.Flush()

	logger.Flush()
	logger.Close()

	data, err := os.ReadFile(logger.Path())
	if err != nil {
		t.Fatalf("failed to read log file: %v", err)
	}
	text := string(data)
	if !strings.Contains(text, "TEST: hello") {
		t.Fatalf("log missing hello entry: %s", text)
	}
	if !strings.Contains(text, "TEST: world-i...") {
		t.Fatalf("log missing truncated entry: %s", text)
	}
	os.Remove(logger.Path())
}

func TestNewLogWriterDefaultLimit(t *testing.T) {
	lw := newLogWriter("TEST: ", 0)
	if lw.maxLen != codexLogLineLimit {
		t.Fatalf("newLogWriter maxLen = %d, want %d", lw.maxLen, codexLogLineLimit)
	}
	lw = newLogWriter("TEST: ", -5)
	if lw.maxLen != codexLogLineLimit {
		t.Fatalf("negative maxLen should default, got %d", lw.maxLen)
	}
}

func TestBackendDiscardInvalidJSONBuffer(t *testing.T) {
	reader := bufio.NewReader(strings.NewReader("bad line\n{\"type\":\"ok\"}\n"))
	next, err := discardInvalidJSON(nil, reader)
	if err != nil {
		t.Fatalf("discardInvalidJSON error: %v", err)
	}
	line, err := next.ReadString('\n')
	if err != nil {
		t.Fatalf("failed to read next line: %v", err)
	}
	if strings.TrimSpace(line) != `{"type":"ok"}` {
		t.Fatalf("unexpected remaining line: %q", line)
	}

	t.Run("no newline", func(t *testing.T) {
		reader := bufio.NewReader(strings.NewReader("partial"))
		decoder := json.NewDecoder(strings.NewReader(""))
		if _, err := discardInvalidJSON(decoder, reader); !errors.Is(err, io.EOF) {
			t.Fatalf("expected EOF when no newline, got %v", err)
		}
	})
}

func TestRunForwardSignals(t *testing.T) {
	defer resetTestHooks()

	if runtime.GOOS == "windows" {
		t.Skip("sleep command not available on Windows")
	}

	execCmd := exec.Command("sleep", "5")
	if err := execCmd.Start(); err != nil {
		t.Skipf("unable to start sleep command: %v", err)
	}
	defer func() {
		_ = execCmd.Process.Kill()
		execCmd.Wait()
	}()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	forceKillDelay.Store(0)
	defer forceKillDelay.Store(5)

	ready := make(chan struct{})
	var captured chan<- os.Signal
	signalNotifyFn = func(ch chan<- os.Signal, sig ...os.Signal) {
		captured = ch
		close(ready)
	}
	signalStopFn = func(ch chan<- os.Signal) {}
	defer func() {
		signalNotifyFn = signal.Notify
		signalStopFn = signal.Stop
	}()

	var mu sync.Mutex
	var logs []string
	cmd := &realCmd{cmd: execCmd}
	forwardSignals(ctx, cmd, func(msg string) {
		mu.Lock()
		defer mu.Unlock()
		logs = append(logs, msg)
	})

	select {
	case <-ready:
	case <-time.After(500 * time.Millisecond):
		t.Fatalf("signalNotifyFn not invoked")
	}

	captured <- syscall.SIGINT

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatalf("process did not exit after forwarded signal")
	}

	mu.Lock()
	defer mu.Unlock()
	if len(logs) == 0 {
		t.Fatalf("expected log entry for forwarded signal")
	}
}

// Backend-focused coverage suite to ensure run() paths stay exercised under the focused pattern.
func TestBackendRunCoverage(t *testing.T) {
	suite := []struct {
		name string
		fn   func(*testing.T)
	}{
		{"SuccessfulExecution", TestRun_SuccessfulExecution},
		{"ExplicitStdinSuccess", TestRun_ExplicitStdinSuccess},
		{"PipedTaskSuccess", TestRun_PipedTaskSuccess},
		{"LoggerLifecycle", TestRun_LoggerLifecycle},
		{"CleanupFlag", TestRun_CleanupFlag},
		{"NoArgs", TestRun_NoArgs},
		{"CommandFails", TestRun_CommandFails},
		{"CleanupHookAlwaysCalled", TestRun_CleanupHookAlwaysCalled},
		{"VersionFlag", TestVersionFlag},
		{"VersionShortFlag", TestVersionShortFlag},
		{"VersionLegacyAlias", TestVersionLegacyAlias},
		{"Help", TestRun_Help},
		{"HelpShort", TestRun_HelpShort},
		{"HelpDoesNotTriggerCleanup", TestRun_HelpDoesNotTriggerCleanup},
		{"VersionDoesNotTriggerCleanup", TestVersionDoesNotTriggerCleanup},
		{"VersionCoverageFullRun", TestVersionCoverageFullRun},
		{"ExplicitStdinEmpty", TestRun_ExplicitStdinEmpty},
		{"ExplicitStdinReadError", TestRun_ExplicitStdinReadError},
		{"PipedTaskReadError", TestRun_PipedTaskReadError},
		{"VersionMainWrapper", TestVersionMainWrapper},
	}

	for _, tc := range suite {
		t.Run(tc.name, tc.fn)
	}
}

func TestParallelLogPathInSerialMode(t *testing.T) {
	defer resetTestHooks()

	tempDir := t.TempDir()
	t.Setenv("TMPDIR", tempDir)

	os.Args = []string{"codex-wrapper", "do-stuff"}
	stdinReader = strings.NewReader("")
	isTerminalFn = func() bool { return true }
	codexCommand = "echo"
	buildCodexArgsFn = func(cfg *Config, targetArg string) []string {
		return []string{`{"type":"thread.started","thread_id":"cli-session"}` + "\n" + `{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}`}
	}

	var exitCode int
	stderr := captureStderr(t, func() {
		_ = captureOutput(t, func() {
			exitCode = run()
		})
	})
	if exitCode != 0 {
		t.Fatalf("run() exit = %d, want 0", exitCode)
	}
	expectedLog := filepath.Join(tempDir, fmt.Sprintf("codex-wrapper-%d.log", os.Getpid()))
	wantLine := fmt.Sprintf("Log: %s", expectedLog)
	if !strings.Contains(stderr, wantLine) {
		t.Fatalf("stderr missing %q, got: %q", wantLine, stderr)
	}
}

func TestRealProcessNilSafety(t *testing.T) {
	var proc *realProcess
	if pid := proc.Pid(); pid != 0 {
		t.Fatalf("Pid() = %d, want 0", pid)
	}
	if err := proc.Kill(); err != nil {
		t.Fatalf("Kill() error = %v", err)
	}
	if err := proc.Signal(syscall.SIGTERM); err != nil {
		t.Fatalf("Signal() error = %v", err)
	}
}

func TestRealProcessKill(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("sleep command not available on Windows")
	}

	cmd := exec.Command("sleep", "5")
	if err := cmd.Start(); err != nil {
		t.Skipf("unable to start sleep command: %v", err)
	}
	waited := false
	defer func() {
		if waited {
			return
		}
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
			cmd.Wait()
		}
	}()

	proc := &realProcess{proc: cmd.Process}
	if proc.Pid() == 0 {
		t.Fatalf("Pid() returned 0 for active process")
	}
	if err := proc.Kill(); err != nil {
		t.Fatalf("Kill() error = %v", err)
	}
	waitErr := cmd.Wait()
	waited = true
	if waitErr == nil {
		t.Fatalf("Kill() should lead to non-nil wait error")
	}
}

func TestRealProcessSignal(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("sleep command not available on Windows")
	}

	cmd := exec.Command("sleep", "5")
	if err := cmd.Start(); err != nil {
		t.Skipf("unable to start sleep command: %v", err)
	}
	waited := false
	defer func() {
		if waited {
			return
		}
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
			cmd.Wait()
		}
	}()

	proc := &realProcess{proc: cmd.Process}
	if err := proc.Signal(syscall.SIGTERM); err != nil {
		t.Fatalf("Signal() error = %v", err)
	}
	waitErr := cmd.Wait()
	waited = true
	if waitErr == nil {
		t.Fatalf("Signal() should lead to non-nil wait error")
	}
}

func TestRealCmdProcess(t *testing.T) {
	rc := &realCmd{}
	if rc.Process() != nil {
		t.Fatalf("Process() should return nil when realCmd has no command")
	}
	rc = &realCmd{cmd: &exec.Cmd{}}
	if rc.Process() != nil {
		t.Fatalf("Process() should return nil when exec.Cmd has no process")
	}

	if runtime.GOOS == "windows" {
		return
	}

	cmd := exec.Command("sleep", "5")
	if err := cmd.Start(); err != nil {
		t.Skipf("unable to start sleep command: %v", err)
	}
	defer func() {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
			cmd.Wait()
		}
	}()

	rc = &realCmd{cmd: cmd}
	handle := rc.Process()
	if handle == nil {
		t.Fatalf("expected non-nil process handle")
	}
	if pid := handle.Pid(); pid == 0 {
		t.Fatalf("process handle returned pid=0")
	}
}

func TestRun_CLI_Success(t *testing.T) {
	defer resetTestHooks()
	os.Args = []string{"codeagent-wrapper", "do-things"}
	stdinReader = strings.NewReader("")
	isTerminalFn = func() bool { return true }

	restore := withBackend("echo", func(cfg *Config, targetArg string) []string {
		return []string{`{"type":"thread.started","thread_id":"cli-session"}` + "\n" + `{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}`}
	})
	defer restore()

	var exitCode int
	output := captureOutput(t, func() { exitCode = run() })

	if exitCode != 0 {
		t.Fatalf("run() exit=%d, want 0", exitCode)
	}
	if !strings.Contains(output, "ok") || !strings.Contains(output, "SESSION_ID: cli-session") {
		t.Fatalf("unexpected output: %q", output)
	}
}

func TestResolveMaxParallelWorkers(t *testing.T) {
	tests := []struct {
		name     string
		envValue string
		want     int
	}{
		{"empty env returns unlimited", "", 0},
		{"valid value", "4", 4},
		{"zero value", "0", 0},
		{"at limit", "100", 100},
		{"exceeds limit capped", "150", 100},
		{"negative falls back to unlimited", "-1", 0},
		{"invalid string falls back to unlimited", "abc", 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.envValue != "" {
				os.Setenv("CODEAGENT_MAX_PARALLEL_WORKERS", tt.envValue)
			} else {
				os.Unsetenv("CODEAGENT_MAX_PARALLEL_WORKERS")
			}
			defer os.Unsetenv("CODEAGENT_MAX_PARALLEL_WORKERS")

			got := resolveMaxParallelWorkers()
			if got != tt.want {
				t.Errorf("resolveMaxParallelWorkers() = %d, want %d", got, tt.want)
			}
		})
	}
}
