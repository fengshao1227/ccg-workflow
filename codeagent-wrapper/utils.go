package main

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

func resolveTimeout() int {
	raw := os.Getenv("CODEX_TIMEOUT")
	if raw == "" {
		return defaultTimeout
	}

	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed <= 0 {
		logWarn(fmt.Sprintf("Invalid CODEX_TIMEOUT '%s', falling back to %ds", raw, defaultTimeout))
		return defaultTimeout
	}

	if parsed > 10000 {
		return parsed / 1000
	}
	return parsed
}

func readPipedTask() (string, error) {
	if isTerminal() {
		logInfo("Stdin is tty, skipping pipe read")
		return "", nil
	}
	logInfo("Reading from stdin pipe...")
	data, err := io.ReadAll(stdinReader)
	if err != nil {
		return "", fmt.Errorf("read stdin: %w", err)
	}
	if len(data) == 0 {
		logInfo("Stdin pipe returned empty data")
		return "", nil
	}
	logInfo(fmt.Sprintf("Read %d bytes from stdin pipe", len(data)))
	return string(data), nil
}

func shouldUseStdin(taskText string, piped bool) bool {
	if piped {
		return true
	}
	if len(taskText) > 800 {
		return true
	}
	return strings.IndexAny(taskText, stdinSpecialChars) >= 0
}

func defaultIsTerminal() bool {
	fi, err := os.Stdin.Stat()
	if err != nil {
		return true
	}
	return (fi.Mode() & os.ModeCharDevice) != 0
}

func isTerminal() bool {
	return isTerminalFn()
}

// injectRoleFile processes ROLE_FILE: directives in task text
// Format: "ROLE_FILE: <path>" on a single line
// Replaces the line with the content of the specified file
func injectRoleFile(taskText string) (string, error) {
	// Match "ROLE_FILE: <path>" at the beginning of a line
	roleFilePattern := regexp.MustCompile(`(?m)^ROLE_FILE:\s*(.+)$`)

	result := roleFilePattern.ReplaceAllStringFunc(taskText, func(match string) string {
		// Extract file path
		submatches := roleFilePattern.FindStringSubmatch(match)
		if len(submatches) < 2 {
			logWarn(fmt.Sprintf("Invalid ROLE_FILE format: %s", match))
			return match
		}

		filePath := strings.TrimSpace(submatches[1])

		// Expand ~ to home directory
		if strings.HasPrefix(filePath, "~/") {
			home, err := os.UserHomeDir()
			if err != nil {
				logWarn(fmt.Sprintf("Failed to get home directory: %v", err))
				return match
			}
			filePath = filepath.Join(home, filePath[2:])
		}

		// Windows-specific: Convert Git Bash paths to native Windows paths
		// Only applies when running on Windows (isWindows() check)
		if isWindows() {
			filePath = normalizeWindowsPath(filePath)
		}

		// Read file content
		content, err := os.ReadFile(filePath)
		if err != nil {
			logWarn(fmt.Sprintf("Failed to read ROLE_FILE '%s': %v", filePath, err))
			return match // Keep original line if file read fails
		}

		logInfo(fmt.Sprintf("Injected ROLE_FILE: %s (%d bytes)", filePath, len(content)))
		return string(content)
	})

	return result, nil
}

// normalizeWindowsPath converts Git Bash-style paths to native Windows paths
// Only called when isWindows() returns true, ensuring macOS/Linux are unaffected
// Examples:
//   - /c/Users/foo -> C:/Users/foo
//   - C:\Users\foo -> C:/Users/foo (unchanged, already native)
//   - relative/path -> relative/path (unchanged)
func normalizeWindowsPath(path string) string {
	// First, convert all backslashes to forward slashes
	path = strings.ReplaceAll(path, "\\", "/")

	// Convert Git Bash-style paths (/c/Users/...) to Windows paths (C:/Users/...)
	// Pattern: /[a-z]/ at the beginning
	gitBashPattern := regexp.MustCompile(`^/([a-zA-Z])/`)
	if gitBashPattern.MatchString(path) {
		// Extract drive letter and convert to Windows format
		matches := gitBashPattern.FindStringSubmatch(path)
		if len(matches) >= 2 {
			driveLetter := strings.ToUpper(matches[1])
			path = driveLetter + ":" + path[2:] // /c/Users -> C:/Users
		}
	}

	return path
}

