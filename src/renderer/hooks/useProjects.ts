import { useCallback, useEffect, useState } from "react";
import { IPC } from "../../shared/ipc-channels";
import type { Project } from "../../shared/types";
import { ipc } from "../lib/ipc-client";

export interface UseProjectsResult {
  projects: Project[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await ipc.invoke(IPC.GET_PROJECTS);
      setProjects(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();

    // NOTE: IpcPushEvent does not define a dedicated NEW_PROJECT push event yet.
    // SETTINGS_UPDATED is the closest available signal — it fires after any
    // settings change (including model overrides per project), so we piggyback
    // on it to keep the project list fresh. When a proper NEW_PROJECT event is
    // added to IpcPushEvent in ipc-types.ts, subscribe to that instead.
    const unsub = ipc.on(IPC.SETTINGS_UPDATED, () => {
      void refresh();
    });

    return unsub;
  }, [refresh]);

  return { projects, loading, error, refresh };
}
