import { describe, expect, it, vi } from "vitest";
import { OllamaProviderClient } from "../OllamaProviderClient";

describe("OllamaProviderClient", () => {
  it("prefers runtime context_length over show-model max context", async () => {
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

    const client = new OllamaProviderClient("http://localhost:11434");
    await expect(client.getModelMetadata("llama3.2:3b")).resolves.toEqual({
      id: "llama3.2:3b",
      name: "llama3.2:3b",
      provider: "ollama",
      maxContextWindow: 131_072,
      effectiveContextWindow: 32_768,
      source: "provider-runtime",
    });
  });

  it("falls back to show-model context when runtime data is absent", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ model_info: { "llama.context_length": 65_536 } }),
      }) as typeof fetch;

    const client = new OllamaProviderClient("http://localhost:11434");
    await expect(client.getModelMetadata("llama3.2:3b")).resolves.toEqual({
      id: "llama3.2:3b",
      name: "llama3.2:3b",
      provider: "ollama",
      maxContextWindow: 65_536,
      effectiveContextWindow: 65_536,
      source: "provider-api",
    });
  });

  it("returns null when both runtime and show fail", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
      }) as typeof fetch;

    const client = new OllamaProviderClient("http://localhost:11434");
    await expect(client.getModelMetadata("unknown")).resolves.toBeNull();
  });

  it("lists models from tags endpoint", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: "llama3.2:3b" }, { name: "mistral:7b" }] }),
    }) as typeof fetch;

    const client = new OllamaProviderClient("http://localhost:11434");
    const models = await client.listModels();
    expect(models).toEqual([
      { id: "llama3.2:3b", name: "llama3.2:3b", provider: "ollama", source: "provider-api" },
      { id: "mistral:7b", name: "mistral:7b", provider: "ollama", source: "provider-api" },
    ]);
  });
});
