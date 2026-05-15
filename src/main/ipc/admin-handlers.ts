import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import {
  ApproveRejectProjectToolSchema,
  ApproveRejectToolSchema,
  DeleteSkillSchema,
  GetProjectPendingToolsSchema,
  ToggleSkillSchema,
} from "../ipc-validation";
import type { HomeService } from "../services/HomeService";
import type { SkillManagementService } from "../services/SkillManagementService";
import type { ToolApprovalService } from "../services/ToolApprovalService";
import { parseOrThrow } from "./parse-util";
import { wrapIpc } from "./wrap-ipc";

export function registerAdminHandlers(
  _win: Electron.BrowserWindow,
  deps: {
    homeService: HomeService;
    toolApprovalService: ToolApprovalService;
    skillManagementService: SkillManagementService;
  },
): void {
  const { homeService, toolApprovalService, skillManagementService } = deps;

  ipcMain.handle(IPC.GET_PENDING_TOOLS, () =>
    wrapIpc(async () => {
      return toolApprovalService.getPendingTools();
    }),
  );

  ipcMain.handle(IPC.APPROVE_TOOL, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const { name } = parseOrThrow(ApproveRejectToolSchema, payload, "APPROVE_TOOL");
      await toolApprovalService.approvePendingTool(name);
    }),
  );

  ipcMain.handle(IPC.REJECT_TOOL, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const { name } = parseOrThrow(ApproveRejectToolSchema, payload, "REJECT_TOOL");
      await toolApprovalService.rejectPendingTool(name);
    }),
  );

  ipcMain.handle(IPC.GET_PROJECT_PENDING_TOOLS, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const { projectSlug } = parseOrThrow(
        GetProjectPendingToolsSchema,
        payload,
        "GET_PROJECT_PENDING_TOOLS",
      );
      return toolApprovalService.getProjectPendingTools(projectSlug);
    }),
  );

  ipcMain.handle(IPC.APPROVE_PROJECT_TOOL, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const { projectSlug, name } = parseOrThrow(
        ApproveRejectProjectToolSchema,
        payload,
        "APPROVE_PROJECT_TOOL",
      );
      await toolApprovalService.approveProjectPendingTool(projectSlug, name);
    }),
  );

  ipcMain.handle(IPC.REJECT_PROJECT_TOOL, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const { projectSlug, name } = parseOrThrow(
        ApproveRejectProjectToolSchema,
        payload,
        "REJECT_PROJECT_TOOL",
      );
      await toolApprovalService.rejectProjectPendingTool(projectSlug, name);
    }),
  );

  ipcMain.handle(IPC.GET_SKILLS, () =>
    wrapIpc(async () => {
      return skillManagementService.getSkills();
    }),
  );

  ipcMain.handle(IPC.TOGGLE_SKILL, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const p = parseOrThrow(ToggleSkillSchema, payload, "TOGGLE_SKILL");
      await skillManagementService.toggleSkill(p.name, p.enabled);
    }),
  );

  ipcMain.handle(IPC.DELETE_SKILL, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const { name } = parseOrThrow(DeleteSkillSchema, payload, "DELETE_SKILL");
      await skillManagementService.deleteSkill(name);
    }),
  );

  ipcMain.handle(IPC.GET_AUDIT_LOG, () =>
    wrapIpc(async () => {
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
    }),
  );

  ipcMain.handle(IPC.CLEAR_AUDIT_LOG, () =>
    wrapIpc(async () => {
      const path = join(homeService.getHomePath(), "audit.log");
      await writeFile(path, "", "utf-8");
    }),
  );
}
