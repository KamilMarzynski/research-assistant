import { useEffect, useRef } from "react";
import type { Message } from "../../../../shared/types";
import ActivityPill from "../../shared/ActivityPill";
import MarkdownRenderer from "../../shared/MarkdownRenderer";
import type { StreamSegment } from "../../../contexts/StreamStateContext";

interface MessageListProps {
  messages: Message[];
  streamingSegments: StreamSegment[];
  processing?: boolean;
}

export default function MessageList({ messages, streamingSegments, processing }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-run when messages or streaming segments change to auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingSegments]);

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
          if (streamingSegments.length > 0 && m.role === "assistant") return false;
          return true;
        })
      : messages;

  const hasRunningTool = streamingSegments.some(
    (s) => s.type === "activity" && s.status === "running",
  );
  const lastSeg = streamingSegments[streamingSegments.length - 1];
  const showThinkingSpinner =
    !!processing &&
    !hasRunningTool &&
    (streamingSegments.length === 0 || lastSeg?.type === "activity");

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

        {streamingSegments.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              maxWidth: 640,
            }}
          >
            {streamingSegments.map((seg, i) =>
              seg.type === "text" ? (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: segments are append-only within a single stream
                  key={i}
                  style={{
                    padding: "12px 16px",
                    borderRadius: "14px 14px 14px 4px",
                    background: "var(--surface)",
                    border: "1px solid var(--line)",
                    fontSize: 13.5,
                    lineHeight: 1.55,
                  }}
                >
                  <MarkdownRenderer content={seg.content} />
                  {i === streamingSegments.length - 1 && processing && (
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
                  )}
                </div>
              ) : (
                <ActivityPill
                  // biome-ignore lint/suspicious/noArrayIndexKey: segments are append-only within a single stream
                  key={i}
                  toolCallId={seg.toolCallId}
                  toolName={seg.toolName}
                  description={seg.description}
                  status={seg.status}
                />
              ),
            )}
          </div>
        )}

        {showThinkingSpinner && (
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
        {displayMessages.length === 0 && streamingSegments.length === 0 && !processing && (
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
      </div>
      <div ref={bottomRef} />
    </div>
  );
}
