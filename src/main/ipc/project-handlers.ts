import { type BrowserWindow, dialog, ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import {
  CreateProjectSchema,
  DeleteProjectSchema,
  LinkFolderSchema,
  RenameProjectSchema,
  UnlinkFolderSchema,
} from "../ipc-validation";
import type { ProjectService } from "../services/ProjectService";
import { parseOrThrow } from "./parse-util";
import type { SessionManager } from "./session-manager";

export function registerProjectHandlers(
  win: BrowserWindow,
  deps: {
    projectService: ProjectService;
    sessionManager: SessionManager;
  },
): void {
  const { projectService, sessionManager } = deps;

  ipcMain.handle(IPC.GET_PROJECTS, async () => projectService.listProjects());

  ipcMain.handle(IPC.CREATE_PROJECT, async (_event, payload: unknown) => {
    const p = parseOrThrow(CreateProjectSchema, payload, "CREATE_PROJECT");
    return projectService.createProject(p.name, p.folderPath);
  });

  ipcMain.handle(IPC.RENAME_PROJECT, async (_event, payload: unknown) => {
    const { id, name } = parseOrThrow(RenameProjectSchema, payload, "RENAME_PROJECT");
    if (!name.trim()) throw new Error("Name cannot be empty");
    await projectService.renameProject(id, name.trim());
  });

  ipcMain.handle(IPC.DELETE_PROJECT, async (_event, payload: unknown) => {
    const { id } = parseOrThrow(DeleteProjectSchema, payload, "DELETE_PROJECT");
    await projectService.deleteProject(id);
  });

  ipcMain.handle(IPC.LINK_FOLDER, async (_event, payload: unknown) => {
    const { projectId, folderPath } = parseOrThrow(LinkFolderSchema, payload, "LINK_FOLDER");
    await projectService.linkFolder(projectId, folderPath);
    sessionManager.delete(projectId);
  });

  ipcMain.handle(IPC.UNLINK_FOLDER, async (_event, payload: unknown) => {
    const { id } = parseOrThrow(UnlinkFolderSchema, payload, "UNLINK_FOLDER");
    await projectService.unlinkFolder(id);
  });

  ipcMain.handle(IPC.OPEN_FOLDER_DIALOG, async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory", "createDirectory"],
      title: "Select or create project folder",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
}
