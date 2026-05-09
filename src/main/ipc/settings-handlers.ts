import { ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import { getOllamaModels, getOpenAiModels, getOpenRouterModels } from "../agent/model-discovery";
import { checkOllamaAvailable } from "../agent/model-provider";
import { CheckOllamaSchema, GetProviderModelsSchema, SaveSettingsSchema } from "../ipc-validation";
import type { SettingsService } from "../services/SettingsService";
import { parseOrThrow } from "./parse-util";
import type { SessionManager } from "./session-manager";

export function registerSettingsHandlers(
  _win: Electron.BrowserWindow,
  deps: {
    settingsService: SettingsService;
    sessionManager: SessionManager;
  },
): void {
  const { settingsService, sessionManager } = deps;

  ipcMain.handle(IPC.GET_SETTINGS, async () => {
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
  });

  ipcMain.handle(IPC.SAVE_SETTINGS, async (_event, payload: unknown) => {
    const p = parseOrThrow(SaveSettingsSchema, payload, "SAVE_SETTINGS");
    await settingsService.saveSettings(p as Parameters<typeof settingsService.saveSettings>[0]);

    // Clear sessions if model-related or provider settings change (not tracing flags)
    if ("activeProvider" in p || "defaultCloudProvider" in p || "providerCredentials" in p) {
      sessionManager.clear();
    }
  });

  ipcMain.handle(IPC.CHECK_OLLAMA, async (_event, payload: unknown) => {
    const host = parseOrThrow(CheckOllamaSchema, payload, "CHECK_OLLAMA");
    const available = await checkOllamaAvailable(host);
    return { available, host };
  });

  ipcMain.handle(IPC.GET_PROVIDER_MODELS, async (_event, payload: unknown) => {
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
  });
}
