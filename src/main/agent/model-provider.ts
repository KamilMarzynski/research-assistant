import { z } from "zod/v4";
import type { AppSettings } from "../services/SettingsService";

export type ModelProvider =
  | { type: "openrouter"; apiKey: string; model: string }
  | { type: "ollama"; host: string; model: string }
  | { type: "openai"; apiKey: string; model: string };

export function isCloudProvider(
  provider: ModelProvider,
): provider is Extract<ModelProvider, { apiKey: string }> {
  return provider.type !== "ollama";
}

export interface ResolveProviderOpts {
  settings: AppSettings;
  projectModelOverride?: string | null;
  forceCloud?: boolean;
}

const CloudCredsSchema = z
  .object({
    apiKey: z.string().nullable().optional(),
    defaultModel: z.string().optional(),
  })
  .nullable()
  .optional();

function getCloudCreds(creds: unknown): { apiKey: string; defaultModel: string } {
  const parsed = CloudCredsSchema.safeParse(creds);
  if (!parsed.success) {
    return { apiKey: "", defaultModel: "" };
  }
  const data = parsed.data;
  if (!data) {
    return { apiKey: "", defaultModel: "" };
  }
  return {
    apiKey: data.apiKey ?? "",
    defaultModel: data.defaultModel ?? "",
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
  return buildDefaultProvider(settings);
}

function buildDefaultProvider(settings: AppSettings): ModelProvider {
  const creds = settings.providerCredentials.openrouter;
  return {
    type: "openrouter",
    apiKey: creds.apiKey ?? "",
    model: creds.defaultModel,
  };
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
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
