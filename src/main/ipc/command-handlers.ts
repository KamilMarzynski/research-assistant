import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { ResolveBlockedCommandSchema } from "../ipc-validation";
import { parseOrThrow } from "./parse-util";

export function registerCommandHandlers(_win: Electron.BrowserWindow): void {
  ipcMain.handle(IPC.RESOLVE_BLOCKED_COMMAND, async (_event, payload: unknown) => {
    const { commandId, action, projectId } = parseOrThrow(
      ResolveBlockedCommandSchema,
      payload,
      "RESOLVE_BLOCKED_COMMAND",
    );
    const { resolveBlockedCommand } = await import("../agent/extensions/safe-bash");
    resolveBlockedCommand(commandId, action, projectId);
  });
}
