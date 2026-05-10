import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  beforeEach(() => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_HOST;
  });

  afterEach(() => {
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    delete process.env.LANGFUSE_HOST;
  });

  it("returns base openrouter model when langfuseEnabled is false", () => {
    const model = createModel({ provider: openrouterProvider, langfuseEnabled: false });
    expect(model.baseUrl).toBe("https://openrouter.ai/api/v1");
  });

  it("returns base openrouter model when langfuseEnabled true but keys missing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const model = createModel({ provider: openrouterProvider, langfuseEnabled: true });
    expect(model.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(warnSpy).toHaveBeenCalledWith(
      "[Langfuse] LANGFUSE_PUBLIC_KEY and/or LANGFUSE_SECRET_KEY missing. Tracing disabled despite langfuseEnabled=true.",
    );
    warnSpy.mockRestore();
  });

  it("overrides baseUrl to LangFuse proxy when enabled and keys present", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    const model = createModel({ provider: openrouterProvider, langfuseEnabled: true });
    expect(model.baseUrl).toContain("cloud.langfuse.com");
    expect(model.baseUrl).toContain("/api/proxy/openai/v1");
  });

  it("includes LangFuse headers when proxy active", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    const model = createModel({ provider: openrouterProvider, langfuseEnabled: true }) as {
      headers: Record<string, string>;
    };
    expect(model.headers["x-langfuse-public-key"]).toBe("pk-test");
    expect(model.headers["x-langfuse-secret-key"]).toBe("sk-test");
    expect(model.headers["x-target-url"]).toBe("https://openrouter.ai/api/v1");
  });

  it("uses custom LANGFUSE_HOST when provided", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    process.env.LANGFUSE_HOST = "https://my-langfuse.example.com";
    const model = createModel({ provider: openrouterProvider, langfuseEnabled: true });
    expect(model.baseUrl).toContain("my-langfuse.example.com");
  });

  it("throws when model ID is not found in registry", async () => {
    const { getModels } = await import("@mariozechner/pi-ai");
    vi.mocked(getModels).mockReturnValueOnce([]);
    expect(() => createModel({ provider: openrouterProvider, langfuseEnabled: false })).toThrow(
      "Unknown OpenRouter model",
    );
  });

  it("returns ollama model config", () => {
    const ollamaProvider = {
      type: "ollama" as const,
      host: "http://localhost:11434",
      model: "llama3",
    };
    const model = createModel({ provider: ollamaProvider, langfuseEnabled: false });
    expect(model.baseUrl).toBe("http://localhost:11434/v1");
    expect(model.id).toBe("llama3");
  });

  it("returns openai model config", () => {
    const openaiProvider = { type: "openai" as const, apiKey: "sk-openai", model: "gpt-4o" };
    const model = createModel({ provider: openaiProvider, langfuseEnabled: false });
    expect(model.baseUrl).toBe("https://api.openai.com/v1");
    expect(model.id).toBe("gpt-4o");
  });

  it("throws for anthropic provider", () => {
    const anthropicProvider = {
      type: "anthropic" as const,
      apiKey: "sk-anthropic",
      model: "claude-3-5-sonnet",
    };
    expect(() => createModel({ provider: anthropicProvider, langfuseEnabled: false })).toThrow(
      "Direct Anthropic API",
    );
  });
});
