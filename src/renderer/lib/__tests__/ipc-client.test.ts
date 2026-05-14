import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcResult } from "../../../shared/ipc-types";
import { IpcClient } from "../ipc-client";

const mockElectronAPI = {
  invoke: vi.fn(),
  on: vi.fn(),
  send: vi.fn(),
  generateUuid: vi.fn(() => "uuid"),
};

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    value: { electronAPI: mockElectronAPI },
    writable: true,
  });
  vi.clearAllMocks();
});

describe("IpcClient.invoke", () => {
  it("returns data when ok", async () => {
    const result: IpcResult<string[]> = { ok: true, data: ["a", "b"] };
    mockElectronAPI.invoke.mockResolvedValue(result);
    const client = new IpcClient();
    const data = await client.invoke("GET_PROJECTS");
    expect(data).toEqual(["a", "b"]);
    expect(mockElectronAPI.invoke).toHaveBeenCalledWith("GET_PROJECTS", undefined);
  });

  it("throws when not ok", async () => {
    const result: IpcResult<never> = { ok: false, error: "Not found", code: "NOT_FOUND" };
    mockElectronAPI.invoke.mockResolvedValue(result);
    const client = new IpcClient();
    await expect(client.invoke("GET_PROJECTS")).rejects.toThrow("Not found");
  });

  it("passes payload to electronAPI", async () => {
    const result: IpcResult<unknown> = { ok: true, data: undefined };
    mockElectronAPI.invoke.mockResolvedValue(result);
    const client = new IpcClient();
    await client.invoke("GET_MESSAGES", { projectId: "p1" });
    expect(mockElectronAPI.invoke).toHaveBeenCalledWith("GET_MESSAGES", { projectId: "p1" });
  });
});

describe("IpcClient.on", () => {
  it("subscribes and returns unsubscribe", () => {
    const unsub = vi.fn(() => {});
    mockElectronAPI.on.mockReturnValue(unsub);
    const client = new IpcClient();
    const handler = vi.fn();
    const off = client.on("AGENT_PROGRESS", handler);
    expect(mockElectronAPI.on).toHaveBeenCalledWith("AGENT_PROGRESS", expect.any(Function));
    off();
    expect(unsub).toHaveBeenCalled();
  });

  it("calls handler with narrowed event", () => {
    let capturedCallback: ((data: unknown) => void) | undefined;
    mockElectronAPI.on.mockImplementation((_ch: string, cb: (data: unknown) => void) => {
      capturedCallback = cb;
      return vi.fn();
    });
    const client = new IpcClient();
    const handler = vi.fn();
    client.on("MESSAGE_CHUNK", handler);
    const event = { type: "MESSAGE_CHUNK", projectId: "p1", delta: "hello" };
    capturedCallback?.(event);
    expect(handler).toHaveBeenCalledWith(event);
  });
});
