package main

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestClaudeBuildArgs_ModesAndPermissions(t *testing.T) {
	backend := ClaudeBackend{}

	t.Run("new mode always bypasses permissions (autonomous orchestration)", func(t *testing.T) {
		cfg := &Config{Mode: "new", WorkDir: "/repo"}
		got := backend.BuildArgs(cfg, "todo")
		want := []string{"-p", "--dangerously-skip-permissions", "--setting-sources", "", "--output-format", "stream-json", "--verbose", "todo"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("new mode can opt-in skip-permissions", func(t *testing.T) {
		cfg := &Config{Mode: "new", SkipPermissions: true}
		got := backend.BuildArgs(cfg, "-")
		want := []string{"-p", "--dangerously-skip-permissions", "--setting-sources", "", "--output-format", "stream-json", "--verbose", "-"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("resume mode includes session id", func(t *testing.T) {
		cfg := &Config{Mode: "resume", SessionID: "sid-123", WorkDir: "/ignored"}
		got := backend.BuildArgs(cfg, "resume-task")
		want := []string{"-p", "--dangerously-skip-permissions", "--setting-sources", "", "-r", "sid-123", "--output-format", "stream-json", "--verbose", "resume-task"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("resume mode without session still returns base flags", func(t *testing.T) {
		cfg := &Config{Mode: "resume", WorkDir: "/ignored"}
		got := backend.BuildArgs(cfg, "follow-up")
		want := []string{"-p", "--dangerously-skip-permissions", "--setting-sources", "", "--output-format", "stream-json", "--verbose", "follow-up"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("resume mode can opt-in skip permissions", func(t *testing.T) {
		cfg := &Config{Mode: "resume", SessionID: "sid-123", SkipPermissions: true}
		got := backend.BuildArgs(cfg, "resume-task")
		want := []string{"-p", "--dangerously-skip-permissions", "--setting-sources", "", "-r", "sid-123", "--output-format", "stream-json", "--verbose", "resume-task"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("nil config returns nil", func(t *testing.T) {
		if backend.BuildArgs(nil, "ignored") != nil {
			t.Fatalf("nil config should return nil args")
		}
	})
}

func TestClaudeBuildArgs_GeminiAndCodexModes(t *testing.T) {
	t.Run("gemini new mode passes workdir via include-directories", func(t *testing.T) {
		backend := GeminiBackend{}
		cfg := &Config{Mode: "new", WorkDir: "/workspace"}
		got := backend.BuildArgs(cfg, "task")
		want := []string{"-o", "stream-json", "-y", "--include-directories", "/workspace", "-p", "task"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("gemini new mode without workdir omits include-directories", func(t *testing.T) {
		backend := GeminiBackend{}
		cfg := &Config{Mode: "new"}
		got := backend.BuildArgs(cfg, "task")
		want := []string{"-o", "stream-json", "-y", "-p", "task"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("gemini resume mode uses session id without include-directories", func(t *testing.T) {
		backend := GeminiBackend{}
		cfg := &Config{Mode: "resume", SessionID: "sid-999", WorkDir: "/workspace"}
		got := backend.BuildArgs(cfg, "resume")
		want := []string{"-o", "stream-json", "-y", "-r", "sid-999", "-p", "resume"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("gemini resume mode without session omits identifier", func(t *testing.T) {
		backend := GeminiBackend{}
		cfg := &Config{Mode: "resume"}
		got := backend.BuildArgs(cfg, "resume")
		want := []string{"-o", "stream-json", "-y", "-p", "resume"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("gemini nil config returns nil", func(t *testing.T) {
		backend := GeminiBackend{}
		if backend.BuildArgs(nil, "ignored") != nil {
			t.Fatalf("nil config should return nil args")
		}
	})

	t.Run("codex build args includes bypass by default (CODEX_REQUIRE_APPROVAL unset)", func(t *testing.T) {
		t.Setenv("CODEX_REQUIRE_APPROVAL", "")

		backend := CodexBackend{}
		cfg := &Config{Mode: "new", WorkDir: "/tmp"}
		got := backend.BuildArgs(cfg, "task")
		want := []string{"e", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "-C", "/tmp", "--json", "task"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("codex build args omits bypass when CODEX_REQUIRE_APPROVAL=true", func(t *testing.T) {
		t.Setenv("CODEX_REQUIRE_APPROVAL", "true")

		backend := CodexBackend{}
		cfg := &Config{Mode: "new", WorkDir: "/tmp"}
		got := backend.BuildArgs(cfg, "task")
		want := []string{"e", "--skip-git-repo-check", "-C", "/tmp", "--json", "task"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("progress flag does not affect backend args", func(t *testing.T) {
		backend := CodexBackend{}
		cfg := &Config{Mode: "new", WorkDir: "/tmp", Progress: true}
		got := backend.BuildArgs(cfg, "task")
		want := []string{"e", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "-C", "/tmp", "--json", "task"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})
}

func TestGeminiBuildArgs_NeverReceivesDashAsPrompt(t *testing.T) {
	// Gemini CLI does not support "-" as stdin marker for -p flag.
	// Verify that BuildArgs never produces "-p -" — the actual task text
	// must be passed directly via -p.
	backend := GeminiBackend{}
	cfg := &Config{Mode: "new", WorkDir: "/workspace"}

	// When called with actual task text (geminiDirect path in executor)
	got := backend.BuildArgs(cfg, "Analyze the authentication module")
	want := []string{"-o", "stream-json", "-y", "--include-directories", "/workspace", "-p", "Analyze the authentication module"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}

	// Ensure "-" as targetArg would produce the broken "-p -" (this is what we prevent in executor)
	gotBroken := backend.BuildArgs(cfg, "-")
	for i, arg := range gotBroken {
		if arg == "-p" && i+1 < len(gotBroken) && gotBroken[i+1] == "-" {
			// This confirms the bug path — executor must never call BuildArgs with "-" for Gemini
			return
		}
	}
	t.Fatal("expected BuildArgs with '-' to produce '-p -' (the known broken path)")
}

func TestGeminiBuildArgs_OmitsPFlagWhenTargetEmpty(t *testing.T) {
	// On Windows, executor passes targetArg="" to signal stdin pipe mode.
	// buildGeminiArgs should omit -p entirely when targetArg is empty.
	backend := GeminiBackend{}
	cfg := &Config{Mode: "new", WorkDir: "/workspace"}

	got := backend.BuildArgs(cfg, "")
	// Should NOT contain -p at all
	for i, arg := range got {
		if arg == "-p" {
			t.Fatalf("expected no -p flag when targetArg is empty, but found -p at index %d: %v", i, got)
		}
	}
	// Should still contain other flags
	want := []string{"-o", "stream-json", "-y", "--include-directories", "/workspace"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestGeminiBuildArgs_WithModel_OmitsPFlagWhenTargetEmpty(t *testing.T) {
	backend := GeminiBackend{}
	cfg := &Config{Mode: "new", WorkDir: "/workspace", GeminiModel: "gemini-3.1-pro-preview"}

	got := backend.BuildArgs(cfg, "")
	for i, arg := range got {
		if arg == "-p" {
			t.Fatalf("expected no -p flag when targetArg is empty, but found -p at index %d: %v", i, got)
		}
	}
	want := []string{"-m", "gemini-3.1-pro-preview", "-o", "stream-json", "-y", "--include-directories", "/workspace"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestClaudeBuildArgs_BackendMetadata(t *testing.T) {
	tests := []struct {
		backend Backend
		name    string
		command string
	}{
		{backend: CodexBackend{}, name: "codex", command: "codex"},
		{backend: ClaudeBackend{}, name: "claude", command: "claude"},
		{backend: GeminiBackend{}, name: "gemini", command: "gemini"},
	}

	for _, tt := range tests {
		if got := tt.backend.Name(); got != tt.name {
			t.Fatalf("Name() = %s, want %s", got, tt.name)
		}
		if got := tt.backend.Command(); got != tt.command {
			t.Fatalf("Command() = %s, want %s", got, tt.command)
		}
	}
}

func TestLoadMinimalEnvSettings(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	t.Run("missing file returns empty", func(t *testing.T) {
		if got := loadMinimalEnvSettings(); len(got) != 0 {
			t.Fatalf("got %v, want empty", got)
		}
	})

	t.Run("valid env returns string map", func(t *testing.T) {
		dir := filepath.Join(home, ".claude")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("MkdirAll: %v", err)
		}
		path := filepath.Join(dir, "settings.json")
		data := []byte(`{"env":{"ANTHROPIC_API_KEY":"secret","FOO":"bar"}}`)
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}

		got := loadMinimalEnvSettings()
		if got["ANTHROPIC_API_KEY"] != "secret" || got["FOO"] != "bar" {
			t.Fatalf("got %v, want keys present", got)
		}
	})

	t.Run("non-string values are ignored", func(t *testing.T) {
		dir := filepath.Join(home, ".claude")
		path := filepath.Join(dir, "settings.json")
		data := []byte(`{"env":{"GOOD":"ok","BAD":123,"ALSO_BAD":true}}`)
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}

		got := loadMinimalEnvSettings()
		if got["GOOD"] != "ok" {
			t.Fatalf("got %v, want GOOD=ok", got)
		}
		if _, ok := got["BAD"]; ok {
			t.Fatalf("got %v, want BAD omitted", got)
		}
		if _, ok := got["ALSO_BAD"]; ok {
			t.Fatalf("got %v, want ALSO_BAD omitted", got)
		}
	})

	t.Run("oversized file returns empty", func(t *testing.T) {
		dir := filepath.Join(home, ".claude")
		path := filepath.Join(dir, "settings.json")
		data := bytes.Repeat([]byte("a"), maxClaudeSettingsBytes+1)
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}
		if got := loadMinimalEnvSettings(); len(got) != 0 {
			t.Fatalf("got %v, want empty", got)
		}
	})
}

func TestGrokBuildArgs_NewMode(t *testing.T) {
	cfg := &Config{Mode: "new", WorkDir: "/tmp/project", Backend: "grok"}
	args := buildGrokArgs(cfg, "do the task")

	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "--always-approve") {
		t.Fatalf("args missing --always-approve: %v", args)
	}
	if !strings.Contains(joined, "--output-format streaming-json") {
		t.Fatalf("args missing streaming-json output format: %v", args)
	}
	if strings.Contains(joined, "--cwd") {
		t.Fatalf("args must not contain --cwd (workdir comes from cmd.Dir): %v", args)
	}
	// -p must be followed by the task text
	for i, a := range args {
		if a == "-p" {
			if i+1 >= len(args) || args[i+1] != "do the task" {
				t.Fatalf("-p not followed by task text: %v", args)
			}
			return
		}
	}
	t.Fatalf("args missing -p: %v", args)
}

func TestGrokBuildArgs_ResumeMode(t *testing.T) {
	cfg := &Config{Mode: "resume", SessionID: "sess-123", WorkDir: "/tmp/project", Backend: "grok"}
	args := buildGrokArgs(cfg, "continue")

	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-r sess-123") {
		t.Fatalf("resume args missing -r <session>: %v", args)
	}
	if !strings.Contains(joined, "-p continue") {
		t.Fatalf("resume args missing -p prompt: %v", args)
	}
}

func TestGrokBuildArgs_WithModel(t *testing.T) {
	cfg := &Config{Mode: "new", WorkDir: ".", Backend: "grok", GrokModel: "grok-4.5"}
	args := buildGrokArgs(cfg, "task")

	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-m grok-4.5") {
		t.Fatalf("args missing -m grok-4.5: %v", args)
	}
}

func TestGrokBuildArgs_NilConfig(t *testing.T) {
	if args := buildGrokArgs(nil, "x"); args != nil {
		t.Fatalf("nil config should return nil args, got %v", args)
	}
}

func TestGrokBackend_Metadata(t *testing.T) {
	b := GrokBackend{}
	if b.Name() != "grok" {
		t.Fatalf("name = %s, want grok", b.Name())
	}
	if b.Command() == "" {
		t.Fatalf("command must not be empty")
	}
}

func TestParseJSONStream_GrokEvents(t *testing.T) {
	stream := `{"type":"thought","data":"thinking"}
{"type":"thought","data":" more"}
{"type":"text","data":"Hello"}
{"type":"text","data":" world"}
{"type":"end","stopReason":"EndTurn","sessionId":"019f-abc","requestId":"req-1"}
`
	var sessionFromCallback string
	message, threadID := parseJSONStreamInternalWithContent(
		strings.NewReader(stream), nil, nil, nil, nil, nil, nil,
		func(id string) { sessionFromCallback = id },
	)

	if message != "Hello world" {
		t.Fatalf("message = %q, want %q", message, "Hello world")
	}
	if threadID != "019f-abc" {
		t.Fatalf("threadID = %q, want %q", threadID, "019f-abc")
	}
	if sessionFromCallback != "019f-abc" {
		t.Fatalf("onSessionStarted got %q, want %q", sessionFromCallback, "019f-abc")
	}
}

func TestParseJSONStream_GrokThoughtsExcludedFromMessage(t *testing.T) {
	stream := `{"type":"thought","data":"secret reasoning"}
{"type":"text","data":"answer"}
{"type":"end","stopReason":"EndTurn","sessionId":"s1","requestId":"r1"}
`
	message, _ := parseJSONStreamInternal(strings.NewReader(stream), nil, nil, nil, nil)
	if message != "answer" {
		t.Fatalf("message = %q, want %q (thoughts must not leak)", message, "answer")
	}
}

func TestKimiBuildArgs_NewMode(t *testing.T) {
	cfg := &Config{Mode: "new", WorkDir: "/tmp/project", Backend: "kimi"}
	args := buildKimiArgs(cfg, "do the task")
	joined := strings.Join(args, " ")

	if !strings.Contains(joined, "--output-format stream-json") {
		t.Fatalf("args missing stream-json output format: %v", args)
	}
	// kimi rejects --yolo/--auto/--plan when combined with -p at startup.
	for _, forbidden := range []string{"--yolo", "-y", "--auto", "--plan"} {
		for _, a := range args {
			if a == forbidden {
				t.Fatalf("args must not contain %s alongside -p: %v", forbidden, args)
			}
		}
	}
	if strings.Contains(joined, "--cwd") || strings.Contains(joined, "--add-dir") {
		t.Fatalf("workdir must come from cmd.Dir, not flags: %v", args)
	}
	for i, a := range args {
		if a == "-p" {
			if i+1 >= len(args) || args[i+1] != "do the task" {
				t.Fatalf("-p not followed by task text: %v", args)
			}
			return
		}
	}
	t.Fatalf("args missing -p: %v", args)
}

func TestKimiBuildArgs_ResumeAndModel(t *testing.T) {
	cfg := &Config{Mode: "resume", SessionID: "01HZXYZ", Backend: "kimi", KimiModel: "kimi-for-coding"}
	joined := strings.Join(buildKimiArgs(cfg, "continue"), " ")

	if !strings.Contains(joined, "-S 01HZXYZ") {
		t.Fatalf("resume args missing -S <session>: %s", joined)
	}
	if !strings.Contains(joined, "-m kimi-for-coding") {
		t.Fatalf("args missing -m model: %s", joined)
	}
}

func TestKimiBuildArgs_NilConfig(t *testing.T) {
	if args := buildKimiArgs(nil, "x"); args != nil {
		t.Fatalf("nil config should return nil args, got %v", args)
	}
}

func TestParseJSONStream_KimiEvents(t *testing.T) {
	// Real shapes captured from `kimi -p ... --output-format stream-json` (v0.35.0).
	stream := `{"role":"meta","type":"system.version","version":"0.35.0"}
{"role":"assistant","content":"Hello"}
{"role":"tool","tool_call_id":"call_1","content":"TOOL OUTPUT MUST NOT LEAK"}
{"role":"assistant","content":" world"}
{"role":"meta","type":"session.resume_hint","session_id":"01HZ-ABC","command":"kimi -r 01HZ-ABC","content":"To resume this session: kimi -r 01HZ-ABC"}
`
	message, threadID := parseJSONStreamInternal(strings.NewReader(stream), nil, nil, nil, nil)

	if message != "Hello world" {
		t.Fatalf("message = %q, want %q", message, "Hello world")
	}
	if strings.Contains(message, "TOOL OUTPUT") {
		t.Fatalf("tool output leaked into message: %q", message)
	}
	if strings.Contains(message, "To resume this session") {
		t.Fatalf("meta resume hint leaked into message: %q", message)
	}
	if threadID != "01HZ-ABC" {
		t.Fatalf("threadID = %q, want 01HZ-ABC", threadID)
	}
}

func TestParseJSONStream_KimiNotMisreadAsGemini(t *testing.T) {
	// Gemini's branch keys off `role`; kimi reuses it. A kimi-only stream must
	// never fall through to the gemini handler (which would append meta
	// `content` — the resume hint — to the answer).
	stream := `{"role":"meta","type":"session.resume_hint","session_id":"s1","content":"To resume this session: kimi -r s1"}
{"role":"assistant","content":"ANSWER"}
`
	message, _ := parseJSONStreamInternal(strings.NewReader(stream), nil, nil, nil, nil)
	if message != "ANSWER" {
		t.Fatalf("message = %q, want %q", message, "ANSWER")
	}
}

func TestParseJSONStream_GeminiStillWinsOverKimi(t *testing.T) {
	// Gemini stamps a type on every event, so it must keep its own branch.
	stream := `{"type":"init","sessionId":"g1","model":"gemini-3.1-pro-preview"}
{"type":"message","role":"assistant","content":"GEM","delta":false}
{"type":"result","status":"success","sessionId":"g1"}
`
	message, threadID := parseJSONStreamInternal(strings.NewReader(stream), nil, nil, nil, nil)
	if message != "GEM" {
		t.Fatalf("gemini message = %q, want GEM", message)
	}
	if threadID != "g1" {
		t.Fatalf("gemini threadID = %q, want g1", threadID)
	}
}

func TestDiscoversClaudeConfig(t *testing.T) {
	for _, b := range []string{"grok", "kimi"} {
		if !discoversClaudeConfig(b) {
			t.Fatalf("%s should use the fast home", b)
		}
	}
	for _, b := range []string{"codex", "gemini", "claude", "antigravity"} {
		if discoversClaudeConfig(b) {
			t.Fatalf("%s reads its own config tree, must not be rerouted", b)
		}
	}
}

func TestApplyFastHome(t *testing.T) {
	t.Run("hides claude config for grok", func(t *testing.T) {
		env := applyFastHome(map[string]string{}, "grok", false)
		home := env["HOME"]
		if home == "" {
			t.Skip("symlinks unavailable on this platform")
		}
		for _, hidden := range claudeConfigEntries {
			if _, err := os.Lstat(filepath.Join(home, hidden)); err == nil {
				t.Fatalf("%s should not exist in the fast home", hidden)
			}
		}
		// .gitconfig etc. must still pass through so sub-agent shell commands work.
		realHome, _ := os.UserHomeDir()
		if _, err := os.Stat(filepath.Join(realHome, ".gitconfig")); err == nil {
			if _, err := os.Lstat(filepath.Join(home, ".gitconfig")); err != nil {
				t.Fatalf(".gitconfig should be mirrored into the fast home")
			}
		}
	})

	t.Run("--with-mcp opts out", func(t *testing.T) {
		env := applyFastHome(map[string]string{}, "grok", true)
		if _, ok := env["HOME"]; ok {
			t.Fatalf("--with-mcp must leave HOME untouched")
		}
	})

	t.Run("other backends untouched", func(t *testing.T) {
		env := applyFastHome(map[string]string{}, "codex", false)
		if _, ok := env["HOME"]; ok {
			t.Fatalf("codex must not be rerouted")
		}
	})
}

func TestOpencodeBuildArgs_NewMode(t *testing.T) {
	cfg := &Config{Mode: "new", WorkDir: "/tmp/project", Backend: "opencode"}
	args := buildOpencodeArgs(cfg, "do the task")

	if len(args) == 0 || args[0] != "run" {
		t.Fatalf("opencode must start with the run subcommand: %v", args)
	}
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "--format json") {
		t.Fatalf("args missing --format json: %v", args)
	}
	if args[len(args)-1] != "do the task" {
		t.Fatalf("message must be the trailing positional arg: %v", args)
	}
}

func TestOpencodeBuildArgs_NeverForwardsStdinMarker(t *testing.T) {
	// "-" is the wrapper's internal stdin marker; opencode would treat it as a
	// literal message.
	cfg := &Config{Mode: "new", Backend: "opencode"}
	for _, a := range buildOpencodeArgs(cfg, "-") {
		if a == "-" {
			t.Fatalf("stdin marker leaked into opencode args: %v", buildOpencodeArgs(cfg, "-"))
		}
	}
}

func TestOpencodeBuildArgs_ResumeAndModel(t *testing.T) {
	cfg := &Config{Mode: "resume", SessionID: "ses_abc", Backend: "opencode", OpencodeModel: "anthropic/claude-sonnet-4-5"}
	joined := strings.Join(buildOpencodeArgs(cfg, "continue"), " ")

	if !strings.Contains(joined, "-s ses_abc") {
		t.Fatalf("resume args missing -s <session>: %s", joined)
	}
	if !strings.Contains(joined, "-m anthropic/claude-sonnet-4-5") {
		t.Fatalf("args missing -m provider/model: %s", joined)
	}
}

func TestParseJSONStream_OpencodeEvents(t *testing.T) {
	stream := `{"type":"text","sessionID":"ses_001","part":{"type":"text","text":"Hello"}}
{"type":"text","sessionID":"ses_001","part":{"type":"text","text":" world"}}
{"type":"step-finish","sessionID":"ses_001","part":{"type":"step-finish","reason":"stop"}}
`
	message, threadID := parseJSONStreamInternal(strings.NewReader(stream), nil, nil, nil, nil)
	if message != "Hello world" {
		t.Fatalf("message = %q, want %q", message, "Hello world")
	}
	if threadID != "ses_001" {
		t.Fatalf("threadID = %q, want ses_001", threadID)
	}
}

func TestParseJSONStream_OpencodeErrorEventCarriesSession(t *testing.T) {
	// Real shape captured from `opencode run --format json` on an auth failure:
	// sessionID present, no part. Must not be misread as another backend.
	stream := `{"type":"error","timestamp":1786513156960,"sessionID":"ses_002","error":{"name":"APIError"}}
`
	message, threadID := parseJSONStreamInternal(strings.NewReader(stream), nil, nil, nil, nil)
	if message != "" {
		t.Fatalf("error-only stream should produce no message, got %q", message)
	}
	if threadID != "" && threadID != "ses_002" {
		t.Fatalf("unexpected threadID %q", threadID)
	}
}

func TestParseJSONStream_OpencodeDoesNotCollideWithGemini(t *testing.T) {
	// Gemini uses "sessionId" (lowercase d) and no part; opencode uses
	// "sessionID" plus part. Both must land in their own branch.
	gem := `{"type":"init","sessionId":"g1"}
{"type":"message","role":"assistant","content":"GEM"}
{"type":"result","status":"success","sessionId":"g1"}
`
	msg, _ := parseJSONStreamInternal(strings.NewReader(gem), nil, nil, nil, nil)
	if msg != "GEM" {
		t.Fatalf("gemini message = %q, want GEM", msg)
	}

	oc := `{"type":"text","sessionID":"o1","part":{"type":"text","text":"OC"}}`
	msg2, tid := parseJSONStreamInternal(strings.NewReader(oc), nil, nil, nil, nil)
	if msg2 != "OC" {
		t.Fatalf("opencode message = %q, want OC", msg2)
	}
	if tid != "o1" {
		t.Fatalf("opencode threadID = %q, want o1", tid)
	}
}
