import { useState, useRef, useEffect, useCallback } from "react";
import { askStream } from "../api";
import type { ChatMessage, Citation } from "../api";
import SourceDrawer from "./SourceDrawer";
import "./ChatPanel.css";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  streaming?: boolean;
}

interface Props {
  prefillQuery: string | null;
  onQueryConsumed: () => void;
}

export default function ChatPanel({ prefillQuery, onQueryConsumed }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [drawerCitations, setDrawerCitations] = useState<Citation[] | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-fill from knowledge graph node click
  useEffect(() => {
    if (prefillQuery) {
      setInput(prefillQuery);
      onQueryConsumed();
      textareaRef.current?.focus();
    }
  }, [prefillQuery, onQueryConsumed]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const question = input.trim();
    if (!question || isStreaming) return;

    setInput("");
    setIsStreaming(true);

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
    };

    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      citations: [],
      streaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    // Build history for the API
    const history: ChatMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    abortRef.current = askStream(question, history, {
      onToken: (token) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + token } : m
          )
        );
      },
      onCitations: (citations) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, citations } : m
          )
        );
      },
      onDone: () => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m
          )
        );
        setIsStreaming(false);
      },
      onError: (errMsg) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `⚠️ Error: ${errMsg}`, streaming: false }
              : m
          )
        );
        setIsStreaming(false);
      },
    });
  }, [input, isStreaming, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setMessages((prev) =>
      prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
    );
  };

  return (
    <div className="chat-panel">
      {/* Header */}
      <div className="chat-header">
        <h2 className="chat-title">Document Q&amp;A</h2>
        {messages.length > 0 && (
          <button
            className="btn btn-ghost"
            onClick={() => setMessages([])}
            disabled={isStreaming}
          >
            Clear
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">🔍</div>
            <p className="empty-title">Ask anything about your documents</p>
            <p className="empty-hint">
              Upload a document on the left, then ask questions here.
              <br />
              Click a node in the knowledge graph to explore concepts.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`message message-${msg.role}`}>
            <div className="message-avatar">
              {msg.role === "user" ? "🧑" : "🤖"}
            </div>

            <div className="message-body">
              <div className="message-content">
                {msg.content || (msg.streaming && <span className="cursor" />)}
              </div>

              {/* Citations */}
              {msg.role === "assistant" &&
                !msg.streaming &&
                msg.citations &&
                msg.citations.length > 0 && (
                  <div className="citations">
                    <span className="citations-label">Sources:</span>
                    {msg.citations.map((c, i) => (
                      <button
                        key={i}
                        className="citation-chip"
                        onClick={() => setDrawerCitations(msg.citations!)}
                      >
                        📎 {c.file_name}
                      </button>
                    ))}
                  </div>
                )}
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="input-area">
        <textarea
          ref={textareaRef}
          className="message-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question about your documents… (Enter to send)"
          rows={2}
          disabled={isStreaming}
        />
        <div className="input-actions">
          {isStreaming ? (
            <button className="btn btn-danger" onClick={handleStop}>
              ⏹ Stop
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={sendMessage}
              disabled={!input.trim()}
            >
              Send ↵
            </button>
          )}
        </div>
      </div>

      {/* Source drawer */}
      {drawerCitations && (
        <SourceDrawer
          citations={drawerCitations}
          onClose={() => setDrawerCitations(null)}
        />
      )}
    </div>
  );
}
