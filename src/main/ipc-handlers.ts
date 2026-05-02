import { type BrowserWindow, dialog, ipcMain, Notification } from "electron";
import type { DependencyContainer } from "tsyringe";
import { IPC } from "../shared/ipc-channels";
import { buildSystemContext } from "./agent/context";
import { resolveProviderWithFallback } from "./agent/model-provider";
import { AgentSession } from "./agent/session";
import { EventBus } from "./event-bus";
import {
  ApproveRejectToolSchema,
  CheckOllamaSchema,
  CreateProjectSchema,
  DeleteProjectSchema,
  DeleteSkillSchema,
  LinkFolderSchema,
  ProjectIdSchema,
  ReadArtifactFileSchema,
  RenameProjectSchema,
  ResolveBlockedCommandSchema,
  RetryResearchSchema,
  SaveSettingsSchema,
  SendMessageSchema,
  ToggleSkillSchema,
  UnlinkFolderSchema,
} from "./ipc-validation";
import { ArtifactService } from "./services/ArtifactService";
import { HomeService } from "./services/HomeService";
import { MemoryManager } from "./services/MemoryManager";
import { MessageService } from "./services/MessageService";
import { ProjectService } from "./services/ProjectService";
import { ResearchService } from "./services/ResearchService";
import { SettingsService } from "./services/SettingsService";

