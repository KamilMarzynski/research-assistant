import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { ProjectIdSchema, RetryResearchSchema } from "../ipc-validation";
import type { ProjectService } from "../services/ProjectService";
import type { ResearchService } from "../services/ResearchService";
import type { TaskPersistenceService } from "../services/TaskPersistenceService";
import { parseOrThrow } from "./parse-util";
import { wrapIpc } from "./wrap-ipc";

export function registerResearchHandlers(
  _win: Electron.BrowserWindow,
  deps: {
    projectService: ProjectService;
    researchService: ResearchService;
    taskPersistenceService: TaskPersistenceService;
  },
): void {
  const { projectService, researchService, taskPersistenceService } = deps;

  ipcMain.handle(IPC.GET_RESEARCHES, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const { projectId } = parseOrThrow(ProjectIdSchema, payload, "GET_RESEARCHES");
      return taskPersistenceService.getTasksByProject(projectId);
    }),
  );

  ipcMain.handle(IPC.RETRY_RESEARCH, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const { projectId, query: brief } = parseOrThrow(
        RetryResearchSchema,
        payload,
        "RETRY_RESEARCH",
      );
      let project: Awaited<ReturnType<typeof projectService.getProject>>;
      try {
        project = await projectService.getProject(projectId);
      } catch {
        throw new Error(`Project not found: ${projectId}`);
      }
      return researchService.startResearch(
        projectId,
        project.name,
        brief,
        project.folderPath,
        project.projectPath,
      );
    }),
  );
}
