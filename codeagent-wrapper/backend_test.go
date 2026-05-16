package main

import (
	"bytes"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestClaudeBuildArgs_ModesAndPermissions(t *testing.T) {
	backend := ClaudeBackend{}

	t.Run("new mode omits skip-permissions by default", func(t *testing.T) {
		cfg := &Config{Mode: "new", WorkDir: "/repo"}
		got := backend.BuildArgs(cfg, "todo")
		want := []string{"-p", "--setting-sources", "", "--output-format", "stream-json", "--verbose", "todo"}
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
		want := []string{"-p", "--setting-sources", "", "-r", "sid-123", "--output-format", "stream-json", "--verbose", "resume-task"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("resume mode without session still returns base flags", func(t *testing.T) {
		cfg := &Config{Mode: "resume", WorkDir: "/ignored"}
		got := backend.BuildArgs(cfg, "follow-up")
		want := []string{"-p", "--setting-sources", "", "--output-format", "stream-json", "--verbose", "follow-up"}
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

	t.Run("opencode new mode includes model permissions dir and attach", func(t *testing.T) {
		t.Setenv("OPENCODE_SERVER_URL", "http://localhost:58656")
		t.Setenv("CODEAGENT_OPENCODE_ATTACH", "true")

		backend := OpencodeBackend{}
		cfg := &Config{Mode: "new", WorkDir: "/workspace", SkipPermissions: true, OpencodeModel: "zhoumo/glm-5.1"}
		got := backend.BuildArgs(cfg, "hello")
		want := []string{"run", "--format", "json", "--dangerously-skip-permissions", "-m", "zhoumo/glm-5.1", "--dir", "/workspace", "--attach", "http://localhost:58656", "hello"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("opencode server env alone uses standalone mode", func(t *testing.T) {
		t.Setenv("OPENCODE_SERVER_URL", "http://localhost:58656")
		t.Setenv("CODEAGENT_OPENCODE_ATTACH", "")

		backend := OpencodeBackend{}
		cfg := &Config{Mode: "new", WorkDir: "/workspace", SkipPermissions: true, OpencodeModel: "zhoumo/glm-5.1"}
		got := backend.BuildArgs(cfg, "hello")
		want := []string{"run", "--format", "json", "--dangerously-skip-permissions", "-m", "zhoumo/glm-5.1", "--dir", "/workspace", "hello"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("opencode resume mode includes session", func(t *testing.T) {
		t.Setenv("OPENCODE_SERVER_URL", "")

		backend := OpencodeBackend{}
		cfg := &Config{Mode: "resume", SessionID: "ses_123", WorkDir: "/workspace"}
		got := backend.BuildArgs(cfg, "continue")
		want := []string{"run", "--format", "json", "--session", "ses_123", "--dir", "/workspace", "continue"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
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
		{backend: OpencodeBackend{}, name: "opencode", command: "opencode"},
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