func getEnv(key, defaultValue string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultValue
}

type logWriter struct {
	prefix  string
	maxLen  int
	buf     bytes.Buffer
	dropped bool
}

func newLogWriter(prefix string, maxLen int) *logWriter {
	if maxLen <= 0 {
		maxLen = codexLogLineLimit
	}
	return &logWriter{prefix: prefix, maxLen: maxLen}
}

func (lw *logWriter) Write(p []byte) (int, error) {
	if lw == nil {
		return len(p), nil
	}
	total := len(p)
	for len(p) > 0 {
		if idx := bytes.IndexByte(p, '\n'); idx >= 0 {
			lw.writeLimited(p[:idx])
			lw.logLine(true)
			p = p[idx+1:]
			continue
		}
		lw.writeLimited(p)
		break
	}
	return total, nil
}

func (lw *logWriter) Flush() {
	if lw == nil || lw.buf.Len() == 0 {
		return
	}
	lw.logLine(false)
}

func (lw *logWriter) logLine(force bool) {
	if lw == nil {
		return
	}
	line := lw.buf.String()
	dropped := lw.dropped
	lw.dropped = false
	lw.buf.Reset()
	if line == "" && !force {
		return
	}
	if lw.maxLen > 0 {
		if dropped {
			if lw.maxLen > 3 {
				line = line[:min(len(line), lw.maxLen-3)] + "..."
			} else {
				line = line[:min(len(line), lw.maxLen)]
			}
		} else if len(line) > lw.maxLen {
			cutoff := lw.maxLen
			if cutoff > 3 {
				line = line[:cutoff-3] + "..."
			} else {
				line = line[:cutoff]
			}
		}
	}
	logInfo(lw.prefix + line)
}

func (lw *logWriter) writeLimited(p []byte) {
	if lw == nil || len(p) == 0 {
		return
	}
	if lw.maxLen <= 0 {
		lw.buf.Write(p)
		return
	}

	remaining := lw.maxLen - lw.buf.Len()
	if remaining <= 0 {
		lw.dropped = true
		return
	}
	if len(p) <= remaining {
		lw.buf.Write(p)
		return
	}
	lw.buf.Write(p[:remaining])
	lw.dropped = true
}

type tailBuffer struct {
	limit int
	data  []byte
}

func (b *tailBuffer) Write(p []byte) (int, error) {
	if b.limit <= 0 {
		return len(p), nil
	}

	if len(p) >= b.limit {
		b.data = append(b.data[:0], p[len(p)-b.limit:]...)
		return len(p), nil
	}

	total := len(b.data) + len(p)
	if total <= b.limit {
		b.data = append(b.data, p...)
		return len(p), nil
	}

	overflow := total - b.limit
	b.data = append(b.data[overflow:], p...)
	return len(p), nil
}

func (b *tailBuffer) String() string {
	return string(b.data)
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	if maxLen < 0 {
		return ""
	}
	return s[:maxLen] + "..."
}

// safeTruncate safely truncates string to maxLen, avoiding panic and UTF-8 corruption.
func safeTruncate(s string, maxLen int) string {
	if maxLen <= 0 || s == "" {
		return ""
	}

	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}

	if maxLen < 4 {
		return string(runes[:1])
	}

	cutoff := maxLen - 3
	if cutoff <= 0 {
		return string(runes[:1])
	}
	if len(runes) <= cutoff {
		return s
	}
	return string(runes[:cutoff]) + "..."
}

