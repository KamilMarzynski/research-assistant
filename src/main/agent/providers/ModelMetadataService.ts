import { getModels } from "@mariozechner/pi-ai";
import type { ModelProvider } from "../model-provider";
import { OpenAiProviderClient } from "./OpenAiProviderClient";
import { OllamaProviderClient } from "./OllamaProviderClient";
import { OpenRouterProviderClient } from "./OpenRouterProviderClient";
import type { ModelProviderClient, ProviderModelMetadata } from "./provider-client.types";
import { getDefaultContextWindow, getStaticModelMetadata } from "./static-model-metadata";

const SUCCESS_TTL_MS = 5 * 60 * 1000;
const FAILURE_TTL_MS = 30 * 1000;

interface CacheEntry {
  expiresAt: number;
  value: ProviderModelMetadata;
}

function fromPiAi(provider: "openrouter" | "openai", modelId: string): ProviderModelMetadata | null {
  const model = getModels(provider).find((candidate) => candidate.id === modelId);
  if (!model?.contextWindow) return null;
  return {
    id: model.id,
    name: model.name,
    provider,
    maxContextWindow: model.contextWindow,
    effectiveContextWindow: model.contextWindow,
    maxOutputTokens: model.maxTokens,
    source: "pi-ai",
  };
}

export class ModelMetadataService {
  private readonly cache = new Map<string, CacheEntry>();

  private buildKey(provider: ModelProvider): string {
    return provider.type === "ollama"
      ? `ollama:${provider.host}:${provider.model}`
      : `${provider.type}:${provider.model}`;
  }

  private getClient(provider: ModelProvider): ModelProviderClient {
    switch (provider.type) {
      case "openrouter":
        return new OpenRouterProviderClient(provider.apiKey);
      case "openai":
        return new OpenAiProviderClient(provider.apiKey);
      case "ollama":
        return new OllamaProviderClient(provider.host);
      case "anthropic":
        throw new Error("Anthropic provider is not supported here");
    }
  }

  async getModelMetadata(provider: ModelProvider): Promise<ProviderModelMetadata> {
    const cacheKey = this.buildKey(provider);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const fallback = getStaticModelMetadata(
      provider.type === "anthropic" ? "openrouter" : provider.type,
      provider.model,
    );

    try {
      if (provider.type === "openrouter" || provider.type === "ollama") {
        const providerValue = await this.getClient(provider).getModelMetadata(provider.model);
        if (providerValue?.effectiveContextWindow || providerValue?.maxContextWindow) {
          this.cache.set(cacheKey, {
            value: providerValue,
            expiresAt: Date.now() + SUCCESS_TTL_MS,
          });
          return providerValue;
        }
      }

      if (provider.type === "openrouter" || provider.type === "openai") {
        const piAiValue = fromPiAi(provider.type, provider.model);
        if (piAiValue) {
          this.cache.set(cacheKey, {
            value: piAiValue,
            expiresAt: Date.now() + SUCCESS_TTL_MS,
          });
          return piAiValue;
        }
      }

      this.cache.set(cacheKey, { value: fallback, expiresAt: Date.now() + FAILURE_TTL_MS });
      return fallback;
    } catch {
      if (provider.type === "openrouter" || provider.type === "openai") {
        const piAiValue = fromPiAi(provider.type, provider.model);
        if (piAiValue) {
          this.cache.set(cacheKey, {
            value: piAiValue,
            expiresAt: Date.now() + SUCCESS_TTL_MS,
          });
          return piAiValue;
        }
      }

      this.cache.set(cacheKey, { value: fallback, expiresAt: Date.now() + FAILURE_TTL_MS });
      return fallback;
    }
  }

  async getEffectiveContextWindow(provider: ModelProvider): Promise<number> {
    const metadata = await this.getModelMetadata(provider);
    return (
      metadata.effectiveContextWindow ??
      metadata.maxContextWindow ??
      getDefaultContextWindow()
    );
  }
}

export const modelMetadataService = new ModelMetadataService();
