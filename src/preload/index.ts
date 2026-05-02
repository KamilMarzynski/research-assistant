import { randomUUID } from "node:crypto";
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type IpcChannel } from "../shared/ipc-channels";

const ALLOWED_CHANNELS = Object.values(IPC) as IpcChannel[];

function assertAllowed(channel: string): asserts channel is IpcChannel {
  if (!ALLOWED_CHANNELS.includes(channel as IpcChannel)) {
    throw new Error(`[preload] Channel "${channel}" is not whitelisted`);
  }
}

// Parallel listener registry used by _simulateEvent in tests.
// Populated only when NODE_ENV === "test".
const _testListeners = new Map<string, Array<(data: unknown) => void>>();

const isTestMode = process.env.NODE_ENV === "test";

const baseApi = {
  send(channel: IpcChannel, data?: unknown): void {
    assertAllowed(channel);
    ipcRenderer.send(channel, data);
  },

  invoke(channel: IpcChannel, data?: unknown): Promise<unknown> {
    assertAllowed(channel);
    return ipcRenderer.invoke(channel, data);
  },

  on(channel: IpcChannel, callback: (data: unknown) => void): () => void {
    assertAllowed(channel);
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
    ipcRenderer.on(channel, handler);

    if (isTestMode) {
      const list = _testListeners.get(channel) ?? [];
      list.push(callback);
      _testListeners.set(channel, list);
    }

    return () => {
      ipcRenderer.removeListener(channel, handler);
      if (isTestMode) {
        const list = _testListeners.get(channel);
        if (list) {
          const idx = list.indexOf(callback);
          if (idx !== -1) list.splice(idx, 1);
        }
      }
    };
  },

  generateUuid(): string {
    return randomUUID();
  },
};

const api = isTestMode
  ? {
      ...baseApi,
      _simulateEvent(channel: IpcChannel, payload: unknown): void {
        assertAllowed(channel);
        const list = _testListeners.get(channel) ?? [];
        for (const cb of list) cb(payload);
      },
    }
  : baseApi;

contextBridge.exposeInMainWorld("electronAPI", api);
