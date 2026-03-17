package main

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	minimaxAPIURL         = "https://api.minimax.io/v1/chat/completions"
	minimaxDefaultTemp    = 0.7
	minimaxRequestTimeout = 300 * time.Second
)

// runMinimaxAPIMode handles the --minimax-api subcommand.
// It calls the MiniMax API directly and outputs Gemini-compatible stream-json
// so the existing parser can consume it without modification.
func runMinimaxAPIMode(args []string) int {
	model := defaultMinimaxModel
	var taskText string
	readStdin := false

	for i := 0; i < len(args); i++ {
		switch {
		case args[i] == "-m" || args[i] == "--model":
			if i+1 < len(args) {
				model = args[i+1]
				i++
			}
		case args[i] == "-p" || args[i] == "--prompt":
			if i+1 < len(args) {
				v := args[i+1]
				i++
				if v == "-" {
					readStdin = true
				} else {
					taskText = v
				}
			}
		case args[i] == "-":
			readStdin = true
		}
	}

	if readStdin {
		data, err := io.ReadAll(os.Stdin)
		if err != nil {
			fmt.Fprintf(os.Stderr, "minimax-api: failed to read stdin: %v\n", err)
			return 1
		}
		taskText = string(data)
	}

	if strings.TrimSpace(taskText) == "" {
		fmt.Fprintln(os.Stderr, "minimax-api: no task provided")
		return 1
	}

	apiKey := os.Getenv("MINIMAX_API_KEY")
	if apiKey == "" {
		fmt.Fprintln(os.Stderr, "minimax-api: MINIMAX_API_KEY environment variable not set")
		return 1
	}

	return callMinimaxAPI(apiKey, model, taskText)
}

// callMinimaxAPI sends a streaming chat completion request to MiniMax
// and outputs Gemini-compatible stream-json events to stdout.
func callMinimaxAPI(apiKey, model, task string) int {
	// Generate a unique session ID
	randBytes := make([]byte, 8)
	_, _ = rand.Read(randBytes)
	sessionID := fmt.Sprintf("minimax-%s", hex.EncodeToString(randBytes))

	// Emit init event
	emitEvent(map[string]interface{}{
		"type":       "init",
		"session_id": sessionID,
	})

	// Build request body
	body := map[string]interface{}{
		"model": model,
		"messages": []map[string]string{
			{"role": "user", "content": task},
		},
		"stream":      true,
		"temperature": minimaxDefaultTemp,
	}

	bodyBytes, err := json.Marshal(body)
	if err != nil {
		fmt.Fprintf(os.Stderr, "minimax-api: failed to marshal request: %v\n", err)
		return 1
	}

	req, err := http.NewRequest("POST", minimaxAPIURL, strings.NewReader(string(bodyBytes)))
	if err != nil {
		fmt.Fprintf(os.Stderr, "minimax-api: failed to create request: %v\n", err)
		return 1
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: minimaxRequestTimeout}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Fprintf(os.Stderr, "minimax-api: request failed: %v\n", err)
		return 1
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		fmt.Fprintf(os.Stderr, "minimax-api: API error %d: %s\n", resp.StatusCode, string(respBody))
		return 1
	}

	// Parse SSE stream and emit Gemini-compatible events
	scanner := bufio.NewScanner(resp.Body)
	// Allow large SSE lines (up to 1MB)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}

		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}

		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}

		if len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
			content := chunk.Choices[0].Delta.Content
			delta := true
			emitEvent(map[string]interface{}{
				"type":    "content",
				"role":    "model",
				"content": content,
				"delta":   delta,
			})
		}
	}

	// Emit result event
	emitEvent(map[string]interface{}{
		"type":       "result",
		"status":     "success",
		"session_id": sessionID,
	})

	return 0
}

// emitEvent writes a JSON event to stdout (one line per event).
func emitEvent(event map[string]interface{}) {
	data, err := json.Marshal(event)
	if err != nil {
		return
	}
	fmt.Println(string(data))
}