function parseOrThrow<T>(schema: { safeParse: (data: unknown) => { success: false; error: unknown } | { success: true; data: T } }, payload: unknown, label: string): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new Error(`Invalid payload for ${label}: ${String(result.error)}`);
  }
  return result.data;
}

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
    const p = parseOrThrow(CreateProjectSchema, payload, "CREATE_PROJECT");
    return projectService.createProject(p.name, p.folderPath ?? null);
  });

  ipcMain.handle(IPC.GET_ARTIFACTS, async (_event, payload: unknown) => {
    const p = parseOrThrow(ProjectIdSchema, payload, "GET_ARTIFACTS");
    return artifactService.listArtifacts(p.projectId);
  });

  ipcMain.handle(IPC.READ_ARTIFACT_FILE, async (_event, payload: unknown) => {
    const { filePath, projectId } = parseOrThrow(ReadArtifactFileSchema, payload, "READ_ARTIFACT_FILE");

    const { stat, readFile } = await import("node:fs/promises");

    // Resolve project to get folder path for PathJail
    let project: Awaited<ReturnType<typeof projectService.getProject>>;
    try {
      project = await projectService.getProject(projectId);
    } catch {
      throw new Error("Project not found");
    }

    const { PathJail } = await import("./agent/path-jail");
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

  ipcMain.handle(IPC.GET_MESSAGES, async (_event, payload: unknown) => {
    const p = parseOrThrow(ProjectIdSchema, payload, "GET_MESSAGES");
    return messageService.getHistory(p.projectId);
  });

  ipcMain.handle(IPC.GET_SETTINGS, async () => {
    const settings = await settingsService.getSettings();
    const activeCreds = settings.providerCredentials[settings.activeProvider];
    const activeApiKey = "apiKey" in activeCreds ? (activeCreds.apiKey ?? null) : null;

    return {
      hasApiKey: activeApiKey !== null && activeApiKey !== "",
      activeProvider: settings.activeProvider,
      defaultCloudProvider: settings.defaultCloudProvider,
      providerCredentials: settings.providerCredentials,
      langfuseEnabled: settings.langfuseEnabled,
    };
  });

  ipcMain.handle(IPC.SAVE_SETTINGS, async (_event, payload: unknown) => {
    const p = parseOrThrow(SaveSettingsSchema, payload, "SAVE_SETTINGS");
    await settingsService.saveSettings(p as Parameters<typeof settingsService.saveSettings>[0]);

    // Clear sessions if model-related or provider settings change (not tracing flags)
    if ("activeProvider" in p || "defaultCloudProvider" in p || "providerCredentials" in p) {
      sessions.clear();
    }
  });

  ipcMain.handle(IPC.CHECK_OLLAMA, async (_event, payload: unknown) => {
    const host = parseOrThrow(CheckOllamaSchema, payload, "CHECK_OLLAMA");
    const { checkOllamaAvailable } = await import("./agent/model-provider");
    const available = await checkOllamaAvailable(host);
    return { available, host };
  });

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

  ipcMain.handle(IPC.OPEN_FOLDER_DIALOG, async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
      title: "Select project folder",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IPC.LINK_FOLDER, async (_event, payload: unknown) => {
    const { projectId, folderPath } = parseOrThrow(LinkFolderSchema, payload, "LINK_FOLDER");
    await projectService.linkFolder(projectId, folderPath);
    sessions.delete(projectId); // Invalidate session so next message picks up new folderPath
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

  ipcMain.handle(IPC.UNLINK_FOLDER, async (_event, payload: unknown) => {
    const { id } = parseOrThrow(UnlinkFolderSchema, payload, "UNLINK_FOLDER");
    await projectService.unlinkFolder(id);
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

    // OS notification when window not focused
    if (!win.isFocused()) {
      const body =
        typeof payload === "object" && payload !== null && "query" in payload
          ? String((payload as { query: string }).query).slice(0, 80)
          : "Research completed";
      const notification = new Notification({ title: "Research Complete", body });
      notification.show();

      notification.on("click", () => {
        if (win.isMinimized()) win.restore();
        win.focus();
      });
    }

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

  eventBus.on("bash:blocked", (payload) => {
    win.webContents.send(IPC.BASH_BLOCKED, payload);
  });

  eventBus.on("model:fallback", (payload) => {
    win.webContents.send(IPC.MODEL_FALLBACK, payload);
  });

  ipcMain.handle(IPC.RESOLVE_BLOCKED_COMMAND, async (_event, payload: unknown) => {
    const { commandId, action, projectId } = parseOrThrow(ResolveBlockedCommandSchema, payload, "RESOLVE_BLOCKED_COMMAND");
    const { resolveBlockedCommand } = await import("./agent/extensions/safe-bash");
    resolveBlockedCommand(commandId, action, projectId);
  });

  ipcMain.handle(IPC.GET_AUDIT_LOG, async () => {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
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
  });

  ipcMain.handle(IPC.CLEAR_AUDIT_LOG, async () => {
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const path = join(homeService.getHomePath(), "audit.log");
    await writeFile(path, "", "utf-8");
  });

  ipcMain.handle(IPC.GET_PENDING_TOOLS, async () => {
    return homeService.getPendingTools();
  });

  ipcMain.handle(IPC.APPROVE_TOOL, async (_event, payload: unknown) => {
    const { name } = parseOrThrow(ApproveRejectToolSchema, payload, "APPROVE_TOOL");
    await homeService.approvePendingTool(name);
  });

  ipcMain.handle(IPC.REJECT_TOOL, async (_event, payload: unknown) => {
    const { name } = parseOrThrow(ApproveRejectToolSchema, payload, "REJECT_TOOL");
    await homeService.rejectPendingTool(name);
  });

  ipcMain.handle(IPC.GET_SKILLS, async () => {
    return homeService.getSkills();
  });

  ipcMain.handle(IPC.TOGGLE_SKILL, async (_event, payload: unknown) => {
    const p = parseOrThrow(ToggleSkillSchema, payload, "TOGGLE_SKILL");
    await homeService.toggleSkill(p.name, p.enabled);
  });

  ipcMain.handle(IPC.DELETE_SKILL, async (_event, payload: unknown) => {
    const { name } = parseOrThrow(DeleteSkillSchema, payload, "DELETE_SKILL");
    await homeService.deleteSkill(name);
  });

  // Migrate JSON tasks to DB, then auto-resume in-progress research
  void (async () => {
    try {
      await homeService.migrateTasksFromJson();
    } catch (err) {
      const msg = `Failed to migrate JSON tasks: ${err instanceof Error ? err.message : String(err)}`;
      console.error("[startup]", msg);
      eventBus.emit({ type: "startup:error", payload: { phase: "migrate-tasks", error: msg } });
    }
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
          const msg = `Failed to resume task ${task.taskId}: ${err instanceof Error ? err.message : String(err)}`;
          console.error("[startup]", msg);
          eventBus.emit({
            type: "startup:error",
            payload: { phase: "resume-task", error: msg },
          });
        }
      }
    } catch (err) {
      const msg = `Failed to load in-progress tasks: ${err instanceof Error ? err.message : String(err)}`;
      console.error("[startup]", msg);
      eventBus.emit({ type: "startup:error", payload: { phase: "load-tasks", error: msg } });
    }
  })();

  ipcMain.on(IPC.SEND_MESSAGE, (_event, payload: unknown) => {
    void (async () => {
      let projectId: string | undefined;
      try {
        const parsed = parseOrThrow(SendMessageSchema, payload, "SEND_MESSAGE");
        projectId = parsed.projectId;
        const content = parsed.content;

        const settings = await settingsService.getSettings();
        const provider = await resolveProviderWithFallback(
          { settings },
          eventBus as unknown as {
            emit: (event: { type: string; payload: Record<string, unknown> }) => void;
          },
        );

        if (provider.type !== "ollama" && !provider.apiKey) {
          win.webContents.send(
            IPC.MESSAGE_CHUNK,
            "⚠️ No API key configured. Open Settings to add your API key.",
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
              eventBus,
              homeService,
              researchService,
              memoryManager,
              initialMemoryContext,
              projectId,
              projectName: project.name,
              folderPath: project.folderPath,
              provider,
              isFirstRun,
              systemContext,
              langfuseEnabled: settings.langfuseEnabled,
              webAccessEnabled: settings.webAccessEnabled,
            }),
          );
        }

        const session = sessions.get(projectId);
        if (!session) return;

        // Stream timeout: 120s, prevents stuck cursor if agent_end never fires
        const timeout = AbortSignal.timeout(120_000);
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeout.addEventListener("abort", () => reject(new Error("stream_timeout")));
        });

        await Promise.race([session.send(content), timeoutPromise]);
      } catch (err) {
        if (err instanceof Error && err.message === "stream_timeout") {
          if (projectId) {
            const session = sessions.get(projectId);
            session?.abort();
          }
          win.webContents.send(IPC.MESSAGE_CHUNK, "⚠️ The response timed out. Please try again.");
        } else {
          console.error("[IPC] SEND_MESSAGE error:", err);
          win.webContents.send(IPC.MESSAGE_CHUNK, "⚠️ An error occurred. Please try again.");
        }
        win.webContents.send(IPC.MESSAGE_DONE);
      }
    })();
  });
}
