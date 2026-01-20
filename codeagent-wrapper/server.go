package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"sync"
	"time"
)

// WebServer manages SSE connections for real-time output streaming
type WebServer struct {
	mu       sync.RWMutex
	clients  map[string][]chan ContentEvent
	sessions map[string]*SessionState
	server   *http.Server
	port     int
	backend  string // Current backend name for single-panel display
}

// SessionState tracks a running session
type SessionState struct {
	ID        string    `json:"id"`
	Backend   string    `json:"backend"`
	Task      string    `json:"task"`
	StartTime time.Time `json:"start_time"`
	Content   string    `json:"content"`
	Done      bool      `json:"done"`
}

// ContentEvent is sent to SSE clients
type ContentEvent struct {
	SessionID   string `json:"session_id"`
	Backend     string `json:"backend"`
	Content     string `json:"content,omitempty"`
	ContentType string `json:"content_type,omitempty"` // "reasoning", "command", "message"
	Done        bool   `json:"done,omitempty"`
}

// NewWebServer creates a new web server
func NewWebServer(backend string) *WebServer {
	return &WebServer{
		clients:  make(map[string][]chan ContentEvent),
		sessions: make(map[string]*SessionState),
		backend:  backend,
	}
}

// Start starts the web server on a random available port
func (ws *WebServer) Start() error {
	mux := http.NewServeMux()

	// Serve the main page
	mux.HandleFunc("/", ws.handleIndex)

	// API endpoints
	mux.HandleFunc("/api/sessions", ws.handleSessions)
	mux.HandleFunc("/api/stream/", ws.handleStream)

	// Listen on port 0 to get a random available port
	listener, err := net.Listen("tcp", ":0")
	if err != nil {
		return err
	}

	ws.port = listener.Addr().(*net.TCPAddr).Port

	ws.server = &http.Server{
		Handler: mux,
	}

	url := fmt.Sprintf("http://localhost:%d", ws.port)
	fmt.Fprintf(os.Stderr, "  Web UI: %s\n", url)

	go func() {
		if err := ws.server.Serve(listener); err != nil && err != http.ErrServerClosed {
			logWarn(fmt.Sprintf("Web server error: %v", err))
		}
	}()

	// Auto-open browser
	go openBrowser(url)

	return nil
}

// Stop gracefully shuts down the web server
func (ws *WebServer) Stop() error {
	if ws == nil || ws.server == nil {
		return nil
	}

	// Create a context with a short timeout for graceful shutdown
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	// Close all client connections
	ws.mu.Lock()
	for _, clients := range ws.clients {
		for _, ch := range clients {
			close(ch)
		}
	}
	ws.clients = make(map[string][]chan ContentEvent)
	ws.mu.Unlock()

	return ws.server.Shutdown(ctx)
}

// openBrowser opens the specified URL in the default browser
func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	case "windows":
		// Use rundll32 for better compatibility
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
		// Hide CMD window on Windows
		hideWindowsConsole(cmd)
	default:
		return
	}

	// FIX: Properly clean up browser process to prevent zombie processes
	// Start the command and wait for it to complete in a goroutine
	if err := cmd.Start(); err != nil {
		// Silently fail if browser can't be opened
		return
	}

	// Clean up process in background to prevent zombie processes
	go func() {
		_ = cmd.Wait()
	}()
}

// StartSession starts tracking a new session
func (ws *WebServer) StartSession(id, backend, task string) {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	ws.sessions[id] = &SessionState{
		ID:        id,
		Backend:   backend,
		Task:      task,
		StartTime: time.Now(),
	}
}

// SendContent sends content to all subscribers of a session
func (ws *WebServer) SendContent(sessionID, backend, content string) {
	ws.SendContentWithType(sessionID, backend, content, "message")
}

// SendContentWithType sends content with a specific type to all subscribers
func (ws *WebServer) SendContentWithType(sessionID, backend, content, contentType string) {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	// Update session state
	if session, ok := ws.sessions[sessionID]; ok {
		session.Content += content
	}

	// Send to all subscribers
	event := ContentEvent{
		SessionID:   sessionID,
		Backend:     backend,
		Content:     content,
		ContentType: contentType,
	}

	for _, ch := range ws.clients[sessionID] {
		select {
		case ch <- event:
		default:
			// Skip if channel is full
		}
	}
}

