import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { ProjectIdSchema, RetryResearchSchema } from "../ipc-validation";
import type { HomeService } from "../services/HomeService";
import type { ProjectService } from "../services/ProjectService";
import type { ResearchService } from "../services/ResearchService";
import { parseOrThrow } from "./parse-util";
import { wrapIpc } from "./wrap-ipc";

export function registerResearchHandlers(
  _win: Electron.BrowserWindow,
  deps: {
    projectService: ProjectService;
    researchService: ResearchService;
    homeService: HomeService;
  },
): void {
  const { projectService, researchService, homeService } = deps;

  ipcMain.handle(IPC.GET_RESEARCHES, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const { projectId } = parseOrThrow(ProjectIdSchema, payload, "GET_RESEARCHES");
      return homeService.getTasksByProject(projectId);
    }),
  );

  ipcMain.handle(IPC.RETRY_RESEARCH, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const { projectId, query } = parseOrThrow(RetryResearchSchema, payload, "RETRY_RESEARCH");
      let project: Awaited<ReturnType<typeof projectService.getProject>>;
      try {
        project = await projectService.getProject(projectId);
      } catch {
        throw new Error(`Project not found: ${projectId}`);
      }
      return researchService.startResearch(
        projectId,
        project.name,
        query,
        project.folderPath,
        project.projectPath,
      );
    }),
  );
}
