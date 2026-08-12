package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
)

// JSONEvent represents a Codex JSON output event
type JSONEvent struct {
	Type     string     `json:"type"`
	ThreadID string     `json:"thread_id,omitempty"`
	Item     *EventItem `json:"item,omitempty"`
}

// EventItem represents the item field in a JSON event
type EventItem struct {
	Type string      `json:"type"`
	Text interface{} `json:"text"`
}

// ClaudeEvent for Claude stream-json format
type ClaudeEvent struct {
	Type      string `json:"type"`
	Subtype   string `json:"subtype,omitempty"`
	SessionID string `json:"session_id,omitempty"`
	Result    string `json:"result,omitempty"`
}

// GeminiEvent for Gemini stream-json format
type GeminiEvent struct {
	Type      string `json:"type"`
	SessionID string `json:"session_id,omitempty"`
	Role      string `json:"role,omitempty"`
	Content   string `json:"content,omitempty"`
	Delta     bool   `json:"delta,omitempty"`
	Status    string `json:"status,omitempty"`
}

func parseJSONStream(r io.Reader) (message, threadID string) {
	return parseJSONStreamWithLog(r, logWarn, logInfo)
}

func parseJSONStreamWithWarn(r io.Reader, warnFn func(string)) (message, threadID string) {
	return parseJSONStreamWithLog(r, warnFn, logInfo)
}

func parseJSONStreamWithLog(r io.Reader, warnFn func(string), infoFn func(string)) (message, threadID string) {
	return parseJSONStreamInternal(r, warnFn, infoFn, nil, nil)
}

const (
	jsonLineReaderSize   = 64 * 1024
	jsonLineMaxBytes     = 10 * 1024 * 1024
	jsonLinePreviewBytes = 256
)

type codexHeader struct {
	Type     string `json:"type"`
	ThreadID string `json:"thread_id,omitempty"`
	Item     *struct {
		Type string `json:"type"`
	} `json:"item,omitempty"`
}

// UnifiedEvent combines all backend event formats into a single structure
// to avoid multiple JSON unmarshal operations per event
type UnifiedEvent struct {
	// Common fields
	Type string `json:"type"`

	// Codex-specific fields
	ThreadID string          `json:"thread_id,omitempty"`
	Item     json.RawMessage `json:"item,omitempty"` // Lazy parse

	// Claude-specific fields
	Subtype   string `json:"subtype,omitempty"`
	SessionID string `json:"session_id,omitempty"`
	Result    string `json:"result,omitempty"`

	// Gemini-specific fields
	// Gemini CLI uses camelCase "sessionId" instead of snake_case "session_id"
	SessionIDCamel string `json:"sessionId,omitempty"`
	Role           string `json:"role,omitempty"`
	Content        string `json:"content,omitempty"`
	Delta          *bool  `json:"delta,omitempty"`
	Status         string `json:"status,omitempty"`

	// Grok-specific fields (grok --output-format streaming-json):
	//   {"type":"thought","data":"..."}  — reasoning token deltas
	//   {"type":"text","data":"..."}     — response token deltas
	//   {"type":"end","stopReason":"EndTurn","sessionId":"...","requestId":"..."}
	Data       string `json:"data,omitempty"`
	StopReason string `json:"stopReason,omitempty"`

	// Kimi Code CLI (kimi -p --output-format stream-json) emits OpenAI-shaped
	// chat messages plus meta lines:
	//   {"role":"meta","type":"system.version","version":"0.35.0"}
	//   {"role":"meta","type":"session.resume_hint","session_id":"...","content":"..."}
	//   {"role":"assistant","content":"..."}
	//   {"role":"tool","tool_call_id":"...","content":"..."}
	// Note it reuses "role" and "content", which Gemini also uses — detection
	// keys off role=="meta" and the absence of Gemini's mandatory "type".
	ToolCallID string `json:"tool_call_id,omitempty"`

	// Opencode (opencode run --format json) wraps content in a "part" object and
	// spells its session key "sessionID" — capital D, distinct from Gemini's
	// "sessionId", so the two never collide.
	OpencodeSessionID string          `json:"sessionID,omitempty"`
	Part              json.RawMessage `json:"part,omitempty"`
}

// OpencodePart is the lazily-parsed `part` payload of an opencode event.
type OpencodePart struct {
	Type   string `json:"type"`
	Text   string `json:"text,omitempty"`
	Reason string `json:"reason,omitempty"`
}

