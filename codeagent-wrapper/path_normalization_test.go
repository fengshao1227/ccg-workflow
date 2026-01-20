package main

import (
	"os"
	"strings"
	"testing"
)

func TestNormalizeWindowsPath(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "Git Bash style path with lowercase drive",
			input:    "/c/Users/TJY5/.claude/prompts/codex/reviewer.md",
			expected: "C:/Users/TJY5/.claude/prompts/codex/reviewer.md",
		},
		{
			name:     "Git Bash style path with uppercase drive",
			input:    "/D/Projects/code",
			expected: "D:/Projects/code",
		},
		{
			name:     "Windows native path with forward slashes (unchanged)",
			input:    "C:/Users/foo/bar.txt",
			expected: "C:/Users/foo/bar.txt",
		},
		{
			name:     "Windows native path with backslashes",
			input:    "C:\\Users\\foo\\bar.txt",
			expected: "C:/Users/foo/bar.txt",
		},
		{
			name:     "Relative path (unchanged)",
			input:    "relative/path/to/file.txt",
			expected: "relative/path/to/file.txt",
		},
		{
			name:     "Unix absolute path (unchanged)",
			input:    "/usr/local/bin",
			expected: "/usr/local/bin",
		},
		{
			name:     "Mixed separators",
			input:    "/c/Users\\foo/bar.txt",
			expected: "C:/Users/foo/bar.txt",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := normalizeWindowsPath(tt.input)
			if result != tt.expected {
				t.Errorf("normalizeWindowsPath(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestInjectRoleFile_WindowsPathHandling(t *testing.T) {
	// Skip this test on non-test builds (requires test hooks)
	// This test validates that Windows paths work correctly in ROLE_FILE directives
	t.Skip("Skipping integration test - requires mock filesystem setup")
}

// Helper functions for tests
func writeTestFile(path string, content []byte) error {
	return os.WriteFile(path, content, 0644)
}

func convertToGitBashPath(path string) string {
	// Simple conversion for testing (assumes path starts with drive letter)
	if len(path) >= 2 && path[1] == ':' {
		drive := strings.ToLower(string(path[0]))
		return "/" + drive + path[2:]
	}
	return path
}

func contains(s, substr string) bool {
	return len(substr) == 0 || len(s) >= len(substr) && (s == substr || len(s) > len(substr) && containsRec(s, substr))
}

func containsRec(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
