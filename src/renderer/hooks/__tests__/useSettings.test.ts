// @vitest-environment happy-dom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcResult, SettingsResponse } from "../../../shared/ipc-types";
import { useSettings } from "../useSettings";

const mockSettings: SettingsResponse = {
  hasApiKey: true,
  activeProvider: "openrouter",
  defaultCloudProvider: "openrouter",
  providerCredentials: {
    openrouter: { apiKey: "key-123", defaultModel: "gpt-4o" },
    openai: { apiKey: null, defaultModel: "gpt-4o" },
    anthropic: { apiKey: null, defaultModel: "claude-3-5-sonnet-20241022" },
    ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
  },
  langfuseEnabled: false,
  webAccessEnabled: true,
  theme: "system",
};

function makeOkResult<T>(data: T): IpcResult<T> {
  return { ok: true, data };
}

function makeErrResult(error: string): IpcResult<never> {
  return { ok: false, error, code: "ERR" };
}

function setupElectronAPI(invokeImpl: (channel: string, payload?: unknown) => Promise<unknown>) {
  window.electronAPI = {
    invoke: vi.fn(invokeImpl),
    send: vi.fn(),
    on: vi.fn().mockReturnValue(() => {}),
  } as unknown as Window["electronAPI"];
}

describe("useSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads settings on mount", async () => {
    setupElectronAPI((_ch) => Promise.resolve(makeOkResult(mockSettings)));

    const { result } = renderHook(() => useSettings());

    expect(result.current.loading).toBe(true);
    expect(result.current.settings).toBeNull();

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.settings).toEqual(mockSettings);
    expect(result.current.error).toBeNull();
    expect(window.electronAPI.invoke).toHaveBeenCalledWith("GET_SETTINGS", undefined);
  });

  it("sets error when GET_SETTINGS fails", async () => {
    setupElectronAPI((_ch) => Promise.resolve(makeErrResult("Server error")));

    const { result } = renderHook(() => useSettings());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.settings).toBeNull();
    expect(result.current.error).toBe("Server error");
  });

  it("refresh() re-fetches settings", async () => {
    const updatedSettings: SettingsResponse = {
      ...mockSettings,
      theme: "dark",
    };

    let callCount = 0;
    setupElectronAPI((_ch) => {
      callCount += 1;
      const data = callCount === 1 ? mockSettings : updatedSettings;
      return Promise.resolve(makeOkResult(data));
    });

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.settings?.theme).toBe("system");

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.settings?.theme).toBe("dark");
    expect(window.electronAPI.invoke).toHaveBeenCalledTimes(2);
  });

  it("saveSettings calls SAVE_SETTINGS invoke with the given payload", async () => {
    setupElectronAPI((ch) => {
      if (ch === "GET_SETTINGS") return Promise.resolve(makeOkResult(mockSettings));
      if (ch === "SAVE_SETTINGS") return Promise.resolve(makeOkResult(undefined));
      return Promise.resolve(makeOkResult(undefined));
    });

    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const payload = { theme: "dark" as const };
    await act(async () => {
      await result.current.saveSettings(payload);
    });

    expect(window.electronAPI.invoke).toHaveBeenCalledWith("SAVE_SETTINGS", payload);
  });
});
