import { useEffect, useRef, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import type { Message, Project } from "../../../../shared/types";
import { useProject } from "../../../contexts/ProjectContext";
import { useStreamState } from "../../../contexts/StreamStateContext";
import { ipc } from "../../../lib/ipc-client";
import WindowDragBar from "../../layout/WindowDragBar";
import ChatHeader from "./ChatHeader";
import MessageInput from "./MessageInput";
import MessageList from "./MessageList";
import PendingCommandBanner from "./PendingCommandBanner";
import PendingExecuteCodeBanner from "./PendingExecuteCodeBanner";
import PendingPathBanner from "./PendingPathBanner";

export default function ChatPanel() {
  const { activeProjectId } = useProject();
  const { states, startStream } = useStreamState();
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);

  const projectState = activeProjectId ? states[activeProjectId] : undefined;
  const streamingSegments = projectState?.streamingSegments ?? [];
  const processing = projectState?.processing ?? false;

  // Check API key once on mount
  useEffect(() => {
    void ipc.invoke(IPC.GET_SETTINGS).then((settings) => {
      setHasApiKey(settings.hasApiKey);
    });
    void ipc.invoke(IPC.GET_PROJECTS).then((p) => setProjects(p));
  }, []);

  // Load message history and refresh project list when active project changes
  useEffect(() => {
    if (!activeProjectId) {
      setMessages([]);
      return;
    }
    void ipc
      .invoke(IPC.GET_MESSAGES, { projectId: activeProjectId })
      .then((msgs) => setMessages(msgs));
    void ipc.invoke(IPC.GET_PROJECTS).then((p) => setProjects(p));
  }, [activeProjectId]);

  // Reload messages from DB when the active project finishes streaming
  const prevProcessingRef = useRef(false);
  useEffect(() => {
    if (!activeProjectId) return;
    const wasProcessing = prevProcessingRef.current;
    prevProcessingRef.current = processing;
    if (wasProcessing && !processing) {
      void ipc
        .invoke(IPC.GET_MESSAGES, { projectId: activeProjectId })
        .then((msgs) => setMessages(msgs));
      // Re-check API key state from settings after each message
      void ipc.invoke(IPC.GET_SETTINGS).then((settings) => {
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
    void ipc.invoke(IPC.SEND_MESSAGE, { projectId: activeProjectId, content });
  };

  const handleAbort = () => {
    if (!activeProjectId) return;
    void ipc.invoke(IPC.ABORT_MESSAGE, { projectId: activeProjectId });
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
      <PendingExecuteCodeBanner />
      <PendingPathBanner />
      <MessageList
        messages={messages}
        streamingSegments={streamingSegments}
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
          disabled={processing || streamingSegments.length > 0}
          projectId={activeProjectId}
          projectModelOverride={activeProject?.modelOverride ?? null}
          projectApprovalLevel={activeProject?.approvalLevel ?? "default"}
        />
      )}
    </div>
  );
}
