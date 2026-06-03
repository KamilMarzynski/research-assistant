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

function categoryLevel(category: string): "danger" | "warn" {
  // Only destructive commands and privilege escalation warrant a red banner.
  // Everything else (exfiltration, persistence, unsafe_operator, unknown_binary)
  // is an allowlist gate — the command is blocked, not genuinely dangerous.
  if (category === "destructive" || category === "privilege_escalation") {
    return "danger";
  }
  return "warn";
}

const LEVEL_STYLES = {
  danger: {
    bg: "var(--danger-soft)",
    border: "oklch(0.82 0.07 25)",
    iconColor: "var(--danger)",
    chipClass: "chip chip--danger",
  },
  warn: {
    bg: "var(--warn-soft)",
    border: "oklch(0.82 0.06 75)",
    iconColor: "var(--warn)",
    chipClass: "chip chip--warn",
  },
} as const;

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
    denyReason?: string,
  ) => {
    try {
      await ipc.invoke(IPC.RESOLVE_BLOCKED_COMMAND, {
        commandId: cmd.commandId,
        action,
        projectId: cmd.projectId,
        denyReason,
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
      {items.map((cmd) => {
        const level = categoryLevel(cmd.category);
        const style = LEVEL_STYLES[level];
        return (
          <div
            key={cmd.commandId}
            data-testid={`pending-command-banner-${cmd.key}`}
            style={{
              borderRadius: "var(--r-md)",
              background: style.bg,
              border: `1px solid ${style.border}`,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 12px",
            }}
          >
            <IconAlert size={14} strokeColor={style.iconColor} />
            <span className={style.chipClass}>{cmd.category.replace("_", " ")}</span>
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
        );
      })}
      {selected && (
        <PendingCommandModal
          command={selected}
          projectName={projects.find((p) => p.id === selected.projectId)?.name ?? "background"}
          onApproveOnce={() => handleResolve(selected, "approve_once")}
          onApproveSession={() => handleResolve(selected, "approve_session")}
          onDeny={(feedback) => handleResolve(selected, "deny", feedback)}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
