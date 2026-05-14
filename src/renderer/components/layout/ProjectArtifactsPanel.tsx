import { useEffect, useState } from "react";
import { IPC } from "../../../shared/ipc-channels";
import type { Artifact } from "../../../shared/types";
import { ipc } from "../../lib/ipc-client";
import { IconChevD, IconChevR, IconDoc } from "../shared/Icons";

interface ProjectArtifactsPanelProps {
  projectId: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function ProjectArtifactsPanel({
  projectId,
  collapsed,
  onToggleCollapse,
}: ProjectArtifactsPanelProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    ipc
      .invoke(IPC.GET_PROJECT_ARTIFACTS, { projectId })
      .then((data) => {
        if (!cancelled) setArtifacts(data);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <div
      style={{
        flex: collapsed ? "0 0 auto" : "1 1 0%",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px" }}>
        <span className="dot dot--accent" />
        <span className="eyebrow" style={{ flex: 1 }}>
          Project Artifacts
        </span>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            style={{
              background: "none",
              border: "none",
              padding: 2,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ink-3)",
            }}
            aria-label={collapsed ? "Expand artifacts" : "Collapse artifacts"}
          >
            {collapsed ? <IconChevR size={14} /> : <IconChevD size={14} />}
          </button>
        )}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateRows: collapsed ? "0fr" : "1fr",
          transition: "grid-template-rows 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
          flex: 1,
          overflow: "hidden",
        }}
      >
        <div
          className="thin-scroll"
          style={{
            overflow: "auto",
            minHeight: 0,
            opacity: collapsed ? 0 : 1,
            transition: "opacity 0.25s ease",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-lg)",
            background: "var(--surface-2)",
            padding: 10,
          }}
        >
          {loading ? (
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
              Loading...
            </div>
          ) : error ? (
            <div
              style={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--error)",
                fontSize: 12,
              }}
            >
              {error}
            </div>
          ) : artifacts.length === 0 ? (
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
    </div>
  );
}
