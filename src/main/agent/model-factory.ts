import type { Api, Model } from "@mariozechner/pi-ai";
import { getModels } from "@mariozechner/pi-ai";
import type { ModelProvider } from "./model-provider";
import { isCloudProvider } from "./model-provider";

export interface ModelFactoryOptions {
  provider: ModelProvider;
  langfuseEnabled: boolean;
}

export function createModel(opts: ModelFactoryOptions): Model<Api> {
  const base = resolveBaseConfig(opts.provider);

  if (opts.langfuseEnabled && isCloudProvider(opts.provider)) {
    const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const secretKey = process.env.LANGFUSE_SECRET_KEY;
    if (publicKey && secretKey) {
      const host = (process.env.LANGFUSE_HOST ?? "https://cloud.langfuse.com").replace(/\/$/, "");
      return {
        ...base,
        baseUrl: `${host}/api/proxy/openai/v1`,
        headers: {
          ...base.headers,
          "x-langfuse-public-key": publicKey,
          "x-langfuse-secret-key": secretKey,
          "x-target-url": base.baseUrl,
        },
      };
    }
    console.warn(
      "[Langfuse] LANGFUSE_PUBLIC_KEY and/or LANGFUSE_SECRET_KEY missing. " +
        "Tracing disabled despite langfuseEnabled=true.",
    );
  }

  return base;
}

function resolveBaseConfig(provider: ModelProvider): Model<Api> {
  switch (provider.type) {
    case "openrouter": {
      const model = getRegisteredModel("openrouter", provider.model);
      if (!model) throw new Error(`Unknown OpenRouter model: ${provider.model}`);
      return model;
    }
    case "ollama":
      return makeOllamaModel(provider);
    case "openai": {
      const registered = getRegisteredModel("openai", provider.model);
      if (registered) return registered;
      return makeOpenAiModel(provider);
    }
    case "anthropic":
      throw new Error(
        "Direct Anthropic API is not OpenAI-compatible. " +
          'Use OpenRouter with model slug "anthropic/claude-*" instead.',
      );
  }
}

function getRegisteredModel(
  provider: "openrouter" | "openai",
  modelId: string,
): Model<Api> | undefined {
  const models = getModels(provider);
  return models.find((m) => m.id === modelId) as Model<Api> | undefined;
}

function makeOllamaModel(
  provider: Extract<ModelProvider, { type: "ollama" }>,
): Model<"openai-completions"> {
  return {
    id: provider.model,
    name: provider.model,
    api: "openai-completions",
    provider: "openai",
    baseUrl: `${provider.host.replace(/\/$/, "")}/v1`,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4096,
  };
}

function makeOpenAiModel(
  provider: Extract<ModelProvider, { type: "openai" }>,
): Model<"openai-completions"> {
  return {
    id: provider.model,
    name: provider.model,
    api: "openai-completions",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4096,
  };
}
