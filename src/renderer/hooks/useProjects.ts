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
  }, [refresh]);

  return { projects, loading, error, refresh };
}
