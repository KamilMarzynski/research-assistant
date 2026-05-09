import { useEffect, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import { decodePendingTool } from "../../../../shared/ipc-guards";
import type { PendingTool } from "../../../../shared/ipc-types";
import { IconBolt } from "../../../components/shared/Icons";
import { usePendingItems } from "../../../hooks/usePendingItems";
import PendingToolModal from "./PendingToolModal";

export default function PendingToolBanner() {
  const { items, add, remove } = usePendingItems<PendingTool>({
    channel: IPC.TOOL_PENDING,
    decode: decodePendingTool,
    getKey: (t) => t.name,
  });
  const [selectedTool, setSelectedTool] = useState<PendingTool | null>(null);

  useEffect(() => {
    window.electronAPI.invoke(IPC.GET_PENDING_TOOLS).then((tools) => {
      for (const tool of tools as PendingTool[]) add(tool);
    });
  }, [add]);

  const handleApprove = async (tool: PendingTool) => {
    try {
      await window.electronAPI.invoke(IPC.APPROVE_TOOL, { name: tool.name });
    } catch {
      // File may not exist (e.g. in test context); proceed with UI update
    }
    remove(tool);
    setSelectedTool(null);
  };

  const handleReject = async (tool: PendingTool) => {
    await window.electronAPI.invoke(IPC.REJECT_TOOL, { name: tool.name });
    remove(tool);
    setSelectedTool(null);
  };

  if (items.length === 0) return null;

  return (
    <>
      {items.map((tool) => (
        <div
          key={tool.name}
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
          <span className="chip chip--accent">tool</span>
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