// EndSession marks a session as complete
func (ws *WebServer) EndSession(sessionID, backend string) {
	ws.mu.Lock()
	defer ws.mu.Unlock()

	if session, ok := ws.sessions[sessionID]; ok {
		session.Done = true
	}

	event := ContentEvent{
		SessionID: sessionID,
		Backend:   backend,
		Done:      true,
	}

	for _, ch := range ws.clients[sessionID] {
		select {
		case ch <- event:
		default:
		}
	}
}

// handleIndex serves the main HTML page
func (ws *WebServer) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	// Generate single-panel HTML based on backend
	html := ws.generateIndexHTML()
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(html))
}

// generateIndexHTML creates a single-panel HTML page for the current backend
func (ws *WebServer) generateIndexHTML() string {
	backend := ws.backend
	if backend == "" {
		backend = "Agent"
	}

	// Determine colors based on backend
	iconBg := "#238636"
	titleColor := "#3fb950"
	iconText := "AGT"

	switch backend {
	case "codex":
		iconBg = "#238636"
		titleColor = "#3fb950"
		iconText = "CDX"
	case "gemini":
		iconBg = "#8957e5"
		titleColor = "#a371f7"
		iconText = "GEM"
	case "claude":
		iconBg = "#d97706"
		titleColor = "#fbbf24"
		iconText = "CLD"
	}

	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>%s - Live Output</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0d1117;
            color: #c9d1d9;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }
        header {
            background: #161b22;
            padding: 12px 20px;
            border-bottom: 1px solid #30363d;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .panel-icon {
            width: 32px;
            height: 32px;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 11px;
            background: %s;
            color: #fff;
        }
        .title { font-size: 18px; font-weight: 600; color: %s; }
        .live-indicator {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            color: #3fb950;
            font-size: 12px;
            margin-left: auto;
        }
        .live-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%%;
            background: #3fb950;
            animation: blink 1s infinite;
        }
        @keyframes blink {
            0%%, 100%% { opacity: 1; }
            50%% { opacity: 0.3; }
        }
        .output-area {
            flex: 1;
            background: #0d1117;
            padding: 16px 20px;
            font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
            font-size: 13px;
            white-space: pre-wrap;
            word-break: break-word;
            overflow-y: auto;
            line-height: 1.6;
        }
        .cursor {
            display: inline-block;
            width: 8px;
            height: 16px;
            background: #3fb950;
            animation: cursor-blink 1s infinite;
            vertical-align: text-bottom;
        }
        @keyframes cursor-blink {
            0%%, 50%% { opacity: 1; }
            51%%, 100%% { opacity: 0; }
        }
        .done-indicator {
            color: #8b949e;
            font-style: italic;
            margin-top: 16px;
            padding-top: 12px;
            border-top: 1px solid #30363d;
        }
    </style>
