package main

import (
	"os"
	"reflect"
	"testing"
)

// withArgs runs fn with os.Args set to the given argv (program name prepended),
// restoring the original os.Args afterwards.
func withArgs(t *testing.T, argv []string, fn func()) {
	t.Helper()
	old := os.Args
	t.Cleanup(func() { os.Args = old })
	os.Args = append([]string{"codeagent-wrapper"}, argv...)
	fn()
}

func TestMinimaxBackend_Metadata(t *testing.T) {
	b := MinimaxBackend{}
	if b.Name() != "minimax" {
		t.Fatalf("Name() = %s, want minimax", b.Name())
	}
	// MiniMax exposes an Anthropic-compatible endpoint, so it drives the claude CLI.
	if b.Command() != "claude" {
		t.Fatalf("Command() = %s, want claude", b.Command())
	}
}

func TestMinimaxBuildArgs_NewModeDefaultModel(t *testing.T) {
	backend := MinimaxBackend{}
	cfg := &Config{Mode: "new", WorkDir: "/repo", Backend: "minimax"}
	got := backend.BuildArgs(cfg, "todo")
	want := []string{"-p", "--dangerously-skip-permissions", "--setting-sources", "", "--model", "MiniMax-M3", "--output-format", "stream-json", "--verbose", "todo"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestMinimaxBuildArgs_CustomModel(t *testing.T) {
	backend := MinimaxBackend{}
	cfg := &Config{Mode: "new", WorkDir: "/repo", Backend: "minimax", MinimaxModel: "MiniMax-M2.7"}
	got := backend.BuildArgs(cfg, "todo")
	want := []string{"-p", "--dangerously-skip-permissions", "--setting-sources", "", "--model", "MiniMax-M2.7", "--output-format", "stream-json", "--verbose", "todo"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestMinimaxBuildArgs_ResumeMode(t *testing.T) {
	backend := MinimaxBackend{}
	cfg := &Config{Mode: "resume", SessionID: "sid-123", WorkDir: "/ignored", Backend: "minimax"}
	got := backend.BuildArgs(cfg, "resume-task")
	want := []string{"-p", "--dangerously-skip-permissions", "--setting-sources", "", "--model", "MiniMax-M3", "-r", "sid-123", "--output-format", "stream-json", "--verbose", "resume-task"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestMinimaxBuildArgs_NilConfig(t *testing.T) {
	if args := (MinimaxBackend{}).BuildArgs(nil, "ignored"); args != nil {
		t.Fatalf("nil config should return nil args, got %v", args)
	}
}

func TestResolveMinimaxModel(t *testing.T) {
	if got := resolveMinimaxModel(""); got != "MiniMax-M3" {
		t.Fatalf("empty model = %s, want MiniMax-M3", got)
	}
	if got := resolveMinimaxModel("  "); got != "MiniMax-M3" {
		t.Fatalf("blank model = %s, want MiniMax-M3", got)
	}
	if got := resolveMinimaxModel("MiniMax-M2.7"); got != "MiniMax-M2.7" {
		t.Fatalf("custom model = %s, want MiniMax-M2.7", got)
	}
}

func TestResolveMinimaxRegion(t *testing.T) {
	cases := map[string]string{
		"":          "global_en",
		"  ":        "global_en",
		"global_en": "global_en",
		"GLOBAL_EN": "global_en",
		"cn_zh":     "cn_zh",
		"CN_ZH":     "cn_zh",
		"unknown":   "global_en",
	}
	for in, want := range cases {
		if got := resolveMinimaxRegion(in); got != want {
			t.Fatalf("resolveMinimaxRegion(%q) = %s, want %s", in, got, want)
		}
	}
}

func TestMinimaxEndpoints_CoverBothRegions(t *testing.T) {
	global, ok := minimaxEndpoints["global_en"]
	if !ok {
		t.Fatal("missing global_en endpoint")
	}
	if global.OpenAIBaseURL != "https://api.minimax.io/v1" || global.AnthropicBaseURL != "https://api.minimax.io/anthropic" {
		t.Fatalf("global endpoint mismatch: %+v", global)
	}

	cn, ok := minimaxEndpoints["cn_zh"]
	if !ok {
		t.Fatal("missing cn_zh endpoint")
	}
	if cn.OpenAIBaseURL != "https://api.minimaxi.com/v1" || cn.AnthropicBaseURL != "https://api.minimaxi.com/anthropic" {
		t.Fatalf("cn endpoint mismatch: %+v", cn)
	}
}

func TestApplyMinimaxEnv_GlobalRegionDefault(t *testing.T) {
	env := map[string]string{}
	applyMinimaxEnv(env, &Config{Backend: "minimax"})
	if env["ANTHROPIC_BASE_URL"] != "https://api.minimax.io/anthropic" {
		t.Fatalf("base url = %s, want global anthropic endpoint", env["ANTHROPIC_BASE_URL"])
	}
}

func TestApplyMinimaxEnv_CNRegion(t *testing.T) {
	env := map[string]string{}
	applyMinimaxEnv(env, &Config{Backend: "minimax", MinimaxRegion: "cn_zh"})
	if env["ANTHROPIC_BASE_URL"] != "https://api.minimaxi.com/anthropic" {
		t.Fatalf("base url = %s, want cn anthropic endpoint", env["ANTHROPIC_BASE_URL"])
	}
}

func TestApplyMinimaxEnv_MapsAPIKey(t *testing.T) {
	t.Setenv("MINIMAX_API_KEY", "test-key")
	env := map[string]string{}
	applyMinimaxEnv(env, &Config{Backend: "minimax"})
	if env["ANTHROPIC_AUTH_TOKEN"] != "test-key" {
		t.Fatalf("auth token = %q, want test-key", env["ANTHROPIC_AUTH_TOKEN"])
	}
}

func TestApplyMinimaxEnv_NoopForOtherBackends(t *testing.T) {
	env := map[string]string{}
	applyMinimaxEnv(env, &Config{Backend: "claude"})
	if _, ok := env["ANTHROPIC_BASE_URL"]; ok {
		t.Fatalf("claude backend should not receive MiniMax base url: %v", env)
	}
}

func TestSelectBackend_Minimax(t *testing.T) {
	for _, name := range []string{"minimax", "MiniMax", "  MINIMAX  "} {
		backend, err := selectBackend(name)
		if err != nil {
			t.Fatalf("selectBackend(%q) error: %v", name, err)
		}
		if _, ok := backend.(MinimaxBackend); !ok {
			t.Fatalf("selectBackend(%q) = %T, want MinimaxBackend", name, backend)
		}
	}
}

func TestParseArgs_MinimaxModelAndRegion(t *testing.T) {
	t.Run("flags", func(t *testing.T) {
		withArgs(t, []string{"--backend", "minimax", "--minimax-model", "MiniMax-M2.7", "--minimax-region", "cn_zh", "task"}, func() {
			cfg, err := parseArgs()
			if err != nil {
				t.Fatalf("parseArgs error: %v", err)
			}
			if cfg.MinimaxModel != "MiniMax-M2.7" {
				t.Fatalf("model = %q, want MiniMax-M2.7", cfg.MinimaxModel)
			}
			if cfg.MinimaxRegion != "cn_zh" {
				t.Fatalf("region = %q, want cn_zh", cfg.MinimaxRegion)
			}
		})
	})

	t.Run("env fallback", func(t *testing.T) {
		t.Setenv("MINIMAX_MODEL", "MiniMax-M3")
		t.Setenv("MINIMAX_REGION", "global_en")
		withArgs(t, []string{"--backend", "minimax", "task"}, func() {
			cfg, err := parseArgs()
			if err != nil {
				t.Fatalf("parseArgs error: %v", err)
			}
			if cfg.MinimaxModel != "MiniMax-M3" || cfg.MinimaxRegion != "global_en" {
				t.Fatalf("env fallback failed: model=%q region=%q", cfg.MinimaxModel, cfg.MinimaxRegion)
			}
		})
	})

	t.Run("empty flag rejected", func(t *testing.T) {
		withArgs(t, []string{"--minimax-model=", "task"}, func() {
			if _, err := parseArgs(); err == nil {
				t.Fatal("expected error for empty --minimax-model")
			}
		})
	})
}