// sanitizeOutput removes ANSI escape sequences and control characters.
func sanitizeOutput(s string) string {
	var result strings.Builder
	inEscape := false
	for i := 0; i < len(s); i++ {
		if s[i] == '\x1b' && i+1 < len(s) && s[i+1] == '[' {
			inEscape = true
			i++ // skip '['
			continue
		}
		if inEscape {
			if (s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= 'a' && s[i] <= 'z') {
				inEscape = false
			}
			continue
		}
		// Keep printable chars and common whitespace.
		if s[i] >= 32 || s[i] == '\n' || s[i] == '\t' {
			result.WriteByte(s[i])
		}
	}
	return result.String()
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func hello() string {
	return "hello world"
}

func greet(name string) string {
	return "hello " + name
}

func farewell(name string) string {
	return "goodbye " + name
}

// extractMessageSummary extracts a brief summary from task output
// Returns first meaningful line or truncated content up to maxLen chars
func extractMessageSummary(message string, maxLen int) string {
	if message == "" || maxLen <= 0 {
		return ""
	}

	// Try to find a meaningful summary line
	lines := strings.Split(message, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		// Skip empty lines and common noise
		if line == "" || strings.HasPrefix(line, "```") || strings.HasPrefix(line, "---") {
			continue
		}
		// Found a meaningful line
		return safeTruncate(line, maxLen)
	}

	// Fallback: truncate entire message
	clean := strings.TrimSpace(message)
	return safeTruncate(clean, maxLen)
}

// extractCoverageFromLines extracts coverage from pre-split lines.
func extractCoverageFromLines(lines []string) string {
	if len(lines) == 0 {
		return ""
	}

	end := len(lines)
	for end > 0 && strings.TrimSpace(lines[end-1]) == "" {
		end--
	}

	if end == 1 {
		trimmed := strings.TrimSpace(lines[0])
		if strings.HasSuffix(trimmed, "%") {
			if num, err := strconv.ParseFloat(strings.TrimSuffix(trimmed, "%"), 64); err == nil && num >= 0 && num <= 100 {
				return trimmed
			}
		}
	}

	coverageKeywords := []string{"file", "stmt", "branch", "line", "coverage", "total"}

	for _, line := range lines[:end] {
		lower := strings.ToLower(line)

		hasKeyword := false
		tokens := strings.FieldsFunc(lower, func(r rune) bool { return r < 'a' || r > 'z' })
		for _, token := range tokens {
			for _, kw := range coverageKeywords {
				if strings.HasPrefix(token, kw) {
					hasKeyword = true
					break
				}
			}
			if hasKeyword {
				break
			}
		}
		if !hasKeyword {
			continue
		}
		if !strings.Contains(line, "%") {
			continue
		}

		// Extract percentage pattern: number followed by %
		for i := 0; i < len(line); i++ {
			if line[i] == '%' && i > 0 {
				// Walk back to find the number
				j := i - 1
				for j >= 0 && (line[j] == '.' || (line[j] >= '0' && line[j] <= '9')) {
					j--
				}
				if j < i-1 {
					numStr := line[j+1 : i]
					// Validate it's a reasonable percentage
					if num, err := strconv.ParseFloat(numStr, 64); err == nil && num >= 0 && num <= 100 {
						return numStr + "%"
					}
				}
			}
		}
	}

	return ""
}

// extractCoverage extracts coverage percentage from task output
// Supports common formats: "Coverage: 92%", "92% coverage", "coverage 92%", "TOTAL 92%"
func extractCoverage(message string) string {
	if message == "" {
		return ""
	}

	return extractCoverageFromLines(strings.Split(message, "\n"))
}

// extractCoverageNum extracts coverage as a numeric value for comparison
func extractCoverageNum(coverage string) float64 {
	if coverage == "" {
		return 0
	}
	// Remove % sign and parse
	numStr := strings.TrimSuffix(coverage, "%")
	if num, err := strconv.ParseFloat(numStr, 64); err == nil {
		return num
	}
	return 0
}

// extractFilesChangedFromLines extracts files from pre-split lines.
func extractFilesChangedFromLines(lines []string) []string {
	if len(lines) == 0 {
		return nil
	}

	var files []string
	seen := make(map[string]bool)
	exts := []string{".ts", ".tsx", ".js", ".jsx", ".go", ".py", ".rs", ".java", ".vue", ".css", ".scss", ".md", ".json", ".yaml", ".yml", ".toml"}

	for _, line := range lines {
		line = strings.TrimSpace(line)

		// Pattern 1: "Modified: path/to/file.ts" or "Created: path/to/file.ts"
		matchedPrefix := false
		for _, prefix := range []string{"Modified:", "Created:", "Updated:", "Edited:", "Wrote:", "Changed:"} {
			if strings.HasPrefix(line, prefix) {
				file := strings.TrimSpace(strings.TrimPrefix(line, prefix))
				file = strings.Trim(file, "`,\"'()[],:")
				file = strings.TrimPrefix(file, "@")
				if file != "" && !seen[file] {
					files = append(files, file)
					seen[file] = true
				}
				matchedPrefix = true
				break
			}
		}
		if matchedPrefix {
			continue
		}

		// Pattern 2: Tokens that look like file paths (allow root files, strip @ prefix).
		parts := strings.Fields(line)
		for _, part := range parts {
			part = strings.Trim(part, "`,\"'()[],:")
			part = strings.TrimPrefix(part, "@")
			for _, ext := range exts {
				if strings.HasSuffix(part, ext) && !seen[part] {
					files = append(files, part)
					seen[part] = true
					break
				}
			}
		}
	}

	// Limit to first 10 files to avoid bloat
	if len(files) > 10 {
		files = files[:10]
	}

	return files
}

// extractFilesChanged extracts list of changed files from task output
// Looks for common patterns like "Modified: file.ts", "Created: file.ts", file paths in output
func extractFilesChanged(message string) []string {
	if message == "" {
		return nil
	}

	return extractFilesChangedFromLines(strings.Split(message, "\n"))
}

// extractTestResultsFromLines extracts test results from pre-split lines.
func extractTestResultsFromLines(lines []string) (passed, failed int) {
	if len(lines) == 0 {
		return 0, 0
	}

	// Common patterns:
	// pytest: "12 passed, 2 failed"
	// jest: "Tests: 2 failed, 12 passed"
	// go: "ok ... 12 tests"

	for _, line := range lines {
		line = strings.ToLower(line)

		// Look for test result lines
		if !strings.Contains(line, "pass") && !strings.Contains(line, "fail") && !strings.Contains(line, "test") {
			continue
		}

		// Extract numbers near "passed" or "pass"
		if idx := strings.Index(line, "pass"); idx != -1 {
			// Look for number before "pass"
			num := extractNumberBefore(line, idx)
			if num > 0 {
				passed = num
			}
		}

		// Extract numbers near "failed" or "fail"
		if idx := strings.Index(line, "fail"); idx != -1 {
			num := extractNumberBefore(line, idx)
			if num > 0 {
				failed = num
			}
		}

		// go test style: "ok ... 12 tests"
		if passed == 0 {
			if idx := strings.Index(line, "test"); idx != -1 {
				num := extractNumberBefore(line, idx)
				if num > 0 {
					passed = num
				}
			}
		}

		// If we found both, stop
		if passed > 0 && failed > 0 {
			break
		}
	}

	return passed, failed
}

// extractTestResults extracts test pass/fail counts from task output
func extractTestResults(message string) (passed, failed int) {
	if message == "" {
		return 0, 0
	}

	return extractTestResultsFromLines(strings.Split(message, "\n"))
}

// extractNumberBefore extracts a number that appears before the given index
func extractNumberBefore(s string, idx int) int {
	if idx <= 0 {
		return 0
	}

	// Walk backwards to find digits
	end := idx - 1
	for end >= 0 && (s[end] == ' ' || s[end] == ':' || s[end] == ',') {
		end--
	}
	if end < 0 {
		return 0
	}

	start := end
	for start >= 0 && s[start] >= '0' && s[start] <= '9' {
		start--
	}
	start++

	if start > end {
		return 0
	}

	numStr := s[start : end+1]
	if num, err := strconv.Atoi(numStr); err == nil {
		return num
	}
	return 0
}

// extractKeyOutputFromLines extracts key output from pre-split lines.
func extractKeyOutputFromLines(lines []string, maxLen int) string {
	if len(lines) == 0 || maxLen <= 0 {
		return ""
	}

	// Priority 1: Look for explicit summary lines
	for _, line := range lines {
		line = strings.TrimSpace(line)
		lower := strings.ToLower(line)
		if strings.HasPrefix(lower, "summary:") || strings.HasPrefix(lower, "completed:") ||
			strings.HasPrefix(lower, "implemented:") || strings.HasPrefix(lower, "added:") ||
			strings.HasPrefix(lower, "created:") || strings.HasPrefix(lower, "fixed:") {
			content := line
			for _, prefix := range []string{"Summary:", "Completed:", "Implemented:", "Added:", "Created:", "Fixed:",
				"summary:", "completed:", "implemented:", "added:", "created:", "fixed:"} {
				content = strings.TrimPrefix(content, prefix)
			}
			content = strings.TrimSpace(content)
			if len(content) > 0 {
				return safeTruncate(content, maxLen)
			}
		}
	}

	// Priority 2: First meaningful line (skip noise)
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "```") || strings.HasPrefix(line, "---") ||
			strings.HasPrefix(line, "#") || strings.HasPrefix(line, "//") {
			continue
		}
		// Skip very short lines (likely headers or markers)
		if len(line) < 20 {
			continue
		}
		return safeTruncate(line, maxLen)
	}

	// Fallback: truncate entire message
	clean := strings.TrimSpace(strings.Join(lines, "\n"))
	return safeTruncate(clean, maxLen)
}

