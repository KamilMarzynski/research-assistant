import { useCallback, useEffect, useState } from "react";
import type { AuditLogEntry } from "../../shared/ipc-channels";
import { IPC } from "../../shared/ipc-channels";

export interface AuditLogState {
  entries: AuditLogEntry[];
  filter: "all" | "executed" | "blocked";
  setFilter: (v: "all" | "executed" | "blocked") => void;
  load: () => Promise<void>;
  clear: () => Promise<void>;
}

export function useAuditLog(enabled: boolean): AuditLogState {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [filter, setFilter] = useState<"all" | "executed" | "blocked">("all");

  const load = useCallback(async () => {
    const result = await window.electronAPI.invoke(IPC.GET_AUDIT_LOG);
    setEntries(result);
  }, []);

  const clear = useCallback(async () => {
    await window.electronAPI.invoke(IPC.CLEAR_AUDIT_LOG);
    setEntries([]);
  }, []);

  useEffect(() => {
    if (enabled) {
      void load();
    }
  }, [enabled, load]);

  return { entries, filter, setFilter, load, clear };
}
