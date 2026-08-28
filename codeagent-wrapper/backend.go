package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Backend defines the contract for invoking different AI CLI backends.
// Each backend is responsible for supplying the executable command and
// building the argument list based on the wrapper config.
type Backend interface {
	Name() string
	BuildArgs(cfg *Config, targetArg string) []string
	Command() string
}

type CodexBackend struct{}

func (CodexBackend) Name() string { return "codex" }
func (CodexBackend) Command() string {
	return "codex"
}
func (CodexBackend) BuildArgs(cfg *Config, targetArg string) []string {
	return buildCodexArgs(cfg, targetArg)
}

type ClaudeBackend struct{}

func (ClaudeBackend) Name() string { return "claude" }
func (ClaudeBackend) Command() string {
	return "claude"
}
func (ClaudeBackend) BuildArgs(cfg *Config, targetArg string) []string {
	return buildClaudeArgs(cfg, targetArg)
}

const maxClaudeSettingsBytes = 1 << 20 // 1MB

// loadMinimalEnvSettings 从 ~/.claude/settings.json 只提取 env 配置。
// 只接受字符串类型的值；文件缺失/解析失败/超限都返回空。
func loadMinimalEnvSettings() map[string]string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return nil
	}

	settingPath := filepath.Join(home, ".claude", "settings.json")
	info, err := os.Stat(settingPath)
	if err != nil || info.Size() > maxClaudeSettingsBytes {
		return nil
	}

	data, err := os.ReadFile(settingPath)
	if err != nil {
		return nil
	}

	var cfg struct {
		Env map[string]any `json:"env"`
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil
	}
	if len(cfg.Env) == 0 {
		return nil
	}

	env := make(map[string]string, len(cfg.Env))
	for k, v := range cfg.Env {
		s, ok := v.(string)
		if !ok {
			continue
		}
		env[k] = s
	}
	if len(env) == 0 {
		return nil
	}
	return env
}

func buildClaudeArgs(cfg *Config, targetArg string) []string {
	if cfg == nil {
		return nil
	}
	args := []string{"-p"}
	// The wrapper is only ever invoked for autonomous orchestration sub-tasks
	// (review / analysis / implementation), never interactively. Claude must run
	// non-interactively like the gemini backend's `-y`: without bypassing
	// permissions, the headless `-p` reviewer blocks on tool-permission gates
	// while consuming tokens and never returns a result (#143). The old
	// `cfg.SkipPermissions` gate was effectively dead — no caller set it.
	args = append(args, "--dangerously-skip-permissions")

	// Prevent infinite recursion: disable all setting sources (user, project, local)
	// This ensures a clean execution environment without CLAUDE.md or skills that would trigger codeagent
	args = append(args, "--setting-sources", "")

	if cfg.Mode == "resume" {
		if cfg.SessionID != "" {
			// Claude CLI uses -r <session_id> for resume.
			args = append(args, "-r", cfg.SessionID)
		}
	}
	// Note: claude CLI doesn't support -C flag; workdir set via cmd.Dir

	args = append(args, "--output-format", "stream-json", "--verbose", targetArg)

	return args
}

type AntigravityBackend struct{}

func (AntigravityBackend) Name() string    { return "antigravity" }
func (AntigravityBackend) Command() string { return "agy" }
func (AntigravityBackend) BuildArgs(cfg *Config, targetArg string) []string {
	return buildAntigravityArgs(cfg, targetArg)
}

func buildAntigravityArgs(cfg *Config, targetArg string) []string {
	if cfg == nil {
		return nil
	}

	var args []string

	if cfg.SkipPermissions {
		args = append(args, "--dangerously-skip-permissions")
	}

	if cfg.Mode == "resume" && cfg.SessionID != "" {
		args = append(args, "--conversation", cfg.SessionID)
	}

	if cfg.Mode != "resume" && cfg.WorkDir != "" && cfg.WorkDir != "." {
		args = append(args, "--add-dir", cfg.WorkDir)
	}

	// -p must come right before the prompt text (last positional arg)
	args = append(args, "-p", targetArg)
	return args
}

type GrokBackend struct{}

func (GrokBackend) Name() string { return "grok" }

// Command resolves the grok binary. The official installer places it at
// ~/.grok/bin/grok (a symlink into ~/.grok/downloads/) and adds that dir to
// PATH via shell rc — which may not be sourced in non-interactive shells,
// so fall back to the well-known install location before giving up.
func (GrokBackend) Command() string {
	if _, err := exec.LookPath("grok"); err == nil {
		return "grok"
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return "grok"
	}
	fallback := filepath.Join(home, ".grok", "bin", "grok")
	if isWindows() {
		fallback += ".exe"
	}
	if _, err := os.Stat(fallback); err == nil {
		return fallback
	}
	return "grok"
}

func (GrokBackend) BuildArgs(cfg *Config, targetArg string) []string {
	return buildGrokArgs(cfg, targetArg)
}

