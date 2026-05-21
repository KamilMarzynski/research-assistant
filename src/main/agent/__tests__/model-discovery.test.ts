import { describe, expect, it, vi } from "vitest";
import { getOllamaModels, getOpenAiModels, getOpenRouterModels } from "../model-discovery";

describe("getOllamaModels", () => {
  it("returns models on success", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: "llama3.2:3b" }, { name: "mistral:7b" }] }),
    });
    const result = await getOllamaModels("http://localhost:11434");
    expect(result.models).toEqual([
      { id: "llama3.2:3b", name: "llama3.2:3b", provider: "ollama", source: "provider-api" },
      { id: "mistral:7b", name: "mistral:7b", provider: "ollama", source: "provider-api" },
    ]);
    expect(result.error).toBeUndefined();
  });

  it("returns error on fetch failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
    const result = await getOllamaModels("http://localhost:11434");
    expect(result.models).toEqual([]);
    expect(result.error).toBe("Connection refused");
  });

  it("returns fallback error when thrown value is not an Error", async () => {
    global.fetch = vi.fn().mockRejectedValue("random string");
    const result = await getOllamaModels("http://localhost:11434");
    expect(result.error).toBe("Ollama not reachable");
  });

  it("returns error for non-http protocol", async () => {
    const result = await getOllamaModels("file:///etc/passwd");
    expect(result.models).toEqual([]);
    expect(result.error).toBe("Invalid protocol — must be http or https");
  });

  it("returns error on non-ok response", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const result = await getOllamaModels("http://localhost:11434");
    expect(result.error).toBe("Ollama returned 500");
  });

  it("handles empty models array", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }),
    });
    const result = await getOllamaModels("http://localhost:11434");
    expect(result.models).toEqual([]);
    expect(result.error).toBeUndefined();
  });
});

describe("getOpenRouterModels", () => {
  it("returns models unauthenticated", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "anthropic/claude-sonnet-4-6", name: "Claude Sonnet 4.6", context_length: 200_000 },
          { id: "openai/gpt-4o", context_length: 128_000 },
        ],
      }),
    });
    const result = await getOpenRouterModels();
    expect(result.models).toEqual([
      {
        id: "anthropic/claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        provider: "openrouter",
        maxContextWindow: 200_000,
        effectiveContextWindow: 200_000,
        source: "provider-api",
      },
      {
        id: "openai/gpt-4o",
        name: "openai/gpt-4o",
        provider: "openrouter",
        maxContextWindow: 128_000,
        effectiveContextWindow: 128_000,
        source: "provider-api",
      },
    ]);
    expect(result.error).toBeUndefined();
  });

  it("sends apiKey when provided", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });
    await getOpenRouterModels("sk-test");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer sk-test" },
      }),
    );
  });

  it("returns error on failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
    const result = await getOpenRouterModels();
    expect(result.error).toBe("Network error");
  });

  it("returns fallback error when thrown value is not an Error", async () => {
    global.fetch = vi.fn().mockRejectedValue(123);
    const result = await getOpenRouterModels();
    expect(result.error).toBe("OpenRouter request failed");
  });

  it("returns error on non-ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    const result = await getOpenRouterModels();
    expect(result.error).toBe("OpenRouter returned 429");
  });
});

describe("getOpenAiModels", () => {
  it("returns only gpt-* models", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "gpt-4o" },
          { id: "text-embedding-ada-002" },
          { id: "gpt-4o-mini" },
          { id: "whisper-1" },
        ],
      }),
    });
    const result = await getOpenAiModels("sk-test");
    expect(result.models).toEqual([
      { id: "gpt-4o", name: "gpt-4o", provider: "openai", source: "provider-api" },
      { id: "gpt-4o-mini", name: "gpt-4o-mini", provider: "openai", source: "provider-api" },
    ]);
    expect(result.error).toBeUndefined();
  });

  it("returns 401 error", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    const result = await getOpenAiModels("sk-bad");
    expect(result.error).toBe("Invalid API key");
  });

  it("returns error on network failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Timeout"));
    const result = await getOpenAiModels("sk-test");
    expect(result.error).toBe("Timeout");
  });

  it("returns fallback error when thrown value is not an Error", async () => {
    global.fetch = vi.fn().mockRejectedValue({ foo: "bar" });
    const result = await getOpenAiModels("sk-test");
    expect(result.error).toBe("OpenAI request failed");
  });

  it("returns error on non-ok non-401", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const result = await getOpenAiModels("sk-test");
    expect(result.error).toBe("OpenAI returned 500");
  });
});
