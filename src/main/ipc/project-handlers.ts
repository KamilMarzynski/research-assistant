import { type BrowserWindow, dialog, ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import type { EventBus } from "../event-bus";
import {
  CreateProjectSchema,
  DeleteProjectSchema,
  LinkFolderSchema,
  RenameProjectSchema,
  SetProjectApprovalLevelSchema,
  SetProjectModelSchema,
  UnlinkFolderSchema,
} from "../ipc-validation";
import type {
  ProjectApprovalLevelUpdateResult,
  ProjectApprovalResolver,
  ProjectService,
} from "../services/ProjectService";
import { parseOrThrow } from "./parse-util";
import type { SessionManager } from "./session-manager";
import { wrapIpc } from "./wrap-ipc";

export function registerProjectHandlers(
  win: BrowserWindow,
  deps: {
    projectService: ProjectService;
    approvalResolver: ProjectApprovalResolver;
    sessionManager: SessionManager;
    eventBus: EventBus;
  },
): void {
  const { projectService, approvalResolver, sessionManager, eventBus } = deps;

  ipcMain.handle(IPC.GET_PROJECTS, () => wrapIpc(() => projectService.listProjects()));

  ipcMain.handle(IPC.CREATE_PROJECT, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const p = parseOrThrow(CreateProjectSchema, payload, "CREATE_PROJECT");
      return projectService.createProject(p.name, p.folderPath);
    }),
  );

  ipcMain.handle(IPC.RENAME_PROJECT, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const { id, name } = parseOrThrow(RenameProjectSchema, payload, "RENAME_PROJECT");
      if (!name.trim()) throw new Error("Name cannot be empty");
      await projectService.renameProject(id, name.trim());
    }),
  );

  ipcMain.handle(IPC.DELETE_PROJECT, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const { id } = parseOrThrow(DeleteProjectSchema, payload, "DELETE_PROJECT");
      await projectService.deleteProject(id);
      sessionManager.delete(id);
    }),
  );

  ipcMain.handle(IPC.LINK_FOLDER, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const { projectId, folderPath } = parseOrThrow(LinkFolderSchema, payload, "LINK_FOLDER");
      await projectService.linkFolder(projectId, folderPath);
      sessionManager.delete(projectId);
    }),
  );

  ipcMain.handle(IPC.UNLINK_FOLDER, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const { id } = parseOrThrow(UnlinkFolderSchema, payload, "UNLINK_FOLDER");
      await projectService.unlinkFolder(id);
    }),
  );

  ipcMain.handle(IPC.SET_PROJECT_MODEL, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const { projectId, modelOverride } = parseOrThrow(
        SetProjectModelSchema,
        payload,
        "SET_PROJECT_MODEL",
      );
      await projectService.setModelOverride(projectId, modelOverride);
      sessionManager.delete(projectId);
    }),
  );

  ipcMain.handle(IPC.SET_PROJECT_APPROVAL_LEVEL, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const { projectId, approvalLevel } = parseOrThrow(
        SetProjectApprovalLevelSchema,
        payload,
        "SET_PROJECT_APPROVAL_LEVEL",
      );

      const result = await projectService.transitionApprovalLevel(
        projectId,
        approvalLevel,
        approvalResolver,
      );
      if (shouldEmitAutoResolvedEvent(result)) {
        eventBus.emit({
          type: "approvals:auto_resolved",
          payload: { projectId },
        });
      }
    }),
  );

  ipcMain.handle(IPC.OPEN_FOLDER_DIALOG, () =>
    wrapIpc(async () => {
      const result = await dialog.showOpenDialog(win, {
        properties: ["openDirectory", "createDirectory"],
        title: "Select or create project folder",
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    }),
  );
}

function shouldEmitAutoResolvedEvent(result: ProjectApprovalLevelUpdateResult): boolean {
  return result.approvalsAutoResolved;
}
