import { useEffect, useRef, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import type { Message, Project } from "../../../../shared/types";
import { useProject } from "../../../contexts/ProjectContext";
import { useStreamState } from "../../../contexts/StreamStateContext";
import WindowDragBar from "../../layout/WindowDragBar";
import ChatHeader from "./ChatHeader";
import MessageInput from "./MessageInput";
import MessageList from "./MessageList";
import PendingCommandBanner from "./PendingCommandBanner";
import PendingPathBanner from "./PendingPathBanner";
import PendingToolBanner from "./PendingToolBanner";

export default function ChatPanel() {
  const { activeProjectId } = useProject();
  const { states, startStream } = useStreamState();
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);

  const projectState = activeProjectId ? states[activeProjectId] : undefined;
  const streamingContent = projectState?.streamingContent ?? null;
  const processing = projectState?.processing ?? false;

  // Check API key once on mount
  useEffect(() => {
    window.electronAPI.invoke(IPC.GET_SETTINGS).then((settings) => {
      setHasApiKey(settings.hasApiKey);
    });
    window.electronAPI.invoke(IPC.GET_PROJECTS).then((p) => setProjects(p));
  }, []);

  // Load message history and refresh project list when active project changes
  useEffect(() => {
    if (!activeProjectId) {
      setMessages([]);
      return;
    }
    window.electronAPI
      .invoke(IPC.GET_MESSAGES, { projectId: activeProjectId })
      .then((msgs) => setMessages(msgs));
    window.electronAPI.invoke(IPC.GET_PROJECTS).then((p) => setProjects(p));
  }, [activeProjectId]);

  // Reload messages from DB when the active project finishes streaming
  const prevProcessingRef = useRef(false);
  useEffect(() => {
    if (!activeProjectId) return;
    const wasProcessing = prevProcessingRef.current;
    prevProcessingRef.current = processing;
    if (wasProcessing && !processing) {
      window.electronAPI
        .invoke(IPC.GET_MESSAGES, { projectId: activeProjectId })
        .then((msgs) => setMessages(msgs));
      // Re-check API key state from settings after each message
      window.electronAPI.invoke(IPC.GET_SETTINGS).then((settings) => {
        setHasApiKey(settings.hasApiKey);
      });
    }
  }, [processing, activeProjectId]);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  const handleSend = (content: string) => {
    if (!activeProjectId || processing) return;
    startStream(activeProjectId);
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

  const handleAbort = () => {
    if (!activeProjectId) return;
    void window.electronAPI.invoke(IPC.ABORT_MESSAGE, { projectId: activeProjectId });
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
        <MessageInput
          onSend={handleSend}
          onAbort={handleAbort}
          disabled={processing || streamingContent !== null}
          projectId={activeProjectId}
          projectModelOverride={activeProject?.modelOverride ?? null}
        />
      )}
    </div>
  );
}
