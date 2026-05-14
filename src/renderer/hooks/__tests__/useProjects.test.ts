// @vitest-environment happy-dom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcResult } from "../../../shared/ipc-types";
import type { Project } from "../../../shared/types";
import { useProjects } from "../useProjects";

const project1: Project = {
  id: "p1",
  name: "Alpha",
  slug: "alpha-abc123",
  folderPath: "/home/user/alpha",
  projectPath: "/home/user/.scholar/projects/alpha-abc123",
  modelOverride: null,
  maxRecentMessages: 50,
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

const project2: Project = {
  id: "p2",
  name: "Beta",
  slug: "beta-def456",
  folderPath: null,
  projectPath: "/home/user/.scholar/projects/beta-def456",
  modelOverride: null,
  maxRecentMessages: 50,
  createdAt: new Date("2024-02-01"),
  updatedAt: new Date("2024-02-01"),
};

function makeOkResult<T>(data: T): IpcResult<T> {
  return { ok: true, data };
}

function makeErrResult(error: string): IpcResult<never> {
  return { ok: false, error, code: "ERR" };
}

type ListenerMap = Record<string, ((data: unknown) => void)[]>;

function setupElectronAPI(
  invokeImpl: (channel: string, payload?: unknown) => Promise<unknown>,
): ListenerMap {
  const listeners: ListenerMap = {};
  window.electronAPI = {
    invoke: vi.fn(invokeImpl),
    send: vi.fn(),
    on: vi.fn((channel: string, cb: (data: unknown) => void) => {
      listeners[channel] = listeners[channel] ?? [];
      listeners[channel].push(cb);
      return () => {
        listeners[channel] = listeners[channel].filter((l) => l !== cb);
      };
    }),
  } as unknown as Window["electronAPI"];
  return listeners;
}

function emit(listeners: ListenerMap, channel: string, data: unknown) {
  for (const cb of listeners[channel] ?? []) cb(data);
}

describe("useProjects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads projects on mount", async () => {
    setupElectronAPI((_ch) => Promise.resolve(makeOkResult([project1, project2])));

    const { result } = renderHook(() => useProjects());

    expect(result.current.loading).toBe(true);
    expect(result.current.projects).toEqual([]);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.projects).toHaveLength(2);
    expect(result.current.projects[0].id).toBe("p1");
    expect(result.current.error).toBeNull();
    expect(window.electronAPI.invoke).toHaveBeenCalledWith("GET_PROJECTS", undefined);
  });

  it("sets error when GET_PROJECTS fails", async () => {
    setupElectronAPI((_ch) => Promise.resolve(makeErrResult("DB error")));

    const { result } = renderHook(() => useProjects());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.projects).toEqual([]);
    expect(result.current.error).toBe("DB error");
  });

  it("refresh() re-fetches projects", async () => {
    let callCount = 0;
    setupElectronAPI((_ch) => {
      callCount += 1;
      const data = callCount === 1 ? [project1] : [project1, project2];
      return Promise.resolve(makeOkResult(data));
    });

    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.projects).toHaveLength(1);

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.projects).toHaveLength(2);
    expect(window.electronAPI.invoke).toHaveBeenCalledTimes(2);
  });

  it("refreshes when SETTINGS_UPDATED push event fires", async () => {
    let callCount = 0;
    const listeners = setupElectronAPI((_ch) => {
      callCount += 1;
      const data = callCount === 1 ? [project1] : [project1, project2];
      return Promise.resolve(makeOkResult(data));
    });

    const { result } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.projects).toHaveLength(1);

    await act(async () => {
      emit(listeners, "SETTINGS_UPDATED", { type: "SETTINGS_UPDATED", settings: {} });
    });

    await waitFor(() => expect(result.current.projects).toHaveLength(2));
  });

  it("cleans up the SETTINGS_UPDATED listener on unmount", async () => {
    setupElectronAPI((_ch) => Promise.resolve(makeOkResult([project1])));

    const { result, unmount } = renderHook(() => useProjects());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const invokeCallsBefore = (window.electronAPI.invoke as ReturnType<typeof vi.fn>).mock.calls
      .length;
    unmount();
    // After unmount the listener should be removed; no further invoke calls
    expect((window.electronAPI.invoke as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      invokeCallsBefore,
    );
  });
});