</head>
<body>
    <header>
        <div class="panel-icon">%s</div>
        <div class="title">%s</div>
        <div class="live-indicator" id="liveIndicator">
            <span class="live-dot"></span> LIVE
        </div>
    </header>
    <div class="output-area" id="output"></div>
    <script>
        const output = document.getElementById('output');
        const liveIndicator = document.getElementById('liveIndicator');
        let connected = false;
        let userScrolled = false;

        // Detect if user manually scrolled up
        output.addEventListener('scroll', () => {
            const isAtBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 50;
            userScrolled = !isAtBottom;
        });

        // Reliable auto-scroll function
        function scrollToBottom() {
            if (userScrolled) return; // Respect user's scroll position
            output.scrollTop = output.scrollHeight;
        }

        async function connectToStream() {
            try {
                const res = await fetch('/api/sessions');
                const sessions = await res.json();
                if (sessions.length === 0) {
                    setTimeout(connectToStream, 500);
                    return;
                }
                const session = sessions[0];
                if (connected) return;
                connected = true;

                // Display user task/prompt first
                if (session.task) {
                    const taskEl = document.createElement('div');
                    taskEl.style.cssText = 'color: #58a6ff; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #30363d;';
                    taskEl.innerHTML = '<strong>📋 Task:</strong><br>' + session.task.replace(/\n/g, '<br>');
                    output.appendChild(taskEl);
                    // Scroll to bottom after displaying task
                    setTimeout(scrollToBottom, 0);
                }

                const es = new EventSource('/api/stream/' + session.id);
                es.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.content) {
                        const cursor = output.querySelector('.cursor');
                        if (cursor) cursor.remove();

                        // Create content element with appropriate styling
                        const contentEl = document.createElement('span');
                        const contentType = data.content_type || 'message';

                        switch (contentType) {
                            case 'reasoning':
                                contentEl.style.cssText = 'color: #8b949e; font-style: italic;';
                                contentEl.textContent = '💭 ' + data.content;
                                break;
                            case 'command':
                                contentEl.style.cssText = 'color: #fbbf24; background: #1e1e1e; padding: 8px; margin: 8px 0; display: block; border-left: 3px solid #d97706; font-family: monospace;';
                                contentEl.textContent = data.content;
                                break;
                            case 'message':
                            default:
                                contentEl.style.cssText = 'color: #c9d1d9;';
                                contentEl.textContent = data.content;
                                break;
                        }

                        output.appendChild(contentEl);

                        const cursorEl = document.createElement('span');
                        cursorEl.className = 'cursor';
                        output.appendChild(cursorEl);

                        // Auto-scroll to bottom (use setTimeout for reliable DOM update)
                        setTimeout(scrollToBottom, 0);
                    }
                    if (data.done) {
                        const cursor = output.querySelector('.cursor');
                        if (cursor) cursor.remove();
                        liveIndicator.style.display = 'none';
                        const doneEl = document.createElement('div');
                        doneEl.className = 'done-indicator';
                        doneEl.textContent = '✓ 完成 (3秒后自动关闭)';
                        output.appendChild(doneEl);

                        // Force scroll to bottom on completion
                        userScrolled = false;
                        setTimeout(scrollToBottom, 0);

                        es.close();

                        // Browser notification
                        if (Notification.permission === 'granted') {
                            new Notification('任务完成', { body: '代码生成已完成' });
                        }

                        // Auto-close window after 3 seconds
                        setTimeout(() => {
                            window.close();
                            // If window.close() fails (user-opened window), show message
                            setTimeout(() => {
                                doneEl.textContent = '✓ 完成 (可以关闭此页面)';
                            }, 100);
                        }, 3000);
                    }
                };
                es.onerror = () => {
                    liveIndicator.style.display = 'none';
                };
            } catch (e) {
                setTimeout(connectToStream, 500);
            }
        }
        connectToStream();
    </script>
</body>
</html>`, backend, iconBg, titleColor, iconText, backend)
}

// handleSessions returns all active sessions
func (ws *WebServer) handleSessions(w http.ResponseWriter, r *http.Request) {
	ws.mu.RLock()
	sessions := make([]*SessionState, 0, len(ws.sessions))
	for _, s := range ws.sessions {
		sessions = append(sessions, s)
	}
	ws.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sessions)
}

// handleStream handles SSE connections for a session
func (ws *WebServer) handleStream(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Path[len("/api/stream/"):]
	if sessionID == "" {
		http.Error(w, "Session ID required", http.StatusBadRequest)
		return
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", http.StatusInternalServerError)
		return
	}

	// Create channel for this client
	ch := make(chan ContentEvent, 100)

	// Register client
	ws.mu.Lock()
	ws.clients[sessionID] = append(ws.clients[sessionID], ch)
	// Only send done state if session is already complete (no historical content)
	if session, ok := ws.sessions[sessionID]; ok && session.Done {
		ch <- ContentEvent{
			SessionID: sessionID,
			Backend:   session.Backend,
			Done:      true,
		}
	}
	ws.mu.Unlock()

	// Cleanup on disconnect
	defer func() {
		ws.mu.Lock()
		clients := ws.clients[sessionID]
		for i, c := range clients {
			if c == ch {
				ws.clients[sessionID] = append(clients[:i], clients[i+1:]...)
				break
			}
		}
		ws.mu.Unlock()
		close(ch)
	}()

	// Stream events
	for {
		select {
		case event := <-ch:
			data, _ := json.Marshal(event)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()

			if event.Done {
				return
			}
		case <-r.Context().Done():
			return
		}
	}
}
