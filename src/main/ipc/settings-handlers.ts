import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { getOllamaModels, getOpenAiModels, getOpenRouterModels } from "../agent/model-discovery";
import { checkOllamaAvailable } from "../agent/model-provider";
import { CheckOllamaSchema, GetProviderModelsSchema, SaveSettingsSchema } from "../ipc-validation";
import type { ProjectService } from "../services/ProjectService";
import type { SettingsService } from "../services/SettingsService";
import { parseOrThrow } from "./parse-util";
import type { SessionManager } from "./session-manager";
import { wrapIpc } from "./wrap-ipc";

export function registerSettingsHandlers(
  _win: Electron.BrowserWindow,
  deps: {
    settingsService: SettingsService;
    sessionManager: SessionManager;
    projectService: ProjectService;
  },
): void {
  const { settingsService, sessionManager, projectService } = deps;

  ipcMain.handle(IPC.GET_SETTINGS, () =>
    wrapIpc(async () => {
      const settings = await settingsService.getSettings();
      const activeCreds = settings.providerCredentials[settings.activeProvider];
      const isOllama = settings.activeProvider === "ollama";
      const activeApiKey = "apiKey" in activeCreds ? (activeCreds.apiKey ?? null) : null;

      return {
        hasApiKey: isOllama || (activeApiKey !== null && activeApiKey !== ""),
        activeProvider: settings.activeProvider,
        defaultCloudProvider: settings.defaultCloudProvider,
        providerCredentials: settings.providerCredentials,
        langfuseEnabled: settings.langfuseEnabled,
        webAccessEnabled: settings.webAccessEnabled,
        theme: settings.theme,
      };
    }),
  );

  ipcMain.handle(IPC.SAVE_SETTINGS, (event, payload: unknown) =>
    wrapIpc(async () => {
      const p = parseOrThrow(SaveSettingsSchema, payload, "SAVE_SETTINGS");
      await settingsService.saveSettings(p as Parameters<typeof settingsService.saveSettings>[0]);

      // When global provider/model changes, bulk-update all existing projects and
      // clear sessions so they pick up the new model on next message.
      if ("activeProvider" in p || "defaultCloudProvider" in p || "providerCredentials" in p) {
        await projectService.updateAllProjectsModel();
        sessionManager.clear();
      }

      const updated = await settingsService.getSettings();
      const activeCreds = updated.providerCredentials[updated.activeProvider];
      const isOllama = updated.activeProvider === "ollama";
      const activeApiKey = "apiKey" in activeCreds ? (activeCreds.apiKey ?? null) : null;

      event.sender.send(IPC.SETTINGS_UPDATED, {
        hasApiKey: isOllama || (activeApiKey !== null && activeApiKey !== ""),
        activeProvider: updated.activeProvider,
        defaultCloudProvider: updated.defaultCloudProvider,
        providerCredentials: updated.providerCredentials,
        langfuseEnabled: updated.langfuseEnabled,
        webAccessEnabled: updated.webAccessEnabled,
        theme: updated.theme,
      });
    }),
  );

  ipcMain.handle(IPC.CHECK_OLLAMA, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const host = parseOrThrow(CheckOllamaSchema, payload, "CHECK_OLLAMA");
      const available = await checkOllamaAvailable(host);
      return { available, host };
    }),
  );

  ipcMain.handle(IPC.GET_PROVIDER_MODELS, (_event, payload: unknown) =>
    wrapIpc(async () => {
      const p = parseOrThrow(GetProviderModelsSchema, payload, "GET_PROVIDER_MODELS");

      switch (p.provider) {
        case "ollama": {
          if (!p.host) return { models: [], error: "Host is required for Ollama" };
          return getOllamaModels(p.host);
        }
        case "openrouter": {
          return getOpenRouterModels(p.apiKey);
        }
        case "openai": {
          if (!p.apiKey) return { models: [], error: "API key is required for OpenAI" };
          return getOpenAiModels(p.apiKey);
        }
        default:
          return { models: [], error: "Unknown provider" };
      }
    }),
  );
}
