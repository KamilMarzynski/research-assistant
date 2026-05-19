import type { ModelProviderClient, ProviderModelMetadata } from "./provider-client.types";

function parseShowContextWindow(modelInfo: Record<string, unknown> | undefined): number | undefined {
  if (!modelInfo) return undefined;
  const numericValues = Object.entries(modelInfo)
    .filter(([key, value]) => key.includes("context_length") && typeof value === "number")
    .map(([, value]) => value as number);
  return numericValues[0];
}

export class OllamaProviderClient implements ModelProviderClient {
  constructor(private readonly host: string) {}

  async listModels(): Promise<ProviderModelMetadata[]> {
    const url = new URL("/api/tags", this.host);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Invalid protocol — must be http or https");
    }
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status}`);
    }
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((model) => ({
      id: model.name,
      name: model.name,
      provider: "ollama" as const,
      source: "provider-api" as const,
    }));
  }

  async getModelMetadata(modelId: string): Promise<ProviderModelMetadata | null> {
    const url = new URL("/api/ps", this.host);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Invalid protocol — must be http or https");
    }
    const runtimeRes = await fetch(url.toString(), {
      signal: AbortSignal.timeout(5000),
    });
    const runtimeData = runtimeRes.ok
      ? ((await runtimeRes.json()) as { models?: Array<{ name: string; size?: number; context_length?: number }> })
      : { models: [] };
    const runtimeMatch = runtimeData.models?.find((model) => model.name === modelId);

    const showUrl = new URL("/api/show", this.host);
    if (showUrl.protocol !== "http:" && showUrl.protocol !== "https:") {
      throw new Error("Invalid protocol — must be http or https");
    }
    const showRes = await fetch(showUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId }),
      signal: AbortSignal.timeout(5000),
    });
    if (!showRes.ok && !runtimeMatch) {
      return null;
    }

    const showData = showRes.ok
      ? ((await showRes.json()) as { model_info?: Record<string, unknown> })
      : undefined;
    const declaredMax = parseShowContextWindow(showData?.model_info);
    const effective = runtimeMatch?.context_length ?? declaredMax;

    return {
      id: modelId,
      name: modelId,
      provider: "ollama",
      maxContextWindow: declaredMax,
      effectiveContextWindow: effective,
      source: runtimeMatch?.context_length ? "provider-runtime" : "provider-api",
    };
  }
}
