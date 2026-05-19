import { OllamaProviderClient } from "./providers/OllamaProviderClient";
import { OpenAiProviderClient } from "./providers/OpenAiProviderClient";
import { OpenRouterProviderClient } from "./providers/OpenRouterProviderClient";
import type { ProviderModelMetadata } from "./providers/provider-client.types";

export interface ModelDiscoveryResult {
  models: ProviderModelMetadata[];
  error?: string;
}

export async function getOllamaModels(host: string): Promise<ModelDiscoveryResult> {
  try {
    const models = await new OllamaProviderClient(host).listModels();
    return { models };
  } catch (error) {
    return {
      models: [],
      error: error instanceof Error ? error.message : "Ollama not reachable",
    };
  }
}

export async function getOpenRouterModels(apiKey?: string): Promise<ModelDiscoveryResult> {
  try {
    const models = await new OpenRouterProviderClient(apiKey).listModels();
    return { models };
  } catch (error) {
    return {
      models: [],
      error: error instanceof Error ? error.message : "OpenRouter request failed",
    };
  }
}

export async function getOpenAiModels(apiKey: string): Promise<ModelDiscoveryResult> {
  try {
    const models = await new OpenAiProviderClient(apiKey).listModels();
    return { models };
  } catch (error) {
    return {
      models: [],
      error: error instanceof Error ? error.message : "OpenAI request failed",
    };
  }
}
