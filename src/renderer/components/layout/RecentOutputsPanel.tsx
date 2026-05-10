import { useEffect, useState } from "react";
import { IPC } from "../../../shared/ipc-channels";
import type { Artifact } from "../../../shared/types";
import { IconCheck, IconDoc, IconFolder } from "../shared/Icons";

interface RecentOutputsPanelProps {
  projectId: string;
}

export default function RecentOutputsPanel({ projectId }: RecentOutputsPanelProps) {
  const [outputs, setOutputs] = useState<Artifact[]>([]);

  useEffect(() => {
    if (!projectId) return;
    window.electronAPI.invoke(IPC.GET_RECENT_OUTPUTS, { projectId }).then(setOutputs);
  }, [projectId]);

  const handleAcknowledge = async (artifactId: string) => {
    await window.electronAPI.invoke(IPC.ACKNOWLEDGE_OUTPUT, { projectId, artifactId });
    setOutputs((prev) => prev.filter((o) => o.id !== artifactId));
  };

  const handleAcknowledgeAll = async () => {
    await window.electronAPI.invoke(IPC.ACKNOWLEDGE_ALL_OUTPUTS, { projectId });
    setOutputs([]);
  };

  const handleReveal = async (filePath: string) => {
    await window.electronAPI.invoke(IPC.REVEAL_IN_FOLDER, { filePath, projectId });
  };

  if (outputs.length === 0) {
    return (
      <div style={{ padding: 16, textAlign: "center" }}>
        <span style={{ fontSize: 12, color: "var(--ink-3)" }}>No recent outputs</span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="dot dot--accent" />
          <span className="eyebrow">Recent Outputs</span>
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--sm no-drag"
          onClick={handleAcknowledgeAll}
        >
          <IconCheck size={12} />
          Acknowledge All
        </button>
      </div>

      <div className="thin-scroll" style={{ flex: 1, overflow: "auto" }}>
        {outputs.map((output, index) => (
          <div
            key={output.id}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              padding: "10px 16px",
              borderTop: "1px solid var(--line)",
              background: index === 0 ? "var(--surface-2)" : undefined,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
              <IconDoc size={13} strokeColor="var(--ink-3)" style={{ flexShrink: 0 }} />
              <span
                style={{
                  flex: 1,
                  fontSize: 12,
                  color: "var(--ink)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {output.filePath}
              </span>
              <button
                type="button"
                className="btn btn--ghost btn--icon"
                style={{ width: 24, height: 24, padding: 0 }}
                onClick={() => handleReveal(output.filePath)}
                title="Show in folder"
              >
                <IconFolder size={13} />
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--icon"
                style={{ width: 24, height: 24, padding: 0 }}
                onClick={() => handleAcknowledge(output.id)}
                title="Acknowledge"
              >
                <IconCheck size={13} />
              </button>
            </div>
            <span className="chip" style={{ alignSelf: "flex-start" }}>
              {output.title}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
