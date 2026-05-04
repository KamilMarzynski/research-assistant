import { Box, CircularProgress, Paper, Typography } from "@mui/material";
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
            {msg.role === "user" ? (
              <Typography
                variant="body2"
                color="primary.contrastText"
                sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
              >
                {msg.content}
              </Typography>
            ) : (
              <MarkdownRenderer content={msg.content} />
            )}
          </Paper>
        </Box>
      ))}

      {streamingContent !== null && (
        <Box sx={{ alignSelf: "flex-start", maxWidth: "75%" }}>
          <Paper elevation={0} sx={{ p: 1.5, bgcolor: "action.selected", borderRadius: 2 }}>
            <Box sx={{ position: "relative" }}>
              <MarkdownRenderer content={streamingContent} />
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
            </Box>
          </Paper>
        </Box>
      )}

      {processing && !streamingContent && (
        <Box sx={{ alignSelf: "flex-start", maxWidth: "75%" }}>
          <Paper
            elevation={0}
            sx={{
              p: 1.5,
              bgcolor: "action.selected",
              borderRadius: 2,
              display: "flex",
              alignItems: "center",
              gap: 1,
            }}
          >
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary">
              Agent is thinking…
            </Typography>
          </Paper>
        </Box>
      )}

      {messages.length === 0 && !streamingContent && !processing && (
        <Box sx={{ alignSelf: "flex-start", maxWidth: "85%" }}>
          <Paper
            elevation={0}
            sx={{
              p: 1.5,
              bgcolor: "background.default",
              border: 1,
              borderColor: "divider",
              borderRadius: 2,
            }}
          >
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Welcome to your new project.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Tell me about your project so I can help you best. Useful details:
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2, color: "text.secondary" }}>
              <Typography component="li" variant="body2">
                What is this project about?
              </Typography>
              <Typography component="li" variant="body2">
                How are files organized?
              </Typography>
              <Typography component="li" variant="body2">
                Where should research outputs go?
              </Typography>
              <Typography component="li" variant="body2">
                Any naming conventions or tech stack?
              </Typography>
            </Box>
          </Paper>
        </Box>
      )}

      <div ref={bottomRef} />
    </Box>
  );
}
