import type { BrowserWindow } from "electron";
import type { IpcPushEvent } from "../../shared/ipc-types";

export function emitPush(win: BrowserWindow, event: IpcPushEvent): void {
  win.webContents.send(event.type, event);
}