// extractKeyOutput extracts a brief summary of what the task accomplished
// Looks for summary lines, first meaningful sentence, or truncates message
func extractKeyOutput(message string, maxLen int) string {
	if message == "" || maxLen <= 0 {
		return ""
	}
	return extractKeyOutputFromLines(strings.Split(message, "\n"), maxLen)
}

// extractCoverageGap extracts what's missing from coverage reports
// Looks for uncovered lines, branches, or functions
func extractCoverageGap(message string) string {
	if message == "" {
		return ""
	}

	lower := strings.ToLower(message)
	lines := strings.Split(message, "\n")

	// Look for uncovered/missing patterns
	for _, line := range lines {
		lineLower := strings.ToLower(line)
		line = strings.TrimSpace(line)

		// Common patterns for uncovered code
		if strings.Contains(lineLower, "uncovered") ||
			strings.Contains(lineLower, "not covered") ||
			strings.Contains(lineLower, "missing coverage") ||
			strings.Contains(lineLower, "lines not covered") {
			if len(line) > 100 {
				return line[:97] + "..."
			}
			return line
		}

		// Look for specific file:line patterns in coverage reports
		if strings.Contains(lineLower, "branch") && strings.Contains(lineLower, "not taken") {
			if len(line) > 100 {
				return line[:97] + "..."
			}
			return line
		}
	}

	// Look for function names that aren't covered
	if strings.Contains(lower, "function") && strings.Contains(lower, "0%") {
		for _, line := range lines {
			if strings.Contains(strings.ToLower(line), "0%") && strings.Contains(line, "function") {
				line = strings.TrimSpace(line)
				if len(line) > 100 {
					return line[:97] + "..."
				}
				return line
			}
		}
	}

	return ""
}

