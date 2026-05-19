import type { ModelProviderClient, ProviderModelMetadata } from "./provider-client.types";

export class OpenAiProviderClient implements ModelProviderClient {
  constructor(private readonly apiKey: string) {}

  async listModels(): Promise<ProviderModelMetadata[]> {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new Error(res.status === 401 ? "Invalid API key" : `OpenAI returned ${res.status}`);
    }
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    return (data.data ?? [])
      .filter((model) => model.id.startsWith("gpt-"))
      .map((model) => ({
        id: model.id,
        name: model.id,
        provider: "openai" as const,
        source: "provider-api" as const,
      }));
  }

  async getModelMetadata(modelId: string): Promise<ProviderModelMetadata | null> {
    const models = await this.listModels();
    return models.find((model) => model.id === modelId) ?? null;
  }
}
