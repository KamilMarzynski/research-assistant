import { type BrowserWindow, ipcMain } from "electron";
import type { DependencyContainer } from "tsyringe";
import { IPC } from "../shared/ipc-channels";
import { ArtifactService } from "./services/ArtifactService";
import { MessageService } from "./services/MessageService";
import { ProjectService } from "./services/ProjectService";

export function registerIpcHandlers(_win: BrowserWindow, container: DependencyContainer): void {
  const projectService = container.resolve(ProjectService);
  const messageService = container.resolve(MessageService);
  const artifactService = container.resolve(ArtifactService);

  ipcMain.handle(IPC.GET_PROJECTS, async () => {
    return projectService.listProjects();
  });

  ipcMain.handle(IPC.CREATE_PROJECT, async (_event, payload: unknown) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { name?: unknown }).name !== "string"
    ) {
      throw new Error("Invalid payload: expected { name: string }");
    }
    return projectService.createProject((payload as { name: string }).name);
  });

  ipcMain.handle(IPC.GET_ARTIFACTS, async (_event, payload: unknown) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { projectId?: unknown }).projectId !== "string"
    ) {
      throw new Error("Invalid payload: expected { projectId: string }");
    }
    return artifactService.listArtifacts((payload as { projectId: string }).projectId);
  });

  ipcMain.on(IPC.SEND_MESSAGE, async (_event, payload: unknown) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { projectId?: unknown }).projectId !== "string" ||
      typeof (payload as { content?: unknown }).content !== "string"
    ) {
      console.error("[IPC] SEND_MESSAGE: invalid payload", payload);
      return;
    }
    const { projectId, content } = payload as { projectId: string; content: string };
    await messageService.addMessage({ projectId, role: "user", content });
    // TODO(run-5): route to OpenRouter via Mastra agent, stream chunks back via MESSAGE_CHUNK
  });
}