// GetSessionID returns the session ID from either snake_case or camelCase field.
// Gemini CLI uses "sessionId" (camelCase), Claude/Codex use "session_id" (snake_case).
func (e *UnifiedEvent) GetSessionID() string {
	if e.SessionID != "" {
		return e.SessionID
	}
	return e.SessionIDCamel
}

// ItemContent represents the parsed item.text field for Codex events
type ItemContent struct {
	Type string      `json:"type"`
	Text interface{} `json:"text"`
}

func parseJSONStreamInternal(r io.Reader, warnFn func(string), infoFn func(string), onMessage func(), onComplete func()) (message, threadID string) {
	return parseJSONStreamInternalWithContent(r, warnFn, infoFn, onMessage, onComplete, nil, nil, nil)
}

func parseJSONStreamInternalWithContent(r io.Reader, warnFn func(string), infoFn func(string), onMessage func(), onComplete func(), onContent func(content, contentType string), onProgress func(line string), onSessionStarted func(id string)) (message, threadID string) {
	reader := bufio.NewReaderSize(r, jsonLineReaderSize)

	if warnFn == nil {
		warnFn = func(string) {}
	}
	if infoFn == nil {
		infoFn = func(string) {}
	}

	notifyMessage := func() {
		if onMessage != nil {
			onMessage()
		}
	}

	notifyComplete := func() {
		if onComplete != nil {
			onComplete()
		}
	}

	emitProgress := func(line string) {
		if onProgress == nil || strings.TrimSpace(line) == "" {
			return
		}
		onProgress("[PROGRESS] " + line)
	}

	totalEvents := 0

	var (
		codexMessage   string
		claudeMessage  string
		geminiBuffer   strings.Builder
		grokBuffer     strings.Builder
		kimiBuffer     strings.Builder
		opencodeBuffer strings.Builder
	)

	for {
		line, tooLong, err := readLineWithLimit(reader, jsonLineMaxBytes, jsonLinePreviewBytes)
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			warnFn("Read stdout error: " + err.Error())
			break
		}

		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}
		totalEvents++

		if tooLong {
			warnFn(fmt.Sprintf("Skipped overlong JSON line (> %d bytes): %s", jsonLineMaxBytes, truncateBytes(line, 100)))
			continue
		}

		// Single unmarshal for all backend types
		var event UnifiedEvent
		if err := json.Unmarshal(line, &event); err != nil {
			// Gemini CLI sometimes prepends non-JSON text to the init event line
			// e.g. "MCP issues detected. Run /mcp list for status.{"type":"init",...}"
			// Try to extract JSON from the first '{' character
			if idx := bytes.IndexByte(line, '{'); idx > 0 {
				if err2 := json.Unmarshal(line[idx:], &event); err2 == nil {
					goto parsed
				}
			}
			warnFn(fmt.Sprintf("Failed to parse event: %s", truncateBytes(line, 100)))
			continue
		}
	parsed:

		// Extract session_id early (works for all backends)
		if event.GetSessionID() != "" && threadID == "" {
			threadID = event.GetSessionID()
			if onSessionStarted != nil {
				onSessionStarted(threadID)
			}
		}

		// Detect backend type by field presence
		isCodex := event.ThreadID != "" || event.Type == "turn.completed" || event.Type == "turn.started"
		if !isCodex && len(event.Item) > 0 {
			var itemHeader struct {
				Type string `json:"type"`
			}
			if json.Unmarshal(event.Item, &itemHeader) == nil && itemHeader.Type != "" {
				isCodex = true
			}
		}
		isClaude := event.Subtype != "" || event.Result != ""
		if !isClaude && event.Type == "result" && event.GetSessionID() != "" && event.Status == "" {
			isClaude = true
		}
		// Opencode is the most specific shape: its own sessionID key plus a
		// nested part object.
		isOpencode := event.OpencodeSessionID != "" && len(event.Part) > 0

		// Kimi must be classified before Gemini: both carry "role"/"content",
		// but Gemini always stamps a "type" on its events while kimi's chat
		// messages carry none. role=="meta" is kimi-exclusive.
		isKimi := !isCodex && !isClaude && !isOpencode &&
			(event.Role == "meta" ||
				(event.Type == "" && (event.Role == "assistant" || event.Role == "tool")))

		isGemini := !isKimi && !isOpencode && (event.Role != "" || event.Delta != nil || event.Status != "" ||
			(event.Type == "init" && event.GetSessionID() != ""))
		// Grok streaming-json: token deltas carry "data"; the terminal "end"
		// event carries stopReason + camelCase sessionId (no role/status).
		isGrok := !isCodex && !isClaude && !isGemini &&
			(((event.Type == "thought" || event.Type == "text") && event.Data != "") ||
				(event.Type == "end" && (event.StopReason != "" || event.SessionIDCamel != "")))

		// Handle Codex events
		if isCodex {
			var details []string
			if event.ThreadID != "" {
				details = append(details, fmt.Sprintf("thread_id=%s", event.ThreadID))
			}

			if len(details) > 0 {
				infoFn(fmt.Sprintf("Parsed event #%d type=%s (%s)", totalEvents, event.Type, strings.Join(details, ", ")))
			} else {
				infoFn(fmt.Sprintf("Parsed event #%d type=%s", totalEvents, event.Type))
			}

			switch event.Type {
			case "thread.started":
				threadID = event.ThreadID
				infoFn(fmt.Sprintf("thread.started event thread_id=%s", threadID))
				emitProgress(formatProgressLine("session_started", map[string]string{"id": threadID}))
				if onSessionStarted != nil {
					onSessionStarted(threadID)
				}

			case "turn.started":
				emitProgress(formatProgressLine("turn_started", nil))

			case "thread.completed", "turn.completed":
				if event.ThreadID != "" && threadID == "" {
					threadID = event.ThreadID
				}
				infoFn(fmt.Sprintf("%s event thread_id=%s", event.Type, event.ThreadID))
				eventName := "turn_completed"
				if event.Type == "thread.completed" {
					eventName = "session_completed"
				}
				emitProgress(formatProgressLine(eventName, map[string]string{"total_events": strconv.Itoa(totalEvents)}))
				notifyComplete()

			case "item.completed":
				var itemType string
				if len(event.Item) > 0 {
					var itemHeader struct {
						Type string `json:"type"`
					}
					if err := json.Unmarshal(event.Item, &itemHeader); err == nil {
						itemType = itemHeader.Type
					}
				}

				switch itemType {
				case "agent_message", "reasoning":
					// Parse text content
					var item ItemContent
					if err := json.Unmarshal(event.Item, &item); err == nil {
						normalized := normalizeText(item.Text)
						infoFn(fmt.Sprintf("item.completed event item_type=%s message_len=%d", itemType, len(normalized)))
						if normalized != "" {
							if itemType == "agent_message" {
								codexMessage = normalized
								notifyMessage()
								emitProgress(formatProgressLine("message", map[string]string{"text": strconv.Quote(safeProgressSnippet(normalized, 120))}))
							} else {
								emitProgress(formatProgressLine("reasoning", map[string]string{"text": strconv.Quote(safeProgressSnippet(normalized, 120))}))
							}
							// Send content (Codex outputs complete blocks, not streaming deltas)
							if onContent != nil {
								onContent(normalized, itemType)
							}
						}
					} else {
						warnFn(fmt.Sprintf("Failed to parse item content: %s", err.Error()))
					}

				case "command_execution":
					// Parse command execution
					var cmdItem struct {
						Command          string `json:"command"`
						AggregatedOutput string `json:"aggregated_output"`
						ExitCode         *int   `json:"exit_code"`
						Status           string `json:"status"`
					}
					if err := json.Unmarshal(event.Item, &cmdItem); err == nil {
						// Format command execution info
						var content strings.Builder
						content.WriteString(fmt.Sprintf("$ %s\n", cmdItem.Command))
						if cmdItem.AggregatedOutput != "" {
							content.WriteString(cmdItem.AggregatedOutput)
						}
						infoFn(fmt.Sprintf("item.completed event item_type=command_execution cmd=%s exit=%v", cmdItem.Command, cmdItem.ExitCode))
						fields := map[string]string{"cmd": strconv.Quote(safeProgressSnippet(cmdItem.Command, 120))}
						if cmdItem.ExitCode != nil {
							fields["exit"] = strconv.Itoa(*cmdItem.ExitCode)
						}
						emitProgress(formatProgressLine("cmd_done", fields))
						if onContent != nil && content.Len() > 0 {
							onContent(content.String(), "command")
						}
					}

				default:
					infoFn(fmt.Sprintf("item.completed event item_type=%s", itemType))
					if itemType == "mcp_tool_call" {
						emitProgress(formatProgressLine("mcp_call", nil))
					}
				}
			}
			continue
		}

		// Handle Claude events
		if isClaude {
			if event.GetSessionID() != "" && threadID == "" {
				threadID = event.GetSessionID()
			}

			infoFn(fmt.Sprintf("Parsed Claude event #%d type=%s subtype=%s result_len=%d", totalEvents, event.Type, event.Subtype, len(event.Result)))

			if event.Result != "" {
				claudeMessage = event.Result
				notifyMessage()
				// Stream content to callback
				if onContent != nil {
					onContent(event.Result, "message")
				}
			}

			if event.Type == "result" {
				notifyComplete()
			}
			continue
		}

		// Handle Gemini events
		if isGemini {
			if event.GetSessionID() != "" && threadID == "" {
				threadID = event.GetSessionID()
			}

			if event.Content != "" {
				geminiBuffer.WriteString(event.Content)
				// Stream content to callback
				if onContent != nil {
					onContent(event.Content, "message")
				}
			}

			if event.Status != "" {
				notifyMessage()

				if event.Type == "result" && (event.Status == "success" || event.Status == "error" || event.Status == "complete" || event.Status == "failed") {
					notifyComplete()
				}
			}

			delta := false
			if event.Delta != nil {
				delta = *event.Delta
			}

			infoFn(fmt.Sprintf("Parsed Gemini event #%d type=%s role=%s delta=%t status=%s content_len=%d", totalEvents, event.Type, event.Role, delta, event.Status, len(event.Content)))
			continue
		}

		// Handle Opencode events
		if isOpencode {
			if threadID == "" {
				threadID = event.OpencodeSessionID
				if onSessionStarted != nil {
					onSessionStarted(threadID)
				}
			}

			var part OpencodePart
			if err := json.Unmarshal(event.Part, &part); err != nil {
				warnFn(fmt.Sprintf("Failed to parse opencode part: %s", err.Error()))
				continue
			}
			infoFn(fmt.Sprintf("Parsed Opencode event #%d type=%s part_type=%s", totalEvents, event.Type, part.Type))

			if event.Type == "text" && part.Text != "" {
				opencodeBuffer.WriteString(part.Text)
				notifyMessage()
				emitProgress(formatProgressLine("message", map[string]string{"text": strconv.Quote(safeProgressSnippet(part.Text, 120))}))
				if onContent != nil {
					onContent(part.Text, "message")
				}
			}

			if part.Type == "step-finish" && part.Reason == "stop" {
				emitProgress(formatProgressLine("session_completed", map[string]string{"total_events": strconv.Itoa(totalEvents)}))
				notifyComplete()
			}
			continue
		}

		// Handle Kimi events
		if isKimi {
			switch event.Role {
			case "assistant":
				// Only assistant text is the answer. Tool results and the
				// meta "content" (a resume hint) must stay out of it.
				if event.Content != "" {
					kimiBuffer.WriteString(event.Content)
					notifyMessage()
					emitProgress(formatProgressLine("message", map[string]string{"text": strconv.Quote(safeProgressSnippet(event.Content, 120))}))
					if onContent != nil {
						onContent(event.Content, "message")
					}
				}
			case "tool":
				emitProgress(formatProgressLine("tool_done", map[string]string{"id": strconv.Quote(event.ToolCallID)}))
				if onContent != nil && event.Content != "" {
					onContent(event.Content, "command")
				}
			case "meta":
				infoFn(fmt.Sprintf("Parsed Kimi meta event #%d type=%s session_id=%s", totalEvents, event.Type, event.SessionID))
				if event.Type == "session.resume_hint" {
					emitProgress(formatProgressLine("session_started", map[string]string{"id": event.SessionID}))
				}
			}
			continue
		}

		// Handle Grok events
		if isGrok {
			switch event.Type {
			case "text":
				grokBuffer.WriteString(event.Data)
				if onContent != nil {
					onContent(event.Data, "message")
				}
			case "thought":
				// Reasoning token deltas — not part of the final message.
				// Skip per-token logging: a single turn can emit thousands of
				// thought events and flood the log line limit.
			case "end":
				infoFn(fmt.Sprintf("Parsed Grok end event #%d stop_reason=%s session_id=%s message_len=%d", totalEvents, event.StopReason, event.SessionIDCamel, grokBuffer.Len()))
				if grokBuffer.Len() > 0 {
					notifyMessage()
					emitProgress(formatProgressLine("message", map[string]string{"text": strconv.Quote(safeProgressSnippet(grokBuffer.String(), 120))}))
				}
				emitProgress(formatProgressLine("session_completed", map[string]string{"total_events": strconv.Itoa(totalEvents)}))
				notifyComplete()
			}
			continue
		}

		// Unknown event format from other backends (turn.started/assistant/user); ignore.
		continue
	}

	switch {
	case opencodeBuffer.Len() > 0:
		message = opencodeBuffer.String()
	case kimiBuffer.Len() > 0:
		message = kimiBuffer.String()
	case grokBuffer.Len() > 0:
		message = grokBuffer.String()
	case geminiBuffer.Len() > 0:
		message = geminiBuffer.String()
	case claudeMessage != "":
		message = claudeMessage
	default:
		message = codexMessage
	}

	infoFn(fmt.Sprintf("parseJSONStream completed: events=%d, message_len=%d, thread_id_found=%t", totalEvents, len(message), threadID != ""))
	return message, threadID
}

