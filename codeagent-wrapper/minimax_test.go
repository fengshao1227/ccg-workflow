package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
)

// ───────────────────────────────────────────────────────────
// MinimaxBackend unit tests
// ───────────────────────────────────────────────────────────

func TestMinimaxBackendMetadata(t *testing.T) {
	backend := MinimaxBackend{}

	if got := backend.Name(); got != "minimax" {
		t.Fatalf("Name() = %q, want %q", got, "minimax")
	}

	cmd := backend.Command()
	if cmd == "" {
		t.Fatalf("Command() returned empty string")
	}
}

func TestMinimaxBackendBuildArgs(t *testing.T) {
	backend := MinimaxBackend{}

	t.Run("default model when empty", func(t *testing.T) {
		cfg := &Config{Mode: "new", WorkDir: "/repo"}
		got := backend.BuildArgs(cfg, "test task")
		want := []string{"--minimax-api", "-m", defaultMinimaxModel, "-p", "test task"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("custom model", func(t *testing.T) {
		cfg := &Config{Mode: "new", MinimaxModel: "MiniMax-M2.5-highspeed"}
		got := backend.BuildArgs(cfg, "-")
		want := []string{"--minimax-api", "-m", "MiniMax-M2.5-highspeed", "-p", "-"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})

	t.Run("nil config returns nil", func(t *testing.T) {
		if backend.BuildArgs(nil, "ignored") != nil {
			t.Fatalf("nil config should return nil args")
		}
	})
}

func TestSelectMinimaxBackend(t *testing.T) {
	backend, err := selectBackend("minimax")
	if err != nil {
		t.Fatalf("selectBackend(minimax) error = %v", err)
	}
	if backend.Name() != "minimax" {
		t.Errorf("expected name minimax, got %s", backend.Name())
	}
}

func TestSelectMinimaxBackendCaseInsensitive(t *testing.T) {
	backend, err := selectBackend("MINIMAX")
	if err != nil {
		t.Fatalf("selectBackend(MINIMAX) error = %v", err)
	}
	if backend.Name() != "minimax" {
		t.Errorf("expected name minimax, got %s", backend.Name())
	}
}

// ───────────────────────────────────────────────────────────
// Config parsing tests for --minimax-model
// ───────────────────────────────────────────────────────────

func TestParseArgsMinimaxModel(t *testing.T) {
	t.Run("--minimax-model flag", func(t *testing.T) {
		os.Args = []string{"wrapper", "--minimax-model", "MiniMax-M2.5-highspeed", "--backend", "minimax", "task"}
		cfg, err := parseArgs()
		if err != nil {
			t.Fatalf("parseArgs() error = %v", err)
		}
		if cfg.MinimaxModel != "MiniMax-M2.5-highspeed" {
			t.Fatalf("MinimaxModel = %q, want %q", cfg.MinimaxModel, "MiniMax-M2.5-highspeed")
		}
		if cfg.Backend != "minimax" {
			t.Fatalf("Backend = %q, want %q", cfg.Backend, "minimax")
		}
	})

	t.Run("--minimax-model= format", func(t *testing.T) {
		os.Args = []string{"wrapper", "--minimax-model=MiniMax-M2.5", "task"}
		cfg, err := parseArgs()
		if err != nil {
			t.Fatalf("parseArgs() error = %v", err)
		}
		if cfg.MinimaxModel != "MiniMax-M2.5" {
			t.Fatalf("MinimaxModel = %q, want %q", cfg.MinimaxModel, "MiniMax-M2.5")
		}
	})

	t.Run("MINIMAX_MODEL env var", func(t *testing.T) {
		t.Setenv("MINIMAX_MODEL", "MiniMax-M2.5-highspeed")
		os.Args = []string{"wrapper", "task"}
		cfg, err := parseArgs()
		if err != nil {
			t.Fatalf("parseArgs() error = %v", err)
		}
		if cfg.MinimaxModel != "MiniMax-M2.5-highspeed" {
			t.Fatalf("MinimaxModel = %q, want %q", cfg.MinimaxModel, "MiniMax-M2.5-highspeed")
		}
	})

	t.Run("CLI flag overrides env var", func(t *testing.T) {
		t.Setenv("MINIMAX_MODEL", "from-env")
		os.Args = []string{"wrapper", "--minimax-model", "from-cli", "task"}
		cfg, err := parseArgs()
		if err != nil {
			t.Fatalf("parseArgs() error = %v", err)
		}
		if cfg.MinimaxModel != "from-cli" {
			t.Fatalf("MinimaxModel = %q, want %q", cfg.MinimaxModel, "from-cli")
		}
	})

	t.Run("--minimax-model without value errors", func(t *testing.T) {
		os.Args = []string{"wrapper", "--minimax-model"}
		_, err := parseArgs()
		if err == nil {
			t.Fatalf("expected error for --minimax-model without value")
		}
	})

	t.Run("--minimax-model= empty value errors", func(t *testing.T) {
		os.Args = []string{"wrapper", "--minimax-model=", "task"}
		_, err := parseArgs()
		if err == nil {
			t.Fatalf("expected error for --minimax-model= with empty value")
		}
	})
}

// ───────────────────────────────────────────────────────────
// MiniMax API mode tests (with mock HTTP server)
// ───────────────────────────────────────────────────────────

func TestRunMinimaxAPIMode_MissingAPIKey(t *testing.T) {
	t.Setenv("MINIMAX_API_KEY", "")
	code := runMinimaxAPIMode([]string{"-p", "hello"})
	if code != 1 {
		t.Fatalf("expected exit code 1, got %d", code)
	}
}

func TestRunMinimaxAPIMode_EmptyTask(t *testing.T) {
	t.Setenv("MINIMAX_API_KEY", "test-key")
	code := runMinimaxAPIMode([]string{})
	if code != 1 {
		t.Fatalf("expected exit code 1, got %d", code)
	}
}

func TestCallMinimaxAPI_MockServerResponseFormat(t *testing.T) {
	// Create a mock server that returns SSE streaming response
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Verify request method and content type
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}

		// Verify request body
		body, _ := io.ReadAll(r.Body)
		var reqBody map[string]interface{}
		if err := json.Unmarshal(body, &reqBody); err != nil {
			t.Errorf("failed to parse request body: %v", err)
		}
		if reqBody["model"] != "MiniMax-M2.5" {
			t.Errorf("expected model MiniMax-M2.5, got %v", reqBody["model"])
		}
		if reqBody["stream"] != true {
			t.Errorf("expected stream=true, got %v", reqBody["stream"])
		}

		// Send SSE response
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(200)

		chunks := []string{
			`data: {"choices":[{"delta":{"content":"Hello"}}]}`,
			`data: {"choices":[{"delta":{"content":" world"}}]}`,
			`data: [DONE]`,
		}
		for _, chunk := range chunks {
			fmt.Fprintln(w, chunk)
			fmt.Fprintln(w) // empty line between SSE events
		}
	}))
	defer server.Close()

	// Test the mock server response parsing directly
	reqBody := `{"model":"MiniMax-M2.5","messages":[{"role":"user","content":"test"}],"stream":true}`
	req, _ := http.NewRequest("POST", server.URL, strings.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer test-key")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	bodyStr := string(body)

	// Verify the mock returns expected SSE format
	if !strings.Contains(bodyStr, `"content":"Hello"`) {
		t.Errorf("expected Hello in response, got: %s", bodyStr)
	}
	if !strings.Contains(bodyStr, `"content":" world"`) {
		t.Errorf("expected world in response, got: %s", bodyStr)
	}
	if !strings.Contains(bodyStr, "[DONE]") {
		t.Errorf("expected [DONE] in response, got: %s", bodyStr)
	}
}

func TestEmitEvent(t *testing.T) {
	// Capture stdout
	oldStdout := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	emitEvent(map[string]interface{}{
		"type":       "init",
		"session_id": "test-session",
	})

	_ = w.Close()
	os.Stdout = oldStdout

	output, _ := io.ReadAll(r)
	outputStr := strings.TrimSpace(string(output))

	var event map[string]interface{}
	if err := json.Unmarshal([]byte(outputStr), &event); err != nil {
		t.Fatalf("failed to parse emitted event: %v", err)
	}

	if event["type"] != "init" {
		t.Errorf("expected type=init, got %v", event["type"])
	}
	if event["session_id"] != "test-session" {
		t.Errorf("expected session_id=test-session, got %v", event["session_id"])
	}
}

// ───────────────────────────────────────────────────────────
// Parser integration: Gemini-compatible output from MiniMax
// ───────────────────────────────────────────────────────────

func TestParserHandlesMinimaxOutput(t *testing.T) {
	// Simulate the Gemini-compatible stream-json output that MiniMax backend emits
	events := []string{
		`{"type":"init","session_id":"minimax-abc123"}`,
		`{"type":"content","role":"model","content":"Hello ","delta":true}`,
		`{"type":"content","role":"model","content":"from MiniMax!","delta":true}`,
		`{"type":"result","status":"success","session_id":"minimax-abc123"}`,
	}

	input := strings.Join(events, "\n") + "\n"
	reader := strings.NewReader(input)

	message, threadID := parseJSONStream(reader)

	if message != "Hello from MiniMax!" {
		t.Errorf("expected message 'Hello from MiniMax!', got %q", message)
	}
	if threadID != "minimax-abc123" {
		t.Errorf("expected threadID 'minimax-abc123', got %q", threadID)
	}
}

func TestParserHandlesMinimaxEmptyContent(t *testing.T) {
	events := []string{
		`{"type":"init","session_id":"minimax-test"}`,
		`{"type":"content","role":"model","content":"","delta":true}`,
		`{"type":"content","role":"model","content":"data","delta":true}`,
		`{"type":"result","status":"success","session_id":"minimax-test"}`,
	}

	input := strings.Join(events, "\n") + "\n"
	reader := strings.NewReader(input)

	message, _ := parseJSONStream(reader)

	if message != "data" {
		t.Errorf("expected message 'data', got %q", message)
	}
}
