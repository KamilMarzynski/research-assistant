import { Box, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import type { Message } from "../../../../shared/types";
import { useProject } from "../../../contexts/ProjectContext";
import MessageInput from "./MessageInput";
import MessageList from "./MessageList";

export default function ChatPanel() {
  const { activeProjectId } = useProject();
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);

  // Check API key once on mount
  useEffect(() => {
    window.electronAPI.invoke(IPC.GET_SETTINGS).then((s) => {
      const settings = s as { openrouterApiKey: string | null };
      setHasApiKey(settings.openrouterApiKey !== null);
    });
  }, []);

  // Load message history when active project changes
  useEffect(() => {
    if (!activeProjectId) {
      setMessages([]);
      return;
    }
    window.electronAPI
      .invoke(IPC.GET_MESSAGES, { projectId: activeProjectId })
      .then((msgs) => setMessages(msgs as Message[]));
  }, [activeProjectId]);

  // Subscribe to streaming events
  useEffect(() => {
    const unsubChunk = window.electronAPI.on(IPC.MESSAGE_CHUNK, (delta) => {
      setStreamingContent((prev) => (prev ?? "") + (delta as string));
    });

    const unsubDone = window.electronAPI.on(IPC.MESSAGE_DONE, () => {
      setStreamingContent((prev) => {
        if (prev !== null) {
          // Check for API key error message — refresh hasApiKey state
          if (prev.startsWith("⚠️")) {
            setHasApiKey(false);
          }
          setMessages((msgs) => [
            ...msgs,
            {
              id: crypto.randomUUID(),
              projectId: activeProjectId ?? "",
              role: "assistant" as const,
              content: prev,
              createdAt: new Date(),
            },
          ]);
        }
        return null;
      });
    });

    return () => {
      unsubChunk();
      unsubDone();
    };
  }, [activeProjectId]);

  const handleSend = (content: string) => {
    if (!activeProjectId) return;
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        projectId: activeProjectId,
        role: "user" as const,
        content,
        createdAt: new Date(),
      },
    ]);
    window.electronAPI.send(IPC.SEND_MESSAGE, { projectId: activeProjectId, content });
  };

  if (!activeProjectId) {
    return (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
        }}
      >
        <Typography color="text.secondary">Select a project to start chatting</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <MessageList messages={messages} streamingContent={streamingContent} />
      {hasApiKey === false ? (
        <Box sx={{ p: 2, textAlign: "center", borderTop: 1, borderColor: "divider" }}>
          <Typography variant="body2" color="text.secondary">
            Configure your OpenRouter API key in Settings to start chatting.
          </Typography>
        </Box>
      ) : (
        <MessageInput onSend={handleSend} disabled={streamingContent !== null} />
      )}
    </Box>
  );
}