func formatProgressLine(event string, fields map[string]string) string {
	parts := []string{event}
	if fields == nil {
		return strings.Join(parts, " ")
	}
	for _, key := range []string{"id", "text", "cmd", "exit", "total_events"} {
		if value, ok := fields[key]; ok && strings.TrimSpace(value) != "" {
			parts = append(parts, key+"="+value)
		}
	}
	return strings.Join(parts, " ")
}

func safeProgressSnippet(s string, maxLen int) string {
	s = strings.TrimSpace(strings.ReplaceAll(s, "\n", " "))
	s = strings.Join(strings.Fields(s), " ")
	runes := []rune(s)
	if maxLen <= 0 || len(runes) <= maxLen {
		return s
	}
	if maxLen <= 3 {
		return string(runes[:maxLen])
	}
	return string(runes[:maxLen-3]) + "..."
}

func hasKey(m map[string]json.RawMessage, key string) bool {
	_, ok := m[key]
	return ok
}

func discardInvalidJSON(decoder *json.Decoder, reader *bufio.Reader) (*bufio.Reader, error) {
	var buffered bytes.Buffer

	if decoder != nil {
		if buf := decoder.Buffered(); buf != nil {
			_, _ = buffered.ReadFrom(buf)
		}
	}

	line, err := reader.ReadBytes('\n')
	buffered.Write(line)

	data := buffered.Bytes()
	newline := bytes.IndexByte(data, '\n')
	if newline == -1 {
		return reader, err
	}

	remaining := data[newline+1:]
	if len(remaining) == 0 {
		return reader, err
	}

	return bufio.NewReader(io.MultiReader(bytes.NewReader(remaining), reader)), err
}

