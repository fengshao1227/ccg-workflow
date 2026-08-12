package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// Claude Code entries that sub-agent CLIs auto-discover but never need.
//
// grok and kimi both read ~/.claude.json for MCP servers and ~/.claude/ for
// skills/plugins/agents. Connecting to those MCP servers costs roughly 25s of
// wall time on every invocation (measured: 32-36s -> 7.8s once hidden, with a
// 9-server ~/.claude.json), and the sub-agent has no use for them — Claude is
// the orchestrator holding MCP, the sub-agent only reads/writes files and runs
// commands. Hiding them is the single largest latency win in the wrapper.
var claudeConfigEntries = []string{".claude.json", ".claude"}

// discoversClaudeConfig reports whether a backend auto-loads Claude Code's
// config, making the shadow HOME worthwhile. codex and gemini read their own
// config trees (~/.codex, ~/.gemini) which pass through untouched.
func discoversClaudeConfig(backend string) bool {
	switch backend {
	case "grok", "kimi":
		return true
	}
	return false
}

var (
	fastHomeOnce sync.Once
	fastHomePath string
)

// prepareFastHome mirrors $HOME into a temp directory using symlinks, omitting
// only the Claude Code entries. Everything else — .gitconfig, .npmrc, .ssh, and
// the backend's own auth directory — passes through, so shell commands the
// sub-agent runs behave exactly as they would under the real HOME.
//
// Returns "" when the shadow home cannot be built (most likely Windows without
// symlink privileges); callers then fall back to the real HOME and simply pay
// the original startup cost.
func prepareFastHome() string {
	fastHomeOnce.Do(func() {
		home, err := os.UserHomeDir()
		if err != nil || home == "" {
			return
		}
		entries, err := os.ReadDir(home)
		if err != nil {
			return
		}

		shadow := filepath.Join(os.TempDir(), fmt.Sprintf("ccg-fasthome-%d-%d", os.Getuid(), os.Getpid()))
		if err := os.RemoveAll(shadow); err != nil {
			return
		}
		if err := os.MkdirAll(shadow, 0o700); err != nil {
			return
		}

		skip := make(map[string]struct{}, len(claudeConfigEntries))
		for _, name := range claudeConfigEntries {
			skip[name] = struct{}{}
		}

		linked := 0
		for _, entry := range entries {
			name := entry.Name()
			if _, hidden := skip[name]; hidden {
				continue
			}
			if err := os.Symlink(filepath.Join(home, name), filepath.Join(shadow, name)); err == nil {
				linked++
			}
		}

		// A shadow home with nothing in it means symlinks are unavailable
		// (Windows without Developer Mode). Don't hand back a broken HOME.
		if linked == 0 {
			_ = os.RemoveAll(shadow)
			return
		}
		fastHomePath = shadow
	})
	return fastHomePath
}

// cleanupFastHome removes the shadow home. The symlinks point at the real HOME
// but are never followed during removal, so the user's files are untouched.
func cleanupFastHome() {
	if fastHomePath == "" {
		return
	}
	_ = os.RemoveAll(fastHomePath)
	fastHomePath = ""
}

// applyFastHome injects the shadow HOME into a backend's environment when the
// optimization applies. withMCP restores the original behaviour for callers
// that genuinely want the sub-agent to reach Claude's MCP servers.
func applyFastHome(env map[string]string, backend string, withMCP bool) map[string]string {
	if withMCP || !discoversClaudeConfig(backend) {
		return env
	}
	shadow := prepareFastHome()
	if shadow == "" {
		return env
	}
	if env == nil {
		env = make(map[string]string, 1)
	}
	env["HOME"] = shadow
	return env
}
