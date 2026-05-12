import type { Api, Model } from "@mariozechner/pi-ai";
import { getModels } from "@mariozechner/pi-ai";
import type { ModelProvider } from "./model-provider";

export interface ModelFactoryOptions {
  provider: ModelProvider;
}

export function createModel(opts: ModelFactoryOptions): Model<Api> {
  return resolveBaseConfig(opts.provider);
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
