import { IPC } from "@shared/ipc-channels";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconChevD, IconChevR } from "../shared/Icons";

interface ResearchItem {
  id: string;
  query: string;
  status: "pending" | "in_progress" | "complete" | "failed";
  startedAt: Date;
}

interface ResearchHistoryPanelProps {
  projectId: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

function formatDate(d: Date): string {
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const statusConfig: Record<
  ResearchItem["status"],
  { dotClass: string; label: string; borderColor: string }
> = {
  pending: { dotClass: "dot--warn", label: "Pending", borderColor: "oklch(0.85 0.06 75)" },
  in_progress: {
    dotClass: "dot--accent dot--pulse",
    label: "Running",
    borderColor: "var(--accent-line)",
  },
  complete: { dotClass: "dot--success", label: "Done", borderColor: "oklch(0.82 0.05 145)" },
  failed: { dotClass: "dot--danger", label: "Failed", borderColor: "oklch(0.82 0.07 25)" },
};

export default function ResearchHistoryPanel({
  projectId,
  collapsed,
  onToggleCollapse,
}: ResearchHistoryPanelProps) {
  const [items, setItems] = useState<ResearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  const load = useCallback(() => {
    if (!projectId) return;
    const gen = ++generationRef.current;
    setLoading(true);
    setError(null);
    window.electronAPI
      .invoke(IPC.GET_RESEARCHES, { projectId })
      .then((rows: unknown[]) => {
        if (gen !== generationRef.current) return;
        setItems(
          rows.map((r) => ({
            id: String((r as Record<string, unknown>).id ?? ""),
            query: String((r as Record<string, unknown>).query ?? ""),
            status: String(
              (r as Record<string, unknown>).status ?? "pending",
            ) as ResearchItem["status"],
            startedAt: new Date(String((r as Record<string, unknown>).startedAt ?? Date.now())),
          })),
        );
      })
      .catch((err) => {
        if (gen !== generationRef.current) return;
        setError(String(err));
      })
      .finally(() => {
        if (gen !== generationRef.current) return;
        setLoading(false);
      });
  }, [projectId]);

  useEffect(() => {
    load();
    return () => {
      generationRef.current++;
    };
  }, [load]);

  useEffect(() => {
    const unsubUpdate = window.electronAPI.on(IPC.RESEARCH_STATUS_UPDATE, (data: unknown) => {
      const d = data as { projectId?: string };
      if (d.projectId === projectId) load();
    });
    const unsubComplete = window.electronAPI.on(IPC.RESEARCH_COMPLETE, (data: unknown) => {
      const d = data as { projectId?: string };
      if (d.projectId === projectId) load();
    });
    return () => {
      unsubUpdate();
      unsubComplete();
    };
  }, [projectId, load]);

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
          Researches
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
            aria-label={collapsed ? "Expand researches" : "Collapse researches"}
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
            <div style={{ textAlign: "center", color: "var(--ink-3)", fontSize: 12, padding: 16 }}>
              Loading...
            </div>
          ) : error ? (
            <div style={{ textAlign: "center", color: "var(--danger)", fontSize: 12, padding: 16 }}>
              {error}
            </div>
          ) : items.length === 0 ? (
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
              No research history
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((item) => {
                const cfg = statusConfig[item.status];
                return (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                      padding: 8,
                      borderRadius: "var(--r-md)",
                      background: "var(--surface)",
                      borderLeft: `3px solid ${cfg.borderColor}`,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className={`dot ${cfg.dotClass}`} style={{ width: 6, height: 6 }} />
                      <span style={{ fontSize: 11, fontWeight: 500 }}>{cfg.label}</span>
                      <span
                        style={{ flex: 1, textAlign: "right", fontSize: 10, color: "var(--ink-3)" }}
                      >
                        {formatDate(item.startedAt)}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--ink-2)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.query}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
