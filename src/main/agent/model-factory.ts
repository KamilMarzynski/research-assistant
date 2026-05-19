import type { Api, Model } from "@mariozechner/pi-ai";
import { getModels } from "@mariozechner/pi-ai";
import type { ModelProvider } from "./model-provider";
import type { ProviderModelMetadata } from "./providers/provider-client.types";

export interface ModelFactoryOptions {
  provider: ModelProvider;
  metadata?: ProviderModelMetadata;
}

export function createModel(opts: ModelFactoryOptions): Model<Api> {
  return resolveBaseConfig(opts.provider, opts.metadata);
}

function resolveBaseConfig(
  provider: ModelProvider,
  metadata?: ProviderModelMetadata,
): Model<Api> {
  switch (provider.type) {
    case "openrouter": {
      const model = getRegisteredModel("openrouter", provider.model);
      if (!model) throw new Error(`Unknown OpenRouter model: ${provider.model}`);
      return model;
    }
    case "ollama":
      return makeOllamaModel(provider, metadata);
    case "openai": {
      const registered = getRegisteredModel("openai", provider.model);
      if (registered) return registered;
      return makeOpenAiModel(provider, metadata);
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
  metadata?: ProviderModelMetadata,
): Model<"openai-completions"> {
  const contextWindow = metadata?.effectiveContextWindow ?? metadata?.maxContextWindow ?? 128_000;
  return {
    id: provider.model,
    name: provider.model,
    api: "openai-completions",
    provider: "openai",
    baseUrl: `${provider.host.replace(/\/$/, "")}/v1`,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: metadata?.maxOutputTokens ?? 4096,
  };
}

function makeOpenAiModel(
  provider: Extract<ModelProvider, { type: "openai" }>,
  metadata?: ProviderModelMetadata,
): Model<"openai-completions"> {
  const contextWindow = metadata?.effectiveContextWindow ?? metadata?.maxContextWindow ?? 128_000;
  return {
    id: provider.model,
    name: provider.model,
    api: "openai-completions",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: metadata?.maxOutputTokens ?? 4096,
  };
}
