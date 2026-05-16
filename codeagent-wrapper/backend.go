package main

import (
	"encoding/json"
	"os"
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
	if cfg.SkipPermissions {
		args = append(args, "--dangerously-skip-permissions")
	}

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

type GeminiBackend struct{}

func (GeminiBackend) Name() string { return "gemini" }
func (GeminiBackend) Command() string {
	return "gemini"
}
func (GeminiBackend) BuildArgs(cfg *Config, targetArg string) []string {
	return buildGeminiArgs(cfg, targetArg)
}

type OpencodeBackend struct{}

func (OpencodeBackend) Name() string { return "opencode" }
func (OpencodeBackend) Command() string {
	return "opencode"
}
func (OpencodeBackend) BuildArgs(cfg *Config, targetArg string) []string {
	return buildOpencodeArgs(cfg, targetArg)
}

func buildOpencodeArgs(cfg *Config, targetArg string) []string {
	if cfg == nil {
		return nil
	}

	args := []string{"run", "--format", "json"}

	if cfg.SkipPermissions {
		args = append(args, "--dangerously-skip-permissions")
	}

	if model := strings.TrimSpace(cfg.OpencodeModel); model != "" {
		args = append(args, "-m", model)
	}

	if cfg.Mode == "resume" && cfg.SessionID != "" {
		args = append(args, "--session", cfg.SessionID)
	}

	if cfg.WorkDir != "" {
		args = append(args, "--dir", cfg.WorkDir)
	}

	opencodeServerURL := strings.TrimSpace(os.Getenv("OPENCODE_SERVER_URL"))
	if opencodeServerURL != "" && envFlagEnabled("CODEAGENT_OPENCODE_ATTACH") {
		args = append(args, "--attach", opencodeServerURL)
	}

	args = append(args, targetArg)

	return args
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
