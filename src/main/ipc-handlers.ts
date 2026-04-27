import { type BrowserWindow, dialog, ipcMain } from "electron";
import type { DependencyContainer } from "tsyringe";
import { IPC } from "../shared/ipc-channels";
import { buildSystemContext } from "./agent/context";
import { AgentSession } from "./agent/session";
import { EventBus } from "./event-bus";
import { ArtifactService } from "./services/ArtifactService";
import { HomeService } from "./services/HomeService";
import { MemoryManager } from "./services/MemoryManager";
import { MessageService } from "./services/MessageService";
import { ProjectService } from "./services/ProjectService";
import { ResearchService } from "./services/ResearchService";
import { SettingsService } from "./services/SettingsService";

export function registerIpcHandlers(win: BrowserWindow, container: DependencyContainer): void {
  const projectService = container.resolve(ProjectService);
  const messageService = container.resolve(MessageService);
  const artifactService = container.resolve(ArtifactService);
  const settingsService = container.resolve(SettingsService);
  const homeService = container.resolve(HomeService);
  const researchService = container.resolve(ResearchService);
  const memoryManager = container.resolve(MemoryManager);
  const eventBus = container.resolve(EventBus);

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
    const p = payload as { name: string; folderPath?: unknown };
    return projectService.createProject(
      p.name,
      typeof p.folderPath === "string" ? p.folderPath : null,
    );
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

  ipcMain.handle(IPC.GET_SETTINGS, async () => {
    const settings = await settingsService.getSettings();
    return {
      hasApiKey: settings.openrouterApiKey !== null && settings.openrouterApiKey !== "",
      openrouterApiKey: settings.openrouterApiKey,
      model: settings.model,
      langfuseEnabled: settings.langfuseEnabled,
    };
  });

  ipcMain.handle(IPC.SAVE_SETTINGS, async (_event, payload: unknown) => {
    if (typeof payload !== "object" || payload === null) {
      throw new Error("Invalid payload");
    }
    const p = payload as Record<string, unknown>;
    if ("model" in p && typeof p.model !== "string") {
      throw new Error("model must be a string");
    }
    if (
      "openrouterApiKey" in p &&
      p.openrouterApiKey !== null &&
      typeof p.openrouterApiKey !== "string"
    ) {
      throw new Error("openrouterApiKey must be a string or null");
    }
    if ("langfuseEnabled" in p && typeof p.langfuseEnabled !== "boolean") {
      throw new Error("langfuseEnabled must be a boolean");
    }
    await settingsService.saveSettings(p as Parameters<typeof settingsService.saveSettings>[0]);
    // If model or langfuseEnabled changed, clear sessions so next message creates a fresh session with the new config
    if ("model" in p || "langfuseEnabled" in p) {
      sessions.clear();
    }
  });

  ipcMain.handle(IPC.OPEN_FOLDER_DIALOG, async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
      title: "Select project folder",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IPC.LINK_FOLDER, async (_event, payload: unknown) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { projectId?: unknown }).projectId !== "string" ||
      typeof (payload as { folderPath?: unknown }).folderPath !== "string"
    ) {
      throw new Error("Invalid payload: expected { projectId: string, folderPath: string }");
    }
    const { projectId, folderPath } = payload as { projectId: string; folderPath: string };
    await projectService.linkFolder(projectId, folderPath);
    sessions.delete(projectId); // Invalidate session so next message picks up new folderPath
  });

  // EventBus → IPC forwarding
  eventBus.on("research:started", (payload) => {
    win.webContents.send(IPC.RESEARCH_STATUS_UPDATE, { status: "started", ...payload });
  });

  eventBus.on("research:progress", (payload) => {
    win.webContents.send(IPC.RESEARCH_STATUS_UPDATE, { status: "progress", ...payload });
  });

  eventBus.on("research:complete", (payload) => {
    win.webContents.send(IPC.RESEARCH_COMPLETE, payload);
    const session = sessions.get(payload.projectId);
    if (session) {
      session.queueFollowUp(
        `Background research complete (task ${payload.taskId}). Query: "${payload.query}". Artifact saved at ${payload.filePath}. Please briefly summarise the findings for the user.`,
      );
    }
  });

  eventBus.on("research:failed", (payload) => {
    win.webContents.send(IPC.RESEARCH_STATUS_UPDATE, { status: "failed", ...payload });
  });

  eventBus.on("tool:pending", (payload) => {
    win.webContents.send(IPC.TOOL_PENDING, payload);
  });

  ipcMain.handle(IPC.GET_PENDING_TOOLS, async () => {
    return homeService.getPendingTools();
  });

  ipcMain.handle(IPC.APPROVE_TOOL, async (_event, payload: unknown) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { name?: unknown }).name !== "string"
    ) {
      throw new Error("Invalid payload: expected { name: string }");
    }
    await homeService.approvePendingTool((payload as { name: string }).name);
  });

  ipcMain.handle(IPC.REJECT_TOOL, async (_event, payload: unknown) => {
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as { name?: unknown }).name !== "string"
    ) {
      throw new Error("Invalid payload: expected { name: string }");
    }
    await homeService.rejectPendingTool((payload as { name: string }).name);
  });

  // Auto-resume in-progress research tasks from the previous session
  void (async () => {
    try {
      const tasks = await homeService.getInProgressTasks();
      for (const task of tasks) {
        try {
          await researchService.startResearch(
            task.projectId,
            task.projectName,
            task.query,
            task.folderPath,
          );
        } catch (err) {
          console.error("[startup] Failed to resume task", task.taskId, err);
        }
      }
    } catch (err) {
      console.error("[startup] Failed to load in-progress tasks:", err);
    }
  })();

  ipcMain.on(IPC.SEND_MESSAGE, (_event, payload: unknown) => {
    void (async () => {
      try {
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
          const project = await projectService.getProject(projectId);
          const isFirstRun = await homeService.isFirstRun();
          const systemContext = await buildSystemContext(
            projectId,
            project.name,
            project.folderPath ?? undefined,
          );
          const initialMemoryContext = await memoryManager.buildContext(projectId, 20);
          sessions.set(
            projectId,
            new AgentSession({
              win,
              messageService,
              homeService,
              researchService,
              memoryManager,
              initialMemoryContext,
              projectId,
              projectName: project.name,
              folderPath: project.folderPath,
              apiKey: settings.openrouterApiKey,
              model: settings.model,
              isFirstRun,
              systemContext,
              langfuseEnabled: settings.langfuseEnabled,
            }),
          );
        }

        const session = sessions.get(projectId);
        if (!session) return;
        await session.send(content);
      } catch (err) {
        console.error("[IPC] SEND_MESSAGE error:", err);
        win.webContents.send(IPC.MESSAGE_CHUNK, "⚠️ An error occurred. Please try again.");
        win.webContents.send(IPC.MESSAGE_DONE);
      }
    })();
  });
}
