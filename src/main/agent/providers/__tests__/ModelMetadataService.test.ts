import { describe, expect, it, vi } from "vitest";
import { ModelMetadataService } from "../ModelMetadataService";

vi.mock("@mariozechner/pi-ai", () => ({
  getModels: vi
    .fn()
    .mockReturnValue([{ id: "gpt-4o", name: "gpt-4o", contextWindow: 128_000, maxTokens: 4096 }]),
}));

describe("ModelMetadataService", () => {
  it("uses pi-ai for openai context fallback when provider api fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("boom")) as typeof fetch;
    const service = new ModelMetadataService();
    await expect(
      service.getEffectiveContextWindow({ type: "openai", apiKey: "sk-openai", model: "gpt-4o" }),
    ).resolves.toBe(128_000);
  });

  it("uses provider runtime context for ollama when available", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: "llama3.2:3b", context_length: 32_768 }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ model_info: { "llama.context_length": 131_072 } }),
      }) as typeof fetch;

    const service = new ModelMetadataService();
    await expect(
      service.getEffectiveContextWindow({
        type: "ollama",
        host: "http://localhost:11434",
        model: "llama3.2:3b",
      }),
    ).resolves.toBe(32_768);
  });

  it("falls back to static metadata for unknown openai model", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("boom")) as typeof fetch;
    const service = new ModelMetadataService();
    const meta = await service.getModelMetadata({
      type: "openai",
      apiKey: "sk-openai",
      model: "unknown-model",
    });
    expect(meta.source).toBe("static-fallback");
    expect(meta.effectiveContextWindow).toBe(128_000);
  });

  it("caches successful lookups", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: "llama3.2:3b", context_length: 32_768 }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ model_info: { "llama.context_length": 131_072 } }),
      }) as typeof fetch;

    const service = new ModelMetadataService();
    const first = await service.getModelMetadata({
      type: "ollama",
      host: "http://localhost:11434",
      model: "llama3.2:3b",
    });
    const second = await service.getModelMetadata({
      type: "ollama",
      host: "http://localhost:11434",
      model: "llama3.2:3b",
    });
    expect(second).toBe(first);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("returns static fallback for anthropic provider", async () => {
    const service = new ModelMetadataService();
    const meta = await service.getModelMetadata({
      type: "anthropic",
      apiKey: "sk-ant",
      model: "claude-3-5-sonnet-20241022",
    });
    expect(meta.source).toBe("static-fallback");
    expect(meta.effectiveContextWindow).toBe(200_000);
  });

  it("uses openrouter runtime metadata when available", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: "openai/gpt-4o", name: "GPT-4o", context_length: 128_000 }],
      }),
    }) as typeof fetch;

    const service = new ModelMetadataService();
    const meta = await service.getModelMetadata({
      type: "openrouter",
      apiKey: "sk",
      model: "openai/gpt-4o",
    });
    expect(meta.source).toBe("provider-api");
    expect(meta.effectiveContextWindow).toBe(128_000);
  });

  it("falls back to pi-ai for openrouter on fetch failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network")) as typeof fetch;
    const service = new ModelMetadataService();
    const meta = await service.getModelMetadata({
      type: "openrouter",
      apiKey: "sk",
      model: "gpt-4o",
    });
    expect(meta.source).toBe("pi-ai");
    expect(meta.effectiveContextWindow).toBe(128_000);
  });

  it("falls back to maxContextWindow when effectiveContextWindow is missing", async () => {
    const service = new ModelMetadataService();
    vi.spyOn(service, "getModelMetadata").mockResolvedValue({
      id: "test",
      name: "test",
      provider: "openai",
      maxContextWindow: 64_000,
      source: "static-fallback",
    });
    const window = await service.getEffectiveContextWindow({
      type: "openai",
      apiKey: "sk",
      model: "test",
    });
    expect(window).toBe(64_000);
  });

  it("falls back to default context window when both are missing", async () => {
    const service = new ModelMetadataService();
    vi.spyOn(service, "getModelMetadata").mockResolvedValue({
      id: "test",
      name: "test",
      provider: "openai",
      source: "static-fallback",
    });
    const window = await service.getEffectiveContextWindow({
      type: "openai",
      apiKey: "sk",
      model: "test",
    });
    expect(window).toBe(128_000);
  });
});
