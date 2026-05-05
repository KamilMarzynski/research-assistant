import { useCallback, useEffect, useState } from "react";
import { IPC } from "../../shared/ipc-channels";
import type { ProviderCredentials } from "../components/settings/ModelProviderTab";

export interface ProviderSettings {
  activeProvider: string;
  defaultCloudProvider: string;
  credentials: ProviderCredentials;
  ollamaTestStatus: "idle" | "ok" | "error";
  availableModels: Array<{ id: string; name: string }>;
  modelsLoading: boolean;
  modelsError: string | null;
  setActiveProvider: (v: string) => void;
  setDefaultCloudProvider: (v: string) => void;
  setCredentials: (v: ProviderCredentials | ((prev: ProviderCredentials) => ProviderCredentials)) => void;
  fetchModels: (provider: string, host?: string, apiKey?: string) => Promise<void>;
  testOllama: () => Promise<void>;
  loadFromSettings: () => Promise<void>;
}

export function useProviderSettings(enabled: boolean): ProviderSettings {
  const [activeProvider, setActiveProvider] = useState<string>("openrouter");
  const [defaultCloudProvider, setDefaultCloudProvider] = useState<string>("openrouter");
  const [credentials, setCredentials] = useState<ProviderCredentials>({
    openrouter: { apiKey: "", defaultModel: "anthropic/claude-sonnet-4-6" },
    openai: { apiKey: "", defaultModel: "gpt-4o" },
    anthropic: { apiKey: "", defaultModel: "claude-3-5-sonnet-20241022" },
    ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
  });
  const [ollamaTestStatus, setOllamaTestStatus] = useState<"idle" | "ok" | "error">("idle");
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string }>>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const fetchModels = useCallback(async (provider: string, host?: string, apiKey?: string) => {
    if (provider !== "ollama" && provider !== "openrouter" && provider !== "openai") {
      setAvailableModels([]);
      setModelsError(null);
      return;
    }
    if (provider === "openai" && !apiKey) {
      setAvailableModels([]);
      setModelsError(null);
      return;
    }
    setModelsLoading(true);
    setModelsError(null);
    try {
      const result = await window.electronAPI.invoke(IPC.GET_PROVIDER_MODELS, {
        provider,
        host,
        apiKey,
      });
      setAvailableModels(result.models);
      if (result.error) {
        setModelsError(result.error);
      }
    } catch {
      setModelsError("Failed to fetch models");
      setAvailableModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const loadFromSettings = useCallback(async () => {
    const settings = await window.electronAPI.invoke(IPC.GET_SETTINGS);
    setActiveProvider(settings.activeProvider ?? "openrouter");
    setDefaultCloudProvider(settings.defaultCloudProvider ?? "openrouter");
    setCredentials({
      openrouter: {
        apiKey: settings.providerCredentials.openrouter.apiKey ?? "",
        defaultModel:
          settings.providerCredentials.openrouter.defaultModel ?? "anthropic/claude-sonnet-4-6",
      },
      openai: {
        apiKey: settings.providerCredentials.openai.apiKey ?? "",
        defaultModel: settings.providerCredentials.openai.defaultModel ?? "gpt-4o",
      },
      anthropic: {
        apiKey: settings.providerCredentials.anthropic.apiKey ?? "",
        defaultModel:
          settings.providerCredentials.anthropic.defaultModel ?? "claude-3-5-sonnet-20241022",
      },
      ollama: {
        host: settings.providerCredentials.ollama.host ?? "http://localhost:11434",
        defaultModel: settings.providerCredentials.ollama.defaultModel ?? "llama3.2:3b",
      },
    });
    const provider = settings.activeProvider ?? "openrouter";
    const apiKey =
      provider === "openai"
        ? (settings.providerCredentials.openai.apiKey ?? undefined)
        : provider === "openrouter"
          ? (settings.providerCredentials.openrouter.apiKey ?? undefined)
          : undefined;
    await fetchModels(provider, settings.providerCredentials.ollama.host, apiKey);
  }, [fetchModels]);

  const testOllama = useCallback(async () => {
    setOllamaTestStatus("idle");
    const host = credentials.ollama.host;
    const result = await window.electronAPI.invoke(IPC.CHECK_OLLAMA, host);
    setOllamaTestStatus(result.available ? "ok" : "error");
  }, [credentials.ollama.host]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-fetch when provider changes, not on every keystroke in credential fields
  useEffect(() => {
    if (!enabled) return;
    const apiKey =
      activeProvider === "openai"
        ? credentials.openai.apiKey || undefined
        : activeProvider === "openrouter"
          ? credentials.openrouter.apiKey || undefined
          : undefined;
    void fetchModels(activeProvider, credentials.ollama.host, apiKey);
  }, [enabled, activeProvider, fetchModels]);

  return {
    activeProvider,
    defaultCloudProvider,
    credentials,
    ollamaTestStatus,
    availableModels,
    modelsLoading,
    modelsError,
    setActiveProvider,
    setDefaultCloudProvider,
    setCredentials,
    fetchModels,
    testOllama,
    loadFromSettings,
  };
}
