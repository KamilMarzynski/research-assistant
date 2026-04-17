import { contextBridge, ipcRenderer } from "electron"
import { IPC, type IpcChannel } from "../shared/ipc-channels"

const ALLOWED_CHANNELS = Object.values(IPC) as IpcChannel[]

function assertAllowed(channel: string): asserts channel is IpcChannel {
  if (!ALLOWED_CHANNELS.includes(channel as IpcChannel)) {
    throw new Error(`[preload] Channel "${channel}" is not whitelisted`)
  }
}

contextBridge.exposeInMainWorld("electronAPI", {
  send(channel: string, data?: unknown): void {
    assertAllowed(channel)
    ipcRenderer.send(channel, data)
  },

  invoke(channel: string, data?: unknown): Promise<unknown> {
    assertAllowed(channel)
    return ipcRenderer.invoke(channel, data)
  },

  on(channel: string, callback: (data: unknown) => void): () => void {
    assertAllowed(channel)
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
})
