package main

import (
	"os"
	"strings"
	"testing"
)

func TestBackendParseJSONStream_UnknownEventsAreSilent(t *testing.T) {
	input := strings.Join([]string{
		`{"type":"turn.started"}`,
		`{"type":"assistant","text":"hi"}`,
		`{"type":"user","text":"yo"}`,
		`{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}`,
	}, "\n")

	var infos []string
	infoFn := func(msg string) { infos = append(infos, msg) }

	message, threadID := parseJSONStreamInternal(strings.NewReader(input), nil, infoFn, nil, nil)
	if message != "ok" {
		t.Fatalf("message=%q, want %q (infos=%v)", message, "ok", infos)
	}
	if threadID != "" {
		t.Fatalf("threadID=%q, want empty (infos=%v)", threadID, infos)
	}

	for _, msg := range infos {
		if strings.Contains(msg, "Agent event:") {
			t.Fatalf("unexpected log for unknown event: %q", msg)
		}
	}
}

func TestParseJSONStreamInternalWithContent_EmitsProgressLines(t *testing.T) {
	input := strings.Join([]string{
		`{"type":"thread.started","thread_id":"tid-123"}`,
		`{"type":"turn.started"}`,
		`{"type":"item.completed","item":{"type":"reasoning","text":"Checking files and APIs"}}`,
		`{"type":"item.completed","item":{"type":"mcp_tool_call"}}`,
		`{"type":"item.completed","item":{"type":"command_execution","command":"echo hi","aggregated_output":"hi\n","exit_code":0}}`,
		`{"type":"item.completed","item":{"type":"agent_message","text":"Done with changes"}}`,
		`{"type":"turn.completed","thread_id":"tid-123"}`,
	}, "\n")

	var progress []string
	message, threadID := parseJSONStreamInternalWithContent(
		strings.NewReader(input),
		nil,
		func(string) {},
		nil,
		nil,
		nil,
		func(line string) { progress = append(progress, line) },
	)

	if message != "Done with changes" {
		t.Fatalf("message=%q, want %q", message, "Done with changes")
	}
	if threadID != "tid-123" {
		t.Fatalf("threadID=%q, want %q", threadID, "tid-123")
	}

	joined := strings.Join(progress, "\n")
	for _, want := range []string{
		"[PROGRESS] session_started id=tid-123",
		"[PROGRESS] turn_started",
		"[PROGRESS] reasoning text=\"Checking files and APIs\"",
		"[PROGRESS] mcp_call",
		"[PROGRESS] cmd_done cmd=\"echo hi\" exit=0",
		"[PROGRESS] message text=\"Done with changes\"",
		"[PROGRESS] turn_completed total_events=7",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("missing progress %q in %q", want, joined)
		}
	}
}

func TestSafeProgressSnippet_UsesRuneSafeTruncation(t *testing.T) {
	got := safeProgressSnippet("中文测试进度输出", 5)
	if got != "中文..." {
		t.Fatalf("got %q, want %q", got, "中文...")
	}

	got = safeProgressSnippet("中文", 2)
	if got != "中文" {
		t.Fatalf("got %q, want %q", got, "中文")
	}
}

func TestFormatProgressLine_HandlesNilFields(t *testing.T) {
	if got := formatProgressLine("turn_started", nil); got != "turn_started" {
		t.Fatalf("got %q, want %q", got, "turn_started")
	}
}

func TestParseArgs_ParsesProgressFlag(t *testing.T) {
	oldArgs := os.Args
	defer func() { os.Args = oldArgs }()

	os.Args = []string{"codeagent-wrapper", "--progress", "task body", "/tmp/work"}
	cfg, err := parseArgs()
	if err != nil {
		t.Fatalf("parseArgs error: %v", err)
	}
	if !cfg.Progress {
		t.Fatalf("expected Progress=true")
	}
	if cfg.Task != "task body" || cfg.WorkDir != "/tmp/work" {
		t.Fatalf("unexpected cfg: %+v", cfg)
	}
}

