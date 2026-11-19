package main

import (
	"strings"
	"testing"
)

const agyStreamSample = `{"event":"init","conversation_id":"602e61bb-d2a0","init":{"cwd":"/tmp/project"}}
{"event":"step_update","step_update":{"conversation_id":"602e61bb-d2a0","step_index":0,"state":"DONE","step_type":"user_input"}}
{"event":"step_update","step_update":{"conversation_id":"602e61bb-d2a0","step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"Found "}}
{"event":"step_update","step_update":{"conversation_id":"602e61bb-d2a0","step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"3 bugs."}}
{"event":"step_update","step_update":{"conversation_id":"602e61bb-d2a0","step_index":1,"state":"DONE","step_type":"agent_response","text_delta":"\n"}}
{"event":"result","result":{"conversation_id":"602e61bb-d2a0","status":"SUCCESS","response":"Found 3 bugs.\n","num_turns":1}}
`

func TestAntigravityBuildArgs_UsesStreamJSON(t *testing.T) {
	t.Setenv("CODEAGENT_AGY_SETTINGS", "")
	cfg := &Config{Mode: "new", WorkDir: "/tmp/project", Backend: "antigravity"}
	args := buildAntigravityArgs(cfg, "do the task")

	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "--output-format stream-json") {
		t.Fatalf("args missing stream-json output format: %v", args)
	}
	if strings.Contains(joined, "--dangerously-skip-permissions") {
		t.Fatalf("args must not skip permissions by default: %v", args)
	}
	if strings.Contains(joined, "--settings") {
		t.Fatalf("no --settings expected without CODEAGENT_AGY_SETTINGS: %v", args)
	}
	if n := len(args); n < 2 || args[n-2] != "-p" || args[n-1] != "do the task" {
		t.Fatalf("-p with task text must be the last args: %v", args)
	}
}

func TestAntigravityBuildArgs_ResumeMode(t *testing.T) {
	cfg := &Config{Mode: "resume", SessionID: "conv-123", WorkDir: "/tmp/project", Backend: "antigravity"}
	joined := strings.Join(buildAntigravityArgs(cfg, "continue"), " ")

	for _, want := range []string{"--conversation conv-123", "--output-format stream-json"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("resume args missing %q: %s", want, joined)
		}
	}
}

func TestAntigravityBuildArgs_SessionSettingsFromEnv(t *testing.T) {
	t.Setenv("CODEAGENT_AGY_SETTINGS", "/home/u/agy-ccg.json")
	cfg := &Config{Mode: "new", WorkDir: "/tmp/project", Backend: "antigravity"}
	args := buildAntigravityArgs(cfg, "task")

	if joined := strings.Join(args, " "); !strings.Contains(joined, "--settings /home/u/agy-ccg.json") {
		t.Fatalf("args missing --settings <file>: %s", joined)
	}
	if n := len(args); args[n-2] != "-p" || args[n-1] != "task" {
		t.Fatalf("-p with task text must stay last: %v", args)
	}
}

func TestParseAntigravityStream_MessageOnceAndStreamedText(t *testing.T) {
	var text []string
	msg, id, failure := parseAntigravityStream(strings.NewReader(agyStreamSample), agyStreamHandlers{
		onText: func(s string) { text = append(text, s) },
	})

	if id != "602e61bb-d2a0" {
		t.Fatalf("conversation id = %q", id)
	}
	if msg != "Found 3 bugs." {
		t.Fatalf("message = %q, want the result response exactly once", msg)
	}
	if failure != "" {
		t.Fatalf("failure = %q on a successful turn", failure)
	}
	if got := strings.Join(text, ""); got != "Found 3 bugs.\n" {
		t.Fatalf("streamed text = %q", got)
	}
}

// The ID has to come out before the turn ends: that is what lets a caller
// resume a task that later times out.
func TestParseAntigravityStream_ReportsSessionBeforeAnyText(t *testing.T) {
	var order []string
	_, _, _ = parseAntigravityStream(strings.NewReader(agyStreamSample), agyStreamHandlers{
		onSession: func(id string) { order = append(order, "session:"+id) },
		onText:    func(string) { order = append(order, "text") },
	})

	if len(order) < 2 || order[0] != "session:602e61bb-d2a0" {
		t.Fatalf("event order = %v, want the session first", order)
	}
	if got := strings.Count(strings.Join(order, ","), "session:"); got != 1 {
		t.Fatalf("session reported %d times, want once: %v", got, order)
	}
}

func TestParseAntigravityStream_ProgressIsWholeLines(t *testing.T) {
	in := `{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"first "}}
{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"line\n\nsecond"}}
{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":" line"}}
`
	var lines []string
	_, _, _ = parseAntigravityStream(strings.NewReader(in), agyStreamHandlers{
		onLine: func(s string) { lines = append(lines, s) },
	})

	if got := strings.Join(lines, "|"); got != "first line|second line" {
		t.Fatalf("progress lines = %q", got)
	}
}

func TestParseAntigravityStream_FallsBackToDeltasWithoutResult(t *testing.T) {
	// A denied tool can end the turn before a result event; keep what was said.
	in := `{"event":"init","conversation_id":"c-1"}
{"event":"step_update","step_update":{"conversation_id":"c-1","step_type":"agent_response","text_delta":"partial review"}}
`
	msg, id, _ := parseAntigravityStream(strings.NewReader(in), agyStreamHandlers{})
	if id != "c-1" || msg != "partial review" {
		t.Fatalf("got (%q, %q), want (partial review, c-1)", msg, id)
	}
}

func TestParseAntigravityStream_ReportsFailure(t *testing.T) {
	// Captured from agy 1.4.2 with no login.
	in := `{"event":"result","result":{"conversation_id":"","status":"ERROR","response":"","error":"authentication failed or timed out","num_turns":0}}
`
	msg, id, failure := parseAntigravityStream(strings.NewReader(in), agyStreamHandlers{})
	if msg != "" || id != "" {
		t.Fatalf("got (%q, %q), want nothing", msg, id)
	}
	if failure != "authentication failed or timed out" {
		t.Fatalf("failure = %q", failure)
	}
}

func TestParseAntigravityStream_ReportsDeniedActions(t *testing.T) {
	// Captured from agy 1.5.10: read_file outside the workspace, no skip flag.
	in := `{"event":"result","result":{"conversation_id":"c-2","status":"SUCCESS","response":"","num_turns":1,"denied_actions":[{"action":"read_file","display_name":"ReadFile"}]}}
`
	msg, _, failure := parseAntigravityStream(strings.NewReader(in), agyStreamHandlers{})
	if msg != "" {
		t.Fatalf("message = %q, want empty", msg)
	}
	if !strings.HasPrefix(failure, "permission denied in headless mode: read_file") {
		t.Fatalf("failure = %q", failure)
	}
}

func TestAgyFailure(t *testing.T) {
	cases := []struct{ status, errText, want string }{
		{"SUCCESS", "", ""},
		{"success", "", ""},
		{"", "", ""},
		{"ERROR", "", "status ERROR"},
		{"ERROR", "boom", "boom"},
	}
	for _, c := range cases {
		if got := agyFailure(c.status, c.errText); got != c.want {
			t.Fatalf("agyFailure(%q, %q) = %q, want %q", c.status, c.errText, got, c.want)
		}
	}
}

func TestParseAntigravityStream_KeepsStrayLines(t *testing.T) {
	msg, id, _ := parseAntigravityStream(strings.NewReader("line one\nline two\n"), agyStreamHandlers{})
	if id != "" || msg != "line one\nline two" {
		t.Fatalf("got (%q, %q), want the lines and no id", msg, id)
	}
}