func buildGrokArgs(cfg *Config, targetArg string) []string {
	if cfg == nil {
		return nil
	}

	// Grok CLI (native Rust binary, no .cmd shim) takes the prompt via -p on
	// every platform — multi-line args survive CreateProcess/execve intact.
	// --always-approve mirrors gemini's -y: the wrapper only ever runs
	// autonomous orchestration sub-tasks, never interactive sessions.
	args := []string{"--always-approve", "--output-format", "streaming-json"}

	if model := strings.TrimSpace(cfg.GrokModel); model != "" {
		args = append(args, "-m", model)
	}

	if cfg.Mode == "resume" && cfg.SessionID != "" {
		args = append(args, "-r", cfg.SessionID)
	}

	// Working directory comes from cmd.Dir (executor.go), same as the claude
	// backend — do NOT pass --cwd: grok resolves it against its own process
	// cwd, which IS cmd.Dir already, breaking relative paths.

	// -p carries the prompt text directly (grok has no stdin task mode).
	args = append(args, "-p", targetArg)
	return args
}

type OpencodeBackend struct{}

func (OpencodeBackend) Name() string    { return "opencode" }
func (OpencodeBackend) Command() string { return "opencode" }

func (OpencodeBackend) BuildArgs(cfg *Config, targetArg string) []string {
	return buildOpencodeArgs(cfg, targetArg)
}

func buildOpencodeArgs(cfg *Config, targetArg string) []string {
	if cfg == nil {
		return nil
	}

	// `opencode run` is the non-interactive entry point; --format json emits one
	// JSON event per line.
	args := []string{"run"}

	if model := strings.TrimSpace(cfg.OpencodeModel); model != "" {
		// opencode takes provider/model, e.g. anthropic/claude-sonnet-4-5.
		args = append(args, "-m", model)
	}

	if cfg.Mode == "resume" && cfg.SessionID != "" {
		args = append(args, "-s", cfg.SessionID)
	}

	args = append(args, "--format", "json")

	// The message is a positional arg. "-" is our internal stdin marker and is
	// not something opencode understands, so never forward it.
	if targetArg != "" && targetArg != "-" {
		args = append(args, targetArg)
	}
	return args
}

type KimiBackend struct{}

func (KimiBackend) Name() string    { return "kimi" }
func (KimiBackend) Command() string { return "kimi" }

func (KimiBackend) BuildArgs(cfg *Config, targetArg string) []string {
	return buildKimiArgs(cfg, targetArg)
}

func buildKimiArgs(cfg *Config, targetArg string) []string {
	if cfg == nil {
		return nil
	}

	// Kimi Code CLI. stream-json gives one JSON object per stdout line.
	args := []string{"--output-format", "stream-json"}

	if model := strings.TrimSpace(cfg.KimiModel); model != "" {
		args = append(args, "-m", model)
	}

	if cfg.Mode == "resume" && cfg.SessionID != "" {
		args = append(args, "-S", cfg.SessionID)
	}

	// Working directory comes from cmd.Dir (executor.go); --add-dir only adds
	// *extra* workspace roots, it does not relocate the primary one.
	//
	// ⚠ Do NOT add --yolo/--auto/--plan here: kimi rejects those combined with
	// -p at startup. Prompt mode already runs under the `auto` permission
	// policy, so it is autonomous by default.
	args = append(args, "-p", targetArg)
	return args
}

type GeminiBackend struct{}

func (GeminiBackend) Name() string { return "gemini" }
func (GeminiBackend) Command() string {
	return "gemini"
}
func (GeminiBackend) BuildArgs(cfg *Config, targetArg string) []string {
	return buildGeminiArgs(cfg, targetArg)
}

func buildGeminiArgs(cfg *Config, targetArg string) []string {
	if cfg == nil {
		return nil
	}

	args := []string{}

	// Add model parameter first (if specified)
	if model := strings.TrimSpace(cfg.GeminiModel); model != "" {
		args = append(args, "-m", model)
	}

	// Existing args
	args = append(args, "-o", "stream-json", "-y")

	// Same MCP skip as codex (~/.gemini/settings.json is mirrored by CCG's MCP
	// sync too). Gemini has no clean disable switch and its PolicyEngine rejects
	// an empty allowlist entry, so allow one name no real server uses — every
	// configured server falls outside the allowlist and is never started.
	if !cfg.WithMCP {
		args = append(args, "--allowed-mcp-server-names", "__ccg_none__")
	}

	if cfg.Mode == "resume" {
		if cfg.SessionID != "" {
			args = append(args, "-r", cfg.SessionID)
		}
	}

	// Gemini CLI loads .env from CWD and walks up to .git root / $HOME.
	// To avoid project-level .env overriding global API keys, we set cmd.Dir=$HOME
	// in executor.go and pass the project directory via --include-directories instead.
	// See: https://github.com/google-gemini/gemini-cli/issues/2493
	if cfg.Mode != "resume" && cfg.WorkDir != "" {
		args = append(args, "--include-directories", cfg.WorkDir)
	}

	// On Windows with stdin pipe mode, targetArg is "" — omit -p so Gemini reads from stdin.
	// On macOS/Linux, targetArg contains the actual prompt text for the -p flag.
	if targetArg != "" {
		args = append(args, "-p", targetArg)
	}

	return args
}
