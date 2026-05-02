import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { ProjectIdSchema, ReadArtifactFileSchema } from "../ipc-validation";
import type { ArtifactService } from "../services/ArtifactService";
import type { ProjectService } from "../services/ProjectService";
import { parseOrThrow } from "./parse-util";

export function registerArtifactHandlers(
  _win: Electron.BrowserWindow,
  deps: {
    projectService: ProjectService;
    artifactService: ArtifactService;
  },
): void {
  const { projectService, artifactService } = deps;

  ipcMain.handle(IPC.GET_ARTIFACTS, async (_event, payload: unknown) => {
    const p = parseOrThrow(ProjectIdSchema, payload, "GET_ARTIFACTS");
    return artifactService.listArtifacts(p.projectId);
  });

  ipcMain.handle(IPC.READ_ARTIFACT_FILE, async (_event, payload: unknown) => {
    const { filePath, projectId } = parseOrThrow(
      ReadArtifactFileSchema,
      payload,
      "READ_ARTIFACT_FILE",
    );

    const { stat, readFile } = await import("node:fs/promises");

    // Resolve project to get folder path for PathJail
    let project: Awaited<ReturnType<typeof projectService.getProject>>;
    try {
      project = await projectService.getProject(projectId);
    } catch {
      throw new Error("Project not found");
    }

    const { PathJail } = await import("../agent/path-jail");
    const jail = new PathJail(projectId, project.folderPath);

    // PathJail validates the path is within allowed zones
    const resolvedPath = jail.validate(filePath, "read");

    // Check file exists and get size
    let fileStats: import("node:fs").Stats;
    try {
      fileStats = await stat(resolvedPath);
    } catch {
      throw new Error("File not found");
    }

    // Check size before reading — reject files over 10MB
    if (fileStats.size > 10 * 1024 * 1024) {
      throw new Error("File too large to display (max 10MB)");
    }

    // Read with 500KB cap
    const content = await readFile(resolvedPath, { encoding: "utf-8" });
    if (content.length > 512_000) {
      return `${content.slice(0, 512_000)}\n\n<!-- Content truncated at 500KB -->`;
    }
    return content;
  });
}
