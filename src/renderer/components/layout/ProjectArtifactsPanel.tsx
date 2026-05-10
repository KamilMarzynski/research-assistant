import { useEffect, useState } from "react";
import { IPC } from "../../../shared/ipc-channels";
import type { Artifact } from "../../../shared/types";
import { IconDoc } from "../shared/Icons";

interface ProjectArtifactsPanelProps {
  projectId: string;
}

export default function ProjectArtifactsPanel({ projectId }: ProjectArtifactsPanelProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);

  useEffect(() => {
    if (!projectId) return;
    window.electronAPI.invoke(IPC.GET_PROJECT_ARTIFACTS, { projectId }).then(setArtifacts);
  }, [projectId]);

  return (
    <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px" }}>
        <span className="dot dot--accent" />
        <span className="eyebrow">Project Artifacts</span>
      </div>
      <div
        className="thin-scroll"
        style={{
          flex: 1,
          overflow: "auto",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-lg)",
          background: "var(--surface-2)",
          padding: 10,
        }}
      >
        {artifacts.length === 0 ? (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ink-3)",
              fontSize: 12,
            }}
          >
            No artifacts yet
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {artifacts.map((a) => (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  borderRadius: "var(--r-md)",
                  background: "var(--surface)",
                }}
              >
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
                  {a.filePath}
                </span>
                <span className="chip" style={{ flexShrink: 0 }}>
                  {a.title}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
