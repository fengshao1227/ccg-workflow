package main

import (
	"bufio"
	"encoding/json"
	"io"
	"strings"
)

// agyEvent is one NDJSON line of `agy --output-format stream-json`.
type agyEvent struct {
	Event          string `json:"event"`
	ConversationID string `json:"conversation_id"`
	StepUpdate     *struct {
		ConversationID string `json:"conversation_id"`
		StepType       string `json:"step_type"`
		TextDelta      string `json:"text_delta"`
	} `json:"step_update"`
	Result *struct {
		ConversationID string `json:"conversation_id"`
		Status         string `json:"status"`
		Response       string `json:"response"`
		Error          string `json:"error"`
		// A tool denied in headless mode ends the turn with status SUCCESS and
		// an empty response; only this list says why (seen on agy 1.5.10).
		DeniedActions []struct {
			Action string `json:"action"`
		} `json:"denied_actions"`
	} `json:"result"`
}

// agyStreamHandlers receive a stream as it arrives. Any of them may be nil.
type agyStreamHandlers struct {
	onSession func(id string)   // once, as soon as the conversation ID is known
	onText    func(text string) // each piece of visible text
	onLine    func(line string) // that text again, one complete non-blank line at a time
}

// parseAntigravityStream reads agy stream-json output and returns the final
// message, the conversation ID, and the failure agy reported, if any. The
// message is the result event's response; without one (e.g. a denied tool ended
// the turn) it falls back to the agent_response deltas, then to any lines that
// were not events. An agy too old for --output-format rejects the flag and
// exits, so those lines are stray output, not a plain-text mode.
func parseAntigravityStream(r io.Reader, h agyStreamHandlers) (message, conversationID, failure string) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 256*1024), 10*1024*1024)

	var deltas, plain, partial strings.Builder
	var response string

	setID := func(id string) {
		if conversationID != "" || id == "" {
			return
		}
		conversationID = id
		if h.onSession != nil {
			h.onSession(id)
		}
	}
	emitLine := func(line string) {
		if h.onLine != nil && strings.TrimSpace(line) != "" {
			h.onLine(strings.TrimRight(line, "\r"))
		}
	}
	emit := func(text string) {
		if h.onText != nil {
			h.onText(text)
		}
		partial.WriteString(text)
		rest := partial.String()
		for {
			i := strings.IndexByte(rest, '\n')
			if i < 0 {
				break
			}
			emitLine(rest[:i])
			rest = rest[i+1:]
		}
		partial.Reset()
		partial.WriteString(rest)
	}

	for scanner.Scan() {
		line := scanner.Text()
		var ev agyEvent
		if !strings.HasPrefix(strings.TrimSpace(line), "{") || json.Unmarshal([]byte(line), &ev) != nil || ev.Event == "" {
			if plain.Len() > 0 {
				plain.WriteByte('\n')
			}
			plain.WriteString(line)
			emit(line + "\n")
			continue
		}

		setID(ev.ConversationID)
		switch {
		case ev.StepUpdate != nil:
			setID(ev.StepUpdate.ConversationID)
			if ev.StepUpdate.StepType == "agent_response" && ev.StepUpdate.TextDelta != "" {
				deltas.WriteString(ev.StepUpdate.TextDelta)
				emit(ev.StepUpdate.TextDelta)
			}
		case ev.Result != nil:
			setID(ev.Result.ConversationID)
			response = ev.Result.Response
			failure = agyFailure(ev.Result.Status, ev.Result.Error)
			if failure == "" && len(ev.Result.DeniedActions) > 0 {
				var denied []string
				for _, d := range ev.Result.DeniedActions {
					denied = append(denied, d.Action)
				}
				failure = "permission denied in headless mode: " + strings.Join(denied, ", ") +
					" (re-run with --skip-permissions, or allow it in a CODEAGENT_AGY_SETTINGS file)"
			}
		}
	}
	emitLine(partial.String())

	switch {
	case strings.TrimSpace(response) != "":
		message = response
	case deltas.Len() > 0:
		message = deltas.String()
	default:
		message = plain.String()
	}
	return strings.TrimSpace(message), conversationID, failure
}

// agyFailure names what went wrong in a result event, or "" if nothing did.
func agyFailure(status, errText string) string {
	if errText = strings.TrimSpace(errText); errText != "" {
		return errText
	}
	if status = strings.TrimSpace(status); status != "" && !strings.EqualFold(status, "SUCCESS") {
		return "status " + status
	}
	return ""
}
