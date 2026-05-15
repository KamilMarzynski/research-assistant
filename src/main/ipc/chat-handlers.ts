import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { type BrowserWindow, ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { buildSystemContext } from "../agent/context";
import { resolveProvider } from "../agent/model-provider";
import { AgentSession } from "../agent/session";
import type { EventBus } from "../event-bus";
import { AbortMessageSchema, ProjectIdSchema, SendMessageSchema } from "../ipc-validation";
import type { AllowlistService } from "../services/AllowlistService";
import type { HomeService } from "../services/HomeService";
import type { MemoryFileService } from "../services/MemoryFileService";
import type { IMemoryManager } from "../services/MemoryManager";
import type { MessageService } from "../services/MessageService";
import type { ObservabilityService } from "../services/ObservabilityService";
import type { OutputNotificationService } from "../services/OutputNotificationService";
import type { ProjectService } from "../services/ProjectService";
import type { ResearchService } from "../services/ResearchService";
import type { SettingsService } from "../services/SettingsService";
import type { ToolApprovalService } from "../services/ToolApprovalService";
import { emitPush } from "./emit-push";
import { parseOrThrow } from "./parse-util";
import { SendThrottle } from "./send-throttle";
import type { SessionManager } from "./session-manager";
import { wrapIpc } from "./wrap-ipc";

export function registerChatHandler(
  win: BrowserWindow,
  deps: {
    sessionManager: SessionManager;
    settingsService: SettingsService;
    eventBus: EventBus;
    homeService: HomeService;
    researchService: ResearchService;
    memoryManager: IMemoryManager;
    messageService: MessageService;
    projectService: ProjectService;
    outputNotificationService: OutputNotificationService;
    memoryFileService: MemoryFileService;
    allowlistService: AllowlistService;
    observabilityService: ObservabilityService;
    toolApprovalService: ToolApprovalService;
  },
): void {
  const {
    sessionManager,
    settingsService,
    eventBus,
    homeService,
    researchService,
    memoryManager,
    messageService,
    projectService,
    outputNotificationService,
    memoryFileService,
    allowlistService,
    observabilityService,
    toolApprovalService,
  } = deps;

  eventBus.on("agent:chunk", (payload) => {
    emitPush(win, { type: "MESSAGE_CHUNK", projectId: payload.projectId, delta: payload.delta });
  });
  eventBus.on("agent:done", (payload) => {
    emitPush(win, { type: "MESSAGE_DONE", projectId: payload.projectId });
  });

  ipcMain.handle(IPC.GET_MESSAGES, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const p = parseOrThrow(ProjectIdSchema, payload, "GET_MESSAGES");
      return messageService.getHistory(p.projectId);
    }),
  );

  const sendThrottle = new SendThrottle();

  ipcMain.handle(IPC.SEND_MESSAGE, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const parsed = parseOrThrow(SendMessageSchema, payload, "SEND_MESSAGE");
      const projectId = parsed.projectId;
      const content = parsed.content;

      const release = await sendThrottle.acquire(projectId);
      try {
        const settings = await settingsService.getSettings();

        if (!sessionManager.get(projectId)) {
          const project = await projectService.getProject(projectId);
          const provider = resolveProvider({
            settings,
            projectModelOverride: project.modelOverride,
          });

          if (provider.type !== "ollama" && !provider.apiKey) {
            emitPush(win, {
              type: "MESSAGE_CHUNK",
              projectId,
              delta: "⚠️ No API key configured. Open Settings to add your API key.",
            });
            emitPush(win, { type: "MESSAGE_DONE", projectId });
            return { messageId: randomUUID() };
          }

          const isFirstRun = await homeService.isFirstRun();
          const projectPath =
            project.projectPath ??
            join(homeService.getHomePath(), "projects", project.slug ?? projectId);
          const systemContext = await buildSystemContext(projectPath, project.folderPath);
          const initialMemoryContext = await memoryManager.buildContext(projectId);
          const session = new AgentSession({
            messageService,
            eventBus,
            homeService,
            researchService,
            memoryManager,
            initialMemoryContext,
            projectId,
            slug: project.slug ?? projectId,
            projectName: project.name,
            projectPath,
            folderPath: project.folderPath,
            provider,
            isFirstRun,
            systemContext,
            webAccessEnabled: settings.webAccessEnabled,
            memoryFileService,
            allowlistService,
            observabilityService,
            proposeSkillFn: async (name, skillContent, script, scope) => {
              if (scope === "project") {
                const slug = project.slug ?? projectId;
                await toolApprovalService.saveProjectPendingTool(slug, name, skillContent, script);
                eventBus.emit({
                  type: "tool:pending",
                  payload: { name, skillContent, scope: "project", projectSlug: slug },
                });
              } else {
                await toolApprovalService.savePendingTool(name, skillContent, script);
                eventBus.emit({
                  type: "tool:pending",
                  payload: { name, skillContent, scope: "global" },
                });
              }
            },
            onFileWrite: (absolutePath, relativePath, fileName) => {
              void outputNotificationService.recordWrite(
                projectId,
                absolutePath,
                relativePath,
                fileName,
              );
              eventBus.emit({
                type: "file:written",
                payload: { projectId, absolutePath, relativePath, fileName },
              });
            },
          });
          sessionManager.set(projectId, session);
        }

        const session = sessionManager.get(projectId);
        if (!session) return { messageId: randomUUID() };

        // Stream timeout: 300s, prevents stuck cursor if agent_end never fires
        const timeout = AbortSignal.timeout(300_000);
        let onAbort: (() => void) | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          onAbort = () => reject(new Error("stream_timeout"));
          timeout.addEventListener("abort", onAbort);
        });

        try {
          await Promise.race([session.send(content), timeoutPromise]);
        } finally {
          if (onAbort) {
            timeout.removeEventListener("abort", onAbort);
          }
        }

        return { messageId: randomUUID() };
      } catch (err) {
        if (err instanceof Error && err.message === "stream_timeout") {
          const session = sessionManager.get(projectId);
          session?.abort();
          emitPush(win, {
            type: "MESSAGE_CHUNK",
            projectId,
            delta: "⚠️ The response timed out. Please try again.",
          });
        } else {
          console.error("[IPC] SEND_MESSAGE error:", err);
          emitPush(win, {
            type: "MESSAGE_CHUNK",
            projectId,
            delta: "⚠️ An error occurred. Please try again.",
          });
        }
        emitPush(win, { type: "MESSAGE_DONE", projectId });
        return { messageId: randomUUID() };
      } finally {
        release();
      }
    }),
  );

  ipcMain.handle(IPC.ABORT_MESSAGE, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const parsed = parseOrThrow(AbortMessageSchema, payload, "ABORT_MESSAGE");
      const session = sessionManager.get(parsed.projectId);
      session?.abort();
    }),
  );
}