func readLineWithLimit(r *bufio.Reader, maxBytes int, previewBytes int) (line []byte, tooLong bool, err error) {
	if r == nil {
		return nil, false, errors.New("reader is nil")
	}
	if maxBytes <= 0 {
		return nil, false, errors.New("maxBytes must be > 0")
	}
	if previewBytes < 0 {
		previewBytes = 0
	}

	part, isPrefix, err := r.ReadLine()
	if err != nil {
		return nil, false, err
	}

	if !isPrefix {
		if len(part) > maxBytes {
			return part[:min(len(part), previewBytes)], true, nil
		}
		return part, false, nil
	}

	preview := make([]byte, 0, min(previewBytes, len(part)))
	if previewBytes > 0 {
		preview = append(preview, part[:min(previewBytes, len(part))]...)
	}

	buf := make([]byte, 0, min(maxBytes, len(part)*2))
	total := 0
	if len(part) > maxBytes {
		tooLong = true
	} else {
		buf = append(buf, part...)
		total = len(part)
	}

	for isPrefix {
		part, isPrefix, err = r.ReadLine()
		if err != nil {
			return nil, tooLong, err
		}

		if previewBytes > 0 && len(preview) < previewBytes {
			preview = append(preview, part[:min(previewBytes-len(preview), len(part))]...)
		}

		if !tooLong {
			if total+len(part) > maxBytes {
				tooLong = true
				continue
			}
			buf = append(buf, part...)
			total += len(part)
		}
	}

	if tooLong {
		return preview, true, nil
	}
	return buf, false, nil
}

func truncateBytes(b []byte, maxLen int) string {
	if len(b) <= maxLen {
		return string(b)
	}
	if maxLen < 0 {
		return ""
	}
	return string(b[:maxLen]) + "..."
}

func normalizeText(text interface{}) string {
	switch v := text.(type) {
	case string:
		return v
	case []interface{}:
		var sb strings.Builder
		for _, item := range v {
			if s, ok := item.(string); ok {
				sb.WriteString(s)
			}
		}
		return sb.String()
	default:
		return ""
	}
}
