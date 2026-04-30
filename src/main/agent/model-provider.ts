import type { AppSettings } from "../services/SettingsService";

export type ModelProvider =
  | { type: "openrouter"; apiKey: string; model: string }
  | { type: "ollama"; host: string; model: string }
  | { type: "openai"; apiKey: string; model: string }
  | { type: "anthropic"; apiKey: string; model: string };

export function isCloudProvider(
  provider: ModelProvider,
): provider is Extract<ModelProvider, { apiKey: string }> {
  return provider.type !== "ollama";
}

export interface ResolveProviderOpts {
  settings: AppSettings; // defined in SettingsService.ts (Task 2)
  projectModelOverride?: string | null;
  forceCloud?: boolean;
}

function getCloudCreds(creds: unknown) {
  return {
    apiKey: (creds as { apiKey: string | null }).apiKey ?? "",
    defaultModel: (creds as { defaultModel: string }).defaultModel,
  };
}

function parseModelOverride(raw: string, settings: AppSettings): ModelProvider {
  const trimmed = raw.trim();
  const [providerType, ...rest] = trimmed.split(":");
  const model = rest.join(":");

  if (!model) return buildDefaultProvider(settings);

  if (providerType === "ollama") {
    return { type: "ollama", host: settings.providerCredentials.ollama.host, model };
  }
  if (providerType === "openrouter") {
    return {
      type: "openrouter",
      apiKey: settings.providerCredentials.openrouter.apiKey ?? "",
      model,
    };
  }
  if (providerType === "openai") {
    return { type: "openai", apiKey: settings.providerCredentials.openai.apiKey ?? "", model };
  }
  if (providerType === "anthropic") {
    return {
      type: "anthropic",
      apiKey: settings.providerCredentials.anthropic.apiKey ?? "",
      model,
    };
  }
  // Fallback to default cloud provider for unknown format
  return buildDefaultProvider(settings);
}

function buildDefaultProvider(settings: AppSettings): ModelProvider {
  const creds = settings.providerCredentials[settings.defaultCloudProvider];
  const cloudCreds = getCloudCreds(creds);
  return {
    type: settings.defaultCloudProvider,
    apiKey: cloudCreds.apiKey,
    model: cloudCreds.defaultModel,
  } as ModelProvider;
}

export function resolveProvider(opts: ResolveProviderOpts): ModelProvider {
  if (opts.forceCloud) {
    return buildDefaultProvider(opts.settings);
  }

  if (opts.projectModelOverride) {
    return parseModelOverride(opts.projectModelOverride, opts.settings);
  }

  const creds = opts.settings.providerCredentials[opts.settings.activeProvider];

  switch (opts.settings.activeProvider) {
    case "openrouter": {
      const cloudCreds = getCloudCreds(creds);
      return { type: "openrouter", apiKey: cloudCreds.apiKey, model: cloudCreds.defaultModel };
    }
    case "openai": {
      const cloudCreds = getCloudCreds(creds);
      return { type: "openai", apiKey: cloudCreds.apiKey, model: cloudCreds.defaultModel };
    }
    case "anthropic": {
      const cloudCreds = getCloudCreds(creds);
      return { type: "anthropic", apiKey: cloudCreds.apiKey, model: cloudCreds.defaultModel };
    }
    case "ollama":
      return {
        type: "ollama",
        host: (creds as { host: string }).host,
        model: (creds as { defaultModel: string }).defaultModel,
      };
    default:
      return buildDefaultProvider(opts.settings);
  }
}

export async function checkOllamaAvailable(host: string): Promise<boolean> {
  try {
    const url = new URL("/api/tags", host);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function resolveProviderWithFallback(
  opts: ResolveProviderOpts,
  eventBus?: { emit: (event: { type: string; payload: Record<string, unknown> }) => void },
): Promise<ModelProvider> {
  const primary = resolveProvider({ ...opts });

  if (primary.type !== "ollama") {
    return primary;
  }

  const available = await checkOllamaAvailable(primary.host);
  if (available) return primary;

  console.warn(
    `[ModelFactory] Ollama unavailable at ${primary.host}, ` +
      `falling back to ${opts.settings.defaultCloudProvider}`,
  );

  eventBus?.emit({
    type: "model:fallback",
    payload: {
      reason: "ollama_unavailable",
      requestedModel: primary.model,
      fallbackProvider: opts.settings.defaultCloudProvider,
    },
  });

  return buildDefaultProvider(opts.settings);
}
