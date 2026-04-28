import { contextBridge, ipcRenderer } from "electron";
import { IPC, type IpcChannel } from "../shared/ipc-channels";

const ALLOWED_CHANNELS = Object.values(IPC) as IpcChannel[];

function assertAllowed(channel: string): asserts channel is IpcChannel {
  if (!ALLOWED_CHANNELS.includes(channel as IpcChannel)) {
    throw new Error(`[preload] Channel "${channel}" is not whitelisted`);
  }
}

// Parallel listener registry used by _simulateEvent in tests.
// Populated only when PLAYWRIGHT_TEST=1.
const _testListeners = new Map<string, Array<(data: unknown) => void>>();

const isTestMode = process.env["PLAYWRIGHT_TEST"] === "1";

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
      const list = _testListeners.get(channel);
      if (list) {
        const idx = list.indexOf(callback);
        if (idx !== -1) list.splice(idx, 1);
      }
    };
  },
};

const api = isTestMode
  ? {
      ...baseApi,
      _simulateEvent(channel: string, payload: unknown): void {
        const list = _testListeners.get(channel) ?? [];
        for (const cb of list) cb(payload);
      },
    }
  : baseApi;

contextBridge.exposeInMainWorld("electronAPI", api);
