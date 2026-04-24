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
}));

const { createModel } = await import("../model-factory");

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
    const model = createModel("anthropic/claude-sonnet-4-6", false);
    expect(model.baseUrl).toBe("https://openrouter.ai/api/v1");
  });

  it("returns base openrouter model when langfuseEnabled true but keys missing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const model = createModel("anthropic/claude-sonnet-4-6", true);
    expect(model.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("LangFuse keys"));
    warnSpy.mockRestore();
  });

  it("overrides baseUrl to LangFuse proxy when enabled and keys present", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    const model = createModel("anthropic/claude-sonnet-4-6", true);
    expect(model.baseUrl).toContain("cloud.langfuse.com");
    expect(model.baseUrl).toContain("/api/proxy/openai/v1");
  });

  it("includes LangFuse headers when proxy active", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    const model = createModel("anthropic/claude-sonnet-4-6", true) as {
      headers: Record<string, string>;
    };
    expect(model.headers["x-langfuse-public-key"]).toBe("pk-test");
    expect(model.headers["x-langfuse-secret-key"]).toBe("sk-test");
    expect(model.headers["x-langfuse-baseurl"]).toBe("https://openrouter.ai/api/v1");
  });

  it("uses custom LANGFUSE_HOST when provided", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
    process.env.LANGFUSE_HOST = "https://my-langfuse.example.com";
    const model = createModel("anthropic/claude-sonnet-4-6", true);
    expect(model.baseUrl).toContain("my-langfuse.example.com");
  });

  it("throws when model ID is not found in registry", async () => {
    const { getModel } = await import("@mariozechner/pi-ai");
    // biome-ignore lint/suspicious/noExplicitAny: test-only cast to simulate unknown model
    vi.mocked(getModel).mockReturnValueOnce(undefined as any);
    expect(() => createModel("unknown/model", false)).toThrow("Unknown model");
  });
});
