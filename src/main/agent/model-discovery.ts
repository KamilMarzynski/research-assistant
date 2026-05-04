export interface DiscoveredModel {
  id: string;
  name: string;
}

export interface ModelDiscoveryResult {
  models: DiscoveredModel[];
  error?: string;
}

export async function getOllamaModels(host: string): Promise<ModelDiscoveryResult> {
  try {
    const url = new URL("/api/tags", host);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { models: [], error: "Invalid protocol — must be http or https" };
    }
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { models: [], error: `Ollama returned ${res.status}` };
    }
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const models = (data.models ?? []).map((m) => ({ id: m.name, name: m.name }));
    return { models };
  } catch {
    return { models: [], error: "Ollama not reachable" };
  }
}

export async function getOpenRouterModels(apiKey?: string): Promise<ModelDiscoveryResult> {
  try {
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { models: [], error: `OpenRouter returned ${res.status}` };
    }
    const data = (await res.json()) as {
      data?: Array<{ id: string; name?: string }>;
    };
    const models = (data.data ?? []).map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
    }));
    return { models };
  } catch {
    return { models: [], error: "OpenRouter request failed" };
  }
}

export async function getOpenAiModels(apiKey: string): Promise<ModelDiscoveryResult> {
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      if (res.status === 401) {
        return { models: [], error: "Invalid API key" };
      }
      return { models: [], error: `OpenAI returned ${res.status}` };
    }
    const data = (await res.json()) as { data?: Array<{ id: string }> };
    const models = (data.data ?? [])
      .filter((m) => m.id.startsWith("gpt-"))
      .map((m) => ({ id: m.id, name: m.id }));
    return { models };
  } catch {
    return { models: [], error: "OpenAI request failed" };
  }
}
