import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { ApproveRejectToolSchema, DeleteSkillSchema, ToggleSkillSchema } from "../ipc-validation";
import type { HomeService } from "../services/HomeService";
import { parseOrThrow } from "./parse-util";

export function registerAdminHandlers(
  _win: Electron.BrowserWindow,
  deps: { homeService: HomeService },
): void {
  const { homeService } = deps;

  ipcMain.handle(IPC.GET_PENDING_TOOLS, async () => {
    return homeService.getPendingTools();
  });

  ipcMain.handle(IPC.APPROVE_TOOL, async (_event, payload: unknown) => {
    const { name } = parseOrThrow(ApproveRejectToolSchema, payload, "APPROVE_TOOL");
    await homeService.approvePendingTool(name);
  });

  ipcMain.handle(IPC.REJECT_TOOL, async (_event, payload: unknown) => {
    const { name } = parseOrThrow(ApproveRejectToolSchema, payload, "REJECT_TOOL");
    await homeService.rejectPendingTool(name);
  });

  ipcMain.handle(IPC.GET_SKILLS, async () => {
    return homeService.getSkills();
  });

  ipcMain.handle(IPC.TOGGLE_SKILL, async (_event, payload: unknown) => {
    const p = parseOrThrow(ToggleSkillSchema, payload, "TOGGLE_SKILL");
    await homeService.toggleSkill(p.name, p.enabled);
  });

  ipcMain.handle(IPC.DELETE_SKILL, async (_event, payload: unknown) => {
    const { name } = parseOrThrow(DeleteSkillSchema, payload, "DELETE_SKILL");
    await homeService.deleteSkill(name);
  });

  ipcMain.handle(IPC.GET_AUDIT_LOG, async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const path = join(homeService.getHomePath(), "audit.log");
    try {
      const raw = await readFile(path, "utf-8");
      return raw
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    } catch {
      return [];
    }
  });

  ipcMain.handle(IPC.CLEAR_AUDIT_LOG, async () => {
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const path = join(homeService.getHomePath(), "audit.log");
    await writeFile(path, "", "utf-8");
  });
}
