import { describe, expect, it, vi } from "vitest";

const mockBaseModel = {
  id: "anthropic/claude-sonnet-4-6",
  provider: "openrouter",
  api: "openai-completions",
  baseUrl: "https://openrouter.ai/api/v1",
  headers: { "HTTP-Referer": "https://example.com" },
};

vi.mock("@mariozechner/pi-ai", () => ({
  getModel: vi.fn().mockReturnValue(mockBaseModel),
  getModels: vi.fn().mockReturnValue([mockBaseModel]),
}));

const { createModel } = await import("../model-factory");

const openrouterProvider = {
  type: "openrouter" as const,
  apiKey: "sk-test",
  model: "anthropic/claude-sonnet-4-6",
};

describe("createModel", () => {
  it("returns base openrouter model", () => {
    const model = createModel({ provider: openrouterProvider });
    expect(model.baseUrl).toBe("https://openrouter.ai/api/v1");
  });

  it("throws when model ID is not found in registry", async () => {
    const { getModels } = await import("@mariozechner/pi-ai");
    vi.mocked(getModels).mockReturnValueOnce([]);
    expect(() => createModel({ provider: openrouterProvider })).toThrow("Unknown OpenRouter model");
  });

  it("returns ollama model config", () => {
    const ollamaProvider = {
      type: "ollama" as const,
      host: "http://localhost:11434",
      model: "llama3",
    };
    const model = createModel({ provider: ollamaProvider });
    expect(model.baseUrl).toBe("http://localhost:11434/v1");
    expect(model.id).toBe("llama3");
  });

  it("returns openai model config", () => {
    const openaiProvider = { type: "openai" as const, apiKey: "sk-openai", model: "gpt-4o" };
    const model = createModel({ provider: openaiProvider });
    expect(model.baseUrl).toBe("https://api.openai.com/v1");
    expect(model.id).toBe("gpt-4o");
  });

  it("throws for anthropic provider", () => {
    const anthropicProvider = {
      type: "anthropic" as const,
      apiKey: "sk-anthropic",
      model: "claude-3-5-sonnet",
    };
    expect(() => createModel({ provider: anthropicProvider })).toThrow("Direct Anthropic API");
  });
});
