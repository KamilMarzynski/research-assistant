import { Box, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import type { Message } from "../../../../shared/types";
import { useProject } from "../../../contexts/ProjectContext";
import MessageInput from "./MessageInput";
import MessageList from "./MessageList";
import PendingCommandBanner from "./PendingCommandBanner";
import PendingPathBanner from "./PendingPathBanner";
import PendingToolBanner from "./PendingToolBanner";
import ResearchStatusBar from "./ResearchStatusBar";

export default function ChatPanel() {
  const { activeProjectId } = useProject();
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [processing, setProcessing] = useState(false);

  // Check API key once on mount
  useEffect(() => {
    window.electronAPI.invoke(IPC.GET_SETTINGS).then((settings) => {
      setHasApiKey(settings.hasApiKey);
    });
  }, []);

  // Load message history when active project changes
  useEffect(() => {
    if (!activeProjectId) {
      setMessages([]);
      setStreamingContent(null);
      return;
    }
    setStreamingContent(null);
    window.electronAPI
      .invoke(IPC.GET_MESSAGES, { projectId: activeProjectId })
      .then((msgs) => setMessages(msgs));
  }, [activeProjectId]);

  // Subscribe to streaming events
  useEffect(() => {
    const unsubChunk = window.electronAPI.on(IPC.MESSAGE_CHUNK, (delta) => {
      setStreamingContent((prev) => (prev ?? "") + (delta as string));
    });

    const unsubDone = window.electronAPI.on(IPC.MESSAGE_DONE, () => {
      setProcessing(false);
      setStreamingContent((prev) => {
        if (prev !== null) {
          // Check for API key error message — refresh hasApiKey state
          if (prev.startsWith("⚠️")) {
            setHasApiKey(false);
          }
        }
        return null;
      });
      // Reload messages from DB to get canonical state (prevents duplicates)
      if (activeProjectId) {
        window.electronAPI
          .invoke(IPC.GET_MESSAGES, { projectId: activeProjectId })
          .then((msgs) => setMessages(msgs));
      }
    });

    return () => {
      unsubChunk();
      unsubDone();
    };
  }, [activeProjectId]);

  const handleSend = (content: string) => {
    if (!activeProjectId || processing) return;
    setProcessing(true);
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
      <ResearchStatusBar />
      <PendingCommandBanner />
      <PendingPathBanner />
      <PendingToolBanner />
      <MessageList
        messages={messages}
        streamingContent={streamingContent}
        processing={processing}
      />
      {hasApiKey === false ? (
        <Box sx={{ p: 2, textAlign: "center", bgcolor: "background.paper" }}>
          <Typography variant="body2" color="text.secondary">
            No API key configured. Open Settings to set up your model provider.
          </Typography>
        </Box>
      ) : (
        <MessageInput onSend={handleSend} disabled={processing || streamingContent !== null} />
      )}
    </Box>
  );
}
