import { Box, Paper, Typography } from "@mui/material";
import { useEffect, useRef } from "react";
import type { Message } from "../../../../shared/types";

interface MessageListProps {
  messages: Message[];
  streamingContent: string | null;
}

export default function MessageList({ messages, streamingContent }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-run when messages or streaming content changes to auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  return (
    <Box
      sx={{
        flex: 1,
        overflowY: "auto",
        p: 2,
        display: "flex",
        flexDirection: "column",
        gap: 1,
      }}
    >
      {messages.map((msg) => (
        <Box
          key={msg.id}
          data-testid="message-bubble"
          sx={{
            alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
            maxWidth: "75%",
          }}
        >
          <Paper
            elevation={0}
            sx={{
              p: 1.5,
              bgcolor: msg.role === "user" ? "primary.main" : "action.selected",
              borderRadius: 2,
            }}
          >
            <Typography
              variant="body2"
              color={msg.role === "user" ? "primary.contrastText" : "text.primary"}
              sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
            >
              {msg.content}
            </Typography>
          </Paper>
        </Box>
      ))}

      {streamingContent !== null && (
        <Box sx={{ alignSelf: "flex-start", maxWidth: "75%" }}>
          <Paper elevation={0} sx={{ p: 1.5, bgcolor: "action.selected", borderRadius: 2 }}>
            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {streamingContent}
              <Box
                component="span"
                data-testid="streaming-cursor"
                sx={{
                  display: "inline-block",
                  width: 8,
                  height: "1em",
                  bgcolor: "text.primary",
                  ml: 0.5,
                  verticalAlign: "text-bottom",
                  animation: "blink 1s step-end infinite",
                  "@keyframes blink": { "50%": { opacity: 0 } },
                }}
              />
            </Typography>
          </Paper>
        </Box>
      )}

      <div ref={bottomRef} />
    </Box>
  );
}
