import { randomUUID } from "node:crypto";
import { type BrowserWindow, ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { buildSystemContext } from "../agent/context";
import { resolveProviderWithFallback } from "../agent/model-provider";
import { AgentSession } from "../agent/session";
import type { EventBus } from "../event-bus";
import { ProjectIdSchema, SendMessageSchema } from "../ipc-validation";
import type { AllowlistService } from "../services/AllowlistService";
import type { HomeService } from "../services/HomeService";
import type { MemoryFileService } from "../services/MemoryFileService";
import type { IMemoryManager } from "../services/MemoryManager";
import type { MessageService } from "../services/MessageService";
import type { OutputNotificationService } from "../services/OutputNotificationService";
import type { ProjectService } from "../services/ProjectService";
import type { ResearchService } from "../services/ResearchService";
import type { SettingsService } from "../services/SettingsService";
import { parseOrThrow } from "./parse-util";
import type { SessionManager } from "./session-manager";

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
  } = deps;

  ipcMain.handle(IPC.GET_MESSAGES, async (_event, payload: unknown) => {
    const p = parseOrThrow(ProjectIdSchema, payload, "GET_MESSAGES");
    return messageService.getHistory(p.projectId);
  });

  const sendLocks = new Map<string, Promise<void>>();

  ipcMain.handle(IPC.SEND_MESSAGE, async (_event, payload: unknown) => {
    const parsed = parseOrThrow(SendMessageSchema, payload, "SEND_MESSAGE");
    const projectId = parsed.projectId;
    const content = parsed.content;

    // Per-project mutex: serialize session creation and message sends
    let releaseLock: (() => void) | undefined;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const existing = sendLocks.get(projectId);
    if (existing) await existing;
    sendLocks.set(projectId, lockPromise);

    try {
      const settings = await settingsService.getSettings();
      const provider = await resolveProviderWithFallback({ settings }, eventBus);

      if (provider.type !== "ollama" && !provider.apiKey) {
        if (settings.activeProvider === "ollama") {
          win.webContents.send(
            IPC.MESSAGE_CHUNK,
            `⚠️ Ollama is not reachable at ${settings.providerCredentials.ollama.host}. ` +
              `Fell back to ${settings.defaultCloudProvider}, which requires an API key. ` +
              "Please start Ollama or add an API key in Settings.",
          );
        } else {
          win.webContents.send(
            IPC.MESSAGE_CHUNK,
            "⚠️ No API key configured. Open Settings to add your API key.",
          );
        }
        win.webContents.send(IPC.MESSAGE_DONE);
        return { messageId: randomUUID() };
      }

      if (!sessionManager.get(projectId)) {
        const project = await projectService.getProject(projectId);
        const isFirstRun = await homeService.isFirstRun();
        const systemContext = await buildSystemContext(
          projectId,
          project.name,
          project.folderPath ?? undefined,
        );
        const initialMemoryContext = await memoryManager.buildContext(projectId, 20);
        const session = new AgentSession({
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
          memoryFileService,
          allowlistService,
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
        win.webContents.send(IPC.MESSAGE_CHUNK, "⚠️ The response timed out. Please try again.");
      } else {
        console.error("[IPC] SEND_MESSAGE error:", err);
        win.webContents.send(IPC.MESSAGE_CHUNK, "⚠️ An error occurred. Please try again.");
      }
      win.webContents.send(IPC.MESSAGE_DONE);
      return { messageId: randomUUID() };
    } finally {
      releaseLock?.();
      sendLocks.delete(projectId);
    }
  });
}
