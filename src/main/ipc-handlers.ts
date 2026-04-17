import { type BrowserWindow, ipcMain } from "electron";
import { IPC } from "../shared/ipc-channels";

export function registerIpcHandlers(_win: BrowserWindow): void {
  ipcMain.handle(IPC.GET_PROJECTS, (_event, payload: unknown) => {
    console.log("[IPC] GET_PROJECTS called with:", payload);
    return [];
  });

  ipcMain.handle(IPC.CREATE_PROJECT, (_event, payload: unknown) => {
    console.log("[IPC] CREATE_PROJECT called with:", payload);
    return {
      id: "mock-1",
      name: "Mock Project",
      createdAt: new Date().toISOString(),
    };
  });

  ipcMain.handle(IPC.GET_ARTIFACTS, (_event, payload: unknown) => {
    console.log("[IPC] GET_ARTIFACTS called with:", payload);
    return [];
  });

  ipcMain.on(IPC.SEND_MESSAGE, (_event, payload: unknown) => {
    console.log("[IPC] SEND_MESSAGE called with:", payload);
    // TODO(run-5): route to OpenRouter via Mastra agent, stream chunks back via MESSAGE_CHUNK
  });
}
