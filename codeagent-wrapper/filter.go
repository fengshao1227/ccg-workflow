package main

import (
	"bytes"
	"io"
	"strings"
)

// noisePatterns contains stderr patterns to filter for all backends
var noisePatterns = []string{
	// Gemini specific
	"[STARTUP]",
	"Session cleanup disabled",
	"Warning:",
	"(node:",
	"(Use `node --trace-warnings",
	"Loaded cached credentials",
	"Loading extension:",
	"YOLO mode is enabled",
	// Common noise
	"[WARN] Skipping unreadable directory",
	"supports tool updates. Listening for changes",
}

// filteringWriter wraps an io.Writer and filters out lines matching patterns
type filteringWriter struct {
	w        io.Writer
	patterns []string
	buf      bytes.Buffer
}

func newFilteringWriter(w io.Writer, patterns []string) *filteringWriter {
	return &filteringWriter{w: w, patterns: patterns}
}

func (f *filteringWriter) Write(p []byte) (n int, err error) {
	f.buf.Write(p)
	for {
		line, err := f.buf.ReadString('\n')
		if err != nil {
			// incomplete line, put it back
			f.buf.WriteString(line)
			break
		}
		if !f.shouldFilter(line) {
			f.w.Write([]byte(line))
		}
	}
	return len(p), nil
}

func (f *filteringWriter) shouldFilter(line string) bool {
	for _, pattern := range f.patterns {
		if strings.Contains(line, pattern) {
			return true
		}
	}
	return false
}

// Flush writes any remaining buffered content
func (f *filteringWriter) Flush() {
	if f.buf.Len() > 0 {
		remaining := f.buf.String()
		if !f.shouldFilter(remaining) {
			f.w.Write([]byte(remaining))
		}
		f.buf.Reset()
	}
}
