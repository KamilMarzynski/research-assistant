import { useCallback, useEffect, useState } from "react";
import { IPC } from "../../shared/ipc-channels";
import type { IpcRequestMap, SettingsResponse } from "../../shared/ipc-types";
import { ipc } from "../lib/ipc-client";

export interface UseSettingsResult {
  settings: SettingsResponse | null;
  loading: boolean;
  error: string | null;
  saveSettings: (payload: IpcRequestMap["SAVE_SETTINGS"]) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await ipc.invoke(IPC.GET_SETTINGS);
      setSettings(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  const saveSettings = useCallback(async (payload: IpcRequestMap["SAVE_SETTINGS"]) => {
    await ipc.invoke(IPC.SAVE_SETTINGS, payload);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { settings, loading, error, saveSettings, refresh };
}