// extractErrorDetail extracts meaningful error context from task output
// Returns the most relevant error information up to maxLen characters
func extractErrorDetail(message string, maxLen int) string {
	if message == "" || maxLen <= 0 {
		return ""
	}

	lines := strings.Split(message, "\n")
	var errorLines []string

	// Look for error-related lines
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		lower := strings.ToLower(line)

		// Skip noise lines
		if strings.HasPrefix(line, "at ") && strings.Contains(line, "(") {
			// Stack trace line - only keep first one
			if len(errorLines) > 0 && strings.HasPrefix(strings.ToLower(errorLines[len(errorLines)-1]), "at ") {
				continue
			}
		}

		// Prioritize error/fail lines
		if strings.Contains(lower, "error") ||
			strings.Contains(lower, "fail") ||
			strings.Contains(lower, "exception") ||
			strings.Contains(lower, "assert") ||
			strings.Contains(lower, "expected") ||
			strings.Contains(lower, "timeout") ||
			strings.Contains(lower, "not found") ||
			strings.Contains(lower, "cannot") ||
			strings.Contains(lower, "undefined") ||
			strings.HasPrefix(line, "FAIL") ||
			strings.HasPrefix(line, "●") {
			errorLines = append(errorLines, line)
		}
	}

	if len(errorLines) == 0 {
		// No specific error lines found, take last few lines
		start := len(lines) - 5
		if start < 0 {
			start = 0
		}
		for _, line := range lines[start:] {
			line = strings.TrimSpace(line)
			if line != "" {
				errorLines = append(errorLines, line)
			}
		}
	}

	// Join and truncate
	result := strings.Join(errorLines, " | ")
	return safeTruncate(result, maxLen)
}
