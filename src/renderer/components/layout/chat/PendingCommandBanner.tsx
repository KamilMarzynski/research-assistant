import { useEffect, useState } from "react";
import { IPC } from "../../../../shared/ipc-channels";
import { decodeBlockedCommandPayload } from "../../../../shared/ipc-guards";
import type { BlockedCommandPayload } from "../../../../shared/ipc-types";
import type { Project } from "../../../../shared/types";
import { IconAlert } from "../../../components/shared/Icons";
import { usePendingItems } from "../../../hooks/usePendingItems";
import { ipc } from "../../../lib/ipc-client";
import PendingCommandModal from "./PendingCommandModal";

interface Props {
  activeProjectId: string | null;
  projects: Project[];
}

export default function PendingCommandBanner({ activeProjectId, projects }: Props) {
  const { items, remove, clearWhere } = usePendingItems<BlockedCommandPayload>({
    channel: IPC.BASH_BLOCKED,
    decode: decodeBlockedCommandPayload,
    getKey: (c) => c.commandId,
  });
  const [selected, setSelected] = useState<BlockedCommandPayload | null>(null);

  useEffect(() => {
    return ipc.on(IPC.APPROVALS_AUTO_RESOLVED, (event) => {
      clearWhere((item) => item.projectId === event.projectId);
      setSelected((current) => (current?.projectId === event.projectId ? null : current));
    });
  }, [clearWhere]);

  const handleResolve = async (
    cmd: BlockedCommandPayload,
    action: "approve_once" | "approve_session" | "deny",
  ) => {
    try {
      await ipc.invoke(IPC.RESOLVE_BLOCKED_COMMAND, {
        commandId: cmd.commandId,
        action,
        projectId: cmd.projectId,
      });
    } catch {
      // Handler may throw if commandId already resolved
    }
    remove(cmd);
    setSelected(null);
  };

  if (items.length === 0) return null;

  return (
    <>
      {items.map((cmd) => (
        <div
          key={cmd.commandId}
          data-testid={`pending-command-banner-${cmd.key}`}
          style={{
            borderRadius: "var(--r-md)",
            background: "var(--danger-soft)",
            border: "1px solid oklch(0.82 0.07 25)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 12px",
          }}
        >
          <IconAlert size={14} strokeColor="var(--danger)" />
          <span className="chip chip--danger">destructive</span>
          <span style={{ flex: 1, fontSize: 12, color: "var(--ink-2)" }}>
            {cmd.projectId !== activeProjectId && (
              <span style={{ color: "var(--ink-3)", marginRight: 6 }}>
                [{projects.find((p) => p.id === cmd.projectId)?.name ?? "background"}]
              </span>
            )}
            Blocked command: <strong>{cmd.command}</strong> — {cmd.reason}
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid={`review-command-btn-${cmd.key}`}
            onClick={() => setSelected(cmd)}
          >
            Review
          </button>
        </div>
      ))}
      {selected && (
        <PendingCommandModal
          command={selected}
          onApproveOnce={() => handleResolve(selected, "approve_once")}
          onApproveSession={() => handleResolve(selected, "approve_session")}
          onDeny={() => handleResolve(selected, "deny")}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
