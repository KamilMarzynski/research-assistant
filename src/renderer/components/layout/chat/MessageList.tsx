import { useEffect, useRef } from "react";
import type { Message } from "../../../../shared/types";
import MarkdownRenderer from "../../shared/MarkdownRenderer";

interface MessageListProps {
  messages: Message[];
  streamingContent: string | null;
  processing?: boolean;
}

export default function MessageList({ messages, streamingContent, processing }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-run when messages or streaming content changes to auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // Hide empty assistant placeholders after the last user message.
  // Also hide all post-user assistant messages during active streaming
  // to avoid showing both the DB partial and the live stream overlay.
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  const displayMessages =
    lastUserIndex >= 0
      ? messages.filter((m, i) => {
          if (i <= lastUserIndex) return true;
          if (m.role === "assistant" && m.content.trim() === "") return false;
          if (streamingContent !== null && m.role === "assistant") return false;
          return true;
        })
      : messages;

  return (
    <div
      className="thin-scroll"
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "20px 24px",
      }}
    >
      <style>{`
        @keyframes blink {
          50% { opacity: 0; }
        }
      `}</style>
      <div
        style={{
          maxWidth: 768,
          width: "100%",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        {displayMessages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              maxWidth: 640,
              marginLeft: msg.role === "user" ? "auto" : undefined,
            }}
          >
            <div
              style={{
                padding: "12px 16px",
                borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                background: msg.role === "user" ? "var(--accent)" : "var(--surface)",
                color: msg.role === "user" ? "var(--ink-on-accent)" : "var(--ink)",
                border: msg.role === "user" ? "none" : "1px solid var(--line)",
                fontSize: 13.5,
                lineHeight: 1.55,
              }}
            >
              {msg.role === "user" ? (
                <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {msg.content}
                </span>
              ) : (
                <MarkdownRenderer content={msg.content} />
              )}
            </div>
          </div>
        ))}

        {streamingContent !== null && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              maxWidth: 640,
            }}
          >
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "14px 14px 14px 4px",
                background: "var(--surface)",
                border: "1px solid var(--line)",
                fontSize: 13.5,
                lineHeight: 1.55,
              }}
            >
              <MarkdownRenderer content={streamingContent} />
              <span
                data-testid="streaming-cursor"
                style={{
                  display: "inline-block",
                  width: 8,
                  height: "1em",
                  background: "var(--ink)",
                  marginLeft: 4,
                  verticalAlign: "text-bottom",
                  animation: "blink 1s step-end infinite",
                }}
              />
            </div>
          </div>
        )}

        {processing && !streamingContent && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              maxWidth: 640,
            }}
          >
            <div
              style={{
                padding: "12px 16px",
                borderRadius: "14px 14px 14px 4px",
                background: "var(--surface)",
                border: "1px solid var(--line)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span className="dot dot--accent dot--pulse" />
              <span style={{ fontSize: 13, color: "var(--ink-2)" }}>Agent is thinking...</span>
            </div>
          </div>
        )}

        {/* empty state */}
        {displayMessages.length === 0 && !streamingContent && !processing && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              maxWidth: "85%",
            }}
          >
            <div
              style={{
                padding: "12px 16px",
                borderRadius: 14,
                background: "var(--bg)",
                border: "1px solid var(--line)",
                fontSize: 13.5,
                lineHeight: 1.55,
              }}
            >
              <p style={{ margin: "0 0 8px", color: "var(--ink-2)" }}>
                Welcome to your new project.
              </p>
              <p style={{ margin: 0, color: "var(--ink-2)" }}>
                Tell me about your project so I can help you best. Useful details:
              </p>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18, color: "var(--ink-2)" }}>
                <li>What is this project about?</li>
                <li>How are files organized?</li>
                <li>Where should research outputs go?</li>
                <li>Any naming conventions or tech stack?</li>
              </ul>
            </div>
          </div>
        )}
      </div>{" "}
      {/* close centered column */}
      <div ref={bottomRef} />
    </div>
  );
}
