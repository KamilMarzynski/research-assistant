import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { RetryResearchSchema } from "../ipc-validation";
import type { ProjectService } from "../services/ProjectService";
import type { ResearchService } from "../services/ResearchService";
import { parseOrThrow } from "./parse-util";

export function registerResearchHandlers(
  _win: Electron.BrowserWindow,
  deps: {
    projectService: ProjectService;
    researchService: ResearchService;
  },
): void {
  const { projectService, researchService } = deps;

  ipcMain.handle(IPC.RETRY_RESEARCH, async (_event, payload: unknown) => {
    const { projectId, query } = parseOrThrow(RetryResearchSchema, payload, "RETRY_RESEARCH");
    let project: Awaited<ReturnType<typeof projectService.getProject>>;
    try {
      project = await projectService.getProject(projectId);
    } catch {
      throw new Error(`Project not found: ${projectId}`);
    }
    return researchService.startResearch(projectId, project.name, query, project.folderPath);
  });
}
