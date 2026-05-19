import { describe, expect, it, vi } from "vitest";
import { ModelMetadataService } from "../ModelMetadataService";

vi.mock("@mariozechner/pi-ai", () => ({
  getModels: vi.fn().mockReturnValue([
    { id: "gpt-4o", name: "gpt-4o", contextWindow: 128_000, maxTokens: 4096 },
  ]),
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
      service.getEffectiveContextWindow({ type: "ollama", host: "http://localhost:11434", model: "llama3.2:3b" }),
    ).resolves.toBe(32_768);
  });

  it("falls back to static metadata for unknown openai model", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("boom")) as typeof fetch;
    const service = new ModelMetadataService();
    const meta = await service.getModelMetadata({ type: "openai", apiKey: "sk-openai", model: "unknown-model" });
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
    const first = await service.getModelMetadata({ type: "ollama", host: "http://localhost:11434", model: "llama3.2:3b" });
    const second = await service.getModelMetadata({ type: "ollama", host: "http://localhost:11434", model: "llama3.2:3b" });
    expect(second).toBe(first);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
