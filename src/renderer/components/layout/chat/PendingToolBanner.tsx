import { useEffect, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import { decodePendingTool } from "../../../../shared/ipc-guards";
import type { PendingTool } from "../../../../shared/ipc-types";
import { IconBolt } from "../../../components/shared/Icons";
import { usePendingItems } from "../../../hooks/usePendingItems";
import { ipc } from "../../../lib/ipc-client";
import PendingToolModal from "./PendingToolModal";

interface Props {
  projectSlug?: string;
}

export default function PendingToolBanner({ projectSlug }: Props) {
  const { items, add, remove } = usePendingItems<PendingTool>({
    channel: IPC.TOOL_PENDING,
    decode: decodePendingTool,
    getKey: (t) => `${t.scope}:${t.projectSlug ?? "global"}:${t.name}`,
  });
  const [selectedTool, setSelectedTool] = useState<PendingTool | null>(null);

  useEffect(() => {
    void ipc.invoke(IPC.GET_PENDING_TOOLS).then((tools) => {
      for (const tool of tools) add({ ...tool, scope: "global" });
    });
    if (projectSlug) {
      void ipc.invoke(IPC.GET_PROJECT_PENDING_TOOLS, { projectSlug }).then((tools) => {
        for (const tool of tools) add({ ...tool, scope: "project" as const, projectSlug });
      });
    }
  }, [add, projectSlug]);

  const handleApprove = async (tool: PendingTool) => {
    try {
      if (tool.scope === "project" && tool.projectSlug) {
        await ipc.invoke(IPC.APPROVE_PROJECT_TOOL, {
          projectSlug: tool.projectSlug,
          name: tool.name,
        });
      } else {
        await ipc.invoke(IPC.APPROVE_TOOL, { name: tool.name });
      }
    } catch {
      // File may not exist (e.g. in test context); proceed with UI update
    }
    remove(tool);
    setSelectedTool(null);
  };

  const handleReject = async (tool: PendingTool) => {
    try {
      if (tool.scope === "project" && tool.projectSlug) {
        await ipc.invoke(IPC.REJECT_PROJECT_TOOL, {
          projectSlug: tool.projectSlug,
          name: tool.name,
        });
      } else {
        await ipc.invoke(IPC.REJECT_TOOL, { name: tool.name });
      }
    } catch {
      // File may not exist (e.g. in test context); proceed with UI update
    }
    remove(tool);
    setSelectedTool(null);
  };

  const visibleItems = items.filter(
    (t) => t.scope === "global" || (t.scope === "project" && t.projectSlug === projectSlug),
  );

  if (visibleItems.length === 0) return null;

  return (
    <>
      {visibleItems.map((tool) => (
        <div
          key={`${tool.scope}:${tool.projectSlug ?? "global"}:${tool.name}`}
          data-testid={`pending-tool-banner-${tool.name}`}
          style={{
            borderRadius: "var(--r-md)",
            background: "var(--accent-soft)",
            border: "1px solid var(--accent-line)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 12px",
          }}
        >
          <IconBolt size={14} strokeColor="var(--accent)" />
          <span className="chip chip--accent">
            {tool.scope === "project" ? "project tool" : "tool"}
          </span>
          <span style={{ flex: 1, fontSize: 12, color: "var(--ink-2)" }}>
            Agent proposed a new tool: <strong>{tool.name}</strong>
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid={`review-tool-btn-${tool.name}`}
            onClick={() => setSelectedTool(tool)}
          >
            Review
          </button>
        </div>
      ))}
      {selectedTool && (
        <PendingToolModal
          tool={selectedTool}
          onApprove={() => handleApprove(selectedTool)}
          onReject={() => handleReject(selectedTool)}
          onClose={() => setSelectedTool(null)}
        />
      )}
    </>
  );
}
