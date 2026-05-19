import type { ModelProviderClient, ProviderModelMetadata } from "./provider-client.types";

export class OpenRouterProviderClient implements ModelProviderClient {
  constructor(private readonly apiKey?: string) {}

  async listModels(): Promise<ProviderModelMetadata[]> {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new Error(`OpenRouter returned ${res.status}`);
    }
    const data = (await res.json()) as {
      data?: Array<{ id: string; name?: string; context_length?: number }>;
    };
    return (data.data ?? []).map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      provider: "openrouter" as const,
      maxContextWindow: model.context_length,
      effectiveContextWindow: model.context_length,
      source: "provider-api" as const,
    }));
  }

  async getModelMetadata(modelId: string): Promise<ProviderModelMetadata | null> {
    const models = await this.listModels();
    return models.find((model) => model.id === modelId) ?? null;
  }
}
