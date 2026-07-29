package main

import (
	"os"
	"strings"
)

// MiniMax is integrated by driving the same Claude CLI binary against MiniMax's
// Anthropic-compatible endpoint. This keeps the backend surface identical to
// the other CLI backends: the model is pinned via --model in BuildArgs, while
// the regional API base URL and API key are redirected through environment
// variables in applyMinimaxEnv.

const (
	// defaultMinimaxModel is used when neither --minimax-model nor the
	// MINIMAX_MODEL environment variable supplies a model name.
	defaultMinimaxModel = "MiniMax-M3"

	// defaultMinimaxRegion selects the global endpoint by default.
	defaultMinimaxRegion = "global_en"
)

// minimaxEndpoint holds the regional API base URLs MiniMax exposes.
type minimaxEndpoint struct {
	OpenAIBaseURL    string
	AnthropicBaseURL string
}

// minimaxEndpoints maps a region key to its base URLs. Both the global and the
// mainland-China regions are supported; the Anthropic base URL is what drives
// the Claude CLI, and the OpenAI base URL is kept alongside it for parity.
var minimaxEndpoints = map[string]minimaxEndpoint{
	"global_en": {
		OpenAIBaseURL:    "https://api.minimax.io/v1",
		AnthropicBaseURL: "https://api.minimax.io/anthropic",
	},
	"cn_zh": {
		OpenAIBaseURL:    "https://api.minimaxi.com/v1",
		AnthropicBaseURL: "https://api.minimaxi.com/anthropic",
	},
}

// resolveMinimaxRegion normalises a region string, falling back to the default
// region when it is empty or unknown.
func resolveMinimaxRegion(region string) string {
	key := strings.ToLower(strings.TrimSpace(region))
	if key == "" {
		return defaultMinimaxRegion
	}
	if _, ok := minimaxEndpoints[key]; ok {
		return key
	}
	return defaultMinimaxRegion
}

// resolveMinimaxModel returns the configured model, or the default when empty.
func resolveMinimaxModel(model string) string {
	if m := strings.TrimSpace(model); m != "" {
		return m
	}
	return defaultMinimaxModel
}

// MinimaxBackend runs the Claude CLI against MiniMax's Anthropic-compatible API.
type MinimaxBackend struct{}

func (MinimaxBackend) Name() string { return "minimax" }

// Command reuses the claude CLI binary. MiniMax exposes an Anthropic-compatible
// endpoint, so the same executable drives it once the base URL and auth token
// are redirected via environment variables (see applyMinimaxEnv).
func (MinimaxBackend) Command() string { return "claude" }

func (MinimaxBackend) BuildArgs(cfg *Config, targetArg string) []string {
	return buildMinimaxArgs(cfg, targetArg)
}

// buildMinimaxArgs mirrors buildClaudeArgs and pins the MiniMax model via
// --model so each request targets the selected model.
func buildMinimaxArgs(cfg *Config, targetArg string) []string {
	if cfg == nil {
		return nil
	}

	// Same non-interactive flags as the claude backend: the wrapper only ever
	// runs autonomous orchestration sub-tasks, and setting sources are disabled
	// to avoid recursively triggering codeagent.
	args := []string{"-p", "--dangerously-skip-permissions", "--setting-sources", ""}

	// Pin the MiniMax model (default MiniMax-M3, or any model from the flag/env).
	args = append(args, "--model", resolveMinimaxModel(cfg.MinimaxModel))

	if cfg.Mode == "resume" && cfg.SessionID != "" {
		args = append(args, "-r", cfg.SessionID)
	}

	args = append(args, "--output-format", "stream-json", "--verbose", targetArg)

	return args
}

// applyMinimaxEnv redirects the Claude CLI to MiniMax's regional Anthropic
// endpoint and maps the MiniMax API key onto the variable the CLI reads. It is
// a no-op for every other backend, so it is safe to call unconditionally.
func applyMinimaxEnv(env map[string]string, cfg *Config) {
	if env == nil || cfg == nil || cfg.Backend != "minimax" {
		return
	}

	endpoint := minimaxEndpoints[resolveMinimaxRegion(cfg.MinimaxRegion)]
	env["ANTHROPIC_BASE_URL"] = endpoint.AnthropicBaseURL

	if key := strings.TrimSpace(os.Getenv("MINIMAX_API_KEY")); key != "" {
		env["ANTHROPIC_AUTH_TOKEN"] = key
	}
}
