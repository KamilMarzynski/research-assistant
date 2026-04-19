import { type BrowserWindow, ipcMain } from "electron";
import type { DependencyContainer } from "tsyringe";
import { IPC } from "../shared/ipc-channels";
import { AgentSession } from "./agent/session";
import { ArtifactService } from "./services/ArtifactService";
import { MessageService } from "./services/MessageService";
import { ProjectService } from "./services/ProjectService";
import { SettingsService } from "./services/SettingsService";

export function registerIpcHandlers(win: BrowserWindow, container: DependencyContainer): void {
  const projectService = container.resolve(ProjectService);
  const messageService = container.resolve(MessageService);
  const artifactService = container.resolve(ArtifactService);
  const settingsService = container.resolve(SettingsService);

  const sessions = new Map<string, AgentSession>();

  ipcMain.handle(IPC.GET_PROJECTS, async () => projectService.listProjects());

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

  ipcMain.handle(IPC.GET_MESSAGES, async (_event, payload: unknown) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { projectId?: unknown }).projectId !== "string"
    ) {
      throw new Error("Invalid payload: expected { projectId: string }");
    }
    return messageService.getHistory((payload as { projectId: string }).projectId);
  });

  ipcMain.handle(IPC.GET_SETTINGS, async () => settingsService.getSettings());

  ipcMain.handle(IPC.SAVE_SETTINGS, async (_event, payload: unknown) => {
    if (typeof payload !== "object" || payload === null) {
      throw new Error("Invalid payload");
    }
    return settingsService.saveSettings(
      payload as Parameters<typeof settingsService.saveSettings>[0],
    );
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

    const settings = await settingsService.getSettings();
    if (!settings.openrouterApiKey) {
      win.webContents.send(
        IPC.MESSAGE_CHUNK,
        "⚠️ No API key configured. Open Settings to add your OpenRouter API key.",
      );
      win.webContents.send(IPC.MESSAGE_DONE);
      return;
    }

    if (!sessions.has(projectId)) {
      sessions.set(
        projectId,
        new AgentSession({
          win,
          messageService,
          projectId,
          apiKey: settings.openrouterApiKey,
          model: settings.model,
        }),
      );
    }

    const session = sessions.get(projectId);
    if (!session) return;
    await session.send(content);
  });
}
