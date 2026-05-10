import { useEffect, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import { decodeMessageChunk, decodeMessageDone } from "../../../../shared/ipc-guards";
import type { Message } from "../../../../shared/types";
import { useProject } from "../../../contexts/ProjectContext";
import WindowDragBar from "../../layout/WindowDragBar";
import ChatHeader from "./ChatHeader";
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
      setProcessing(false);
      return;
    }
    setStreamingContent(null);
    setProcessing(false);
    window.electronAPI
      .invoke(IPC.GET_MESSAGES, { projectId: activeProjectId })
      .then((msgs) => setMessages(msgs));
  }, [activeProjectId]);

  // Subscribe to streaming events
  useEffect(() => {
    const unsubChunk = window.electronAPI.on(IPC.MESSAGE_CHUNK, (data) => {
      const chunk = decodeMessageChunk(data);
      if (chunk === null) return;
      // Ignore chunks for other projects
      if (chunk.projectId && chunk.projectId !== activeProjectId) return;
      setStreamingContent((prev) => (prev ?? "") + chunk.delta);
    });

    const unsubDone = window.electronAPI.on(IPC.MESSAGE_DONE, (data) => {
      const done = decodeMessageDone(data);
      if (done === null) return;
      // Ignore done events for other projects
      if (done.projectId && done.projectId !== activeProjectId) return;
      setProcessing(false);
      setStreamingContent((prev) => {
        if (prev?.startsWith("⚠️ No API key configured")) {
          setHasApiKey(false);
        }
        return null;
      });
      // Re-check API key state from settings after each message
      window.electronAPI.invoke(IPC.GET_SETTINGS).then((settings) => {
        setHasApiKey(settings.hasApiKey);
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
    void window.electronAPI.invoke(IPC.SEND_MESSAGE, { projectId: activeProjectId, content });
  };

  if (!activeProjectId) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <WindowDragBar />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
            color: "var(--ink-2)",
          }}
        >
          Select a project to start chatting
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <WindowDragBar />
      <ChatHeader />
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
        <div
          style={{
            padding: 16,
            textAlign: "center",
            background: "var(--surface)",
            color: "var(--ink-2)",
            fontSize: 13,
          }}
        >
          No API key configured. Open Settings to set up your model provider.
        </div>
      ) : (
        <MessageInput onSend={handleSend} disabled={processing || streamingContent !== null} />
      )}
    </div>
  );
}
