import { describe, expect, it, vi } from "vitest";
import { OpenRouterProviderClient } from "../OpenRouterProviderClient";

describe("OpenRouterProviderClient", () => {
  it("maps context_length into both context fields", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "anthropic/claude-sonnet-4-6", name: "Claude Sonnet 4.6", context_length: 200_000 },
        ],
      }),
    }) as typeof fetch;

    const client = new OpenRouterProviderClient("sk-test");
    await expect(client.getModelMetadata("anthropic/claude-sonnet-4-6")).resolves.toEqual({
      id: "anthropic/claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      provider: "openrouter",
      maxContextWindow: 200_000,
      effectiveContextWindow: 200_000,
      source: "provider-api",
    });
  });

  it("lists all models with context metadata", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "openai/gpt-4o", name: "GPT-4o", context_length: 128_000 },
          { id: "anthropic/claude-opus", context_length: 200_000 },
        ],
      }),
    }) as typeof fetch;

    const client = new OpenRouterProviderClient();
    const models = await client.listModels();
    expect(models).toHaveLength(2);
    expect(models[0]).toEqual({
      id: "openai/gpt-4o",
      name: "GPT-4o",
      provider: "openrouter",
      maxContextWindow: 128_000,
      effectiveContextWindow: 128_000,
      source: "provider-api",
    });
    expect(models[1]).toEqual({
      id: "anthropic/claude-opus",
      name: "anthropic/claude-opus",
      provider: "openrouter",
      maxContextWindow: 200_000,
      effectiveContextWindow: 200_000,
      source: "provider-api",
    });
  });

  it("throws on non-ok response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
    }) as typeof fetch;

    const client = new OpenRouterProviderClient("sk-test");
    await expect(client.listModels()).rejects.toThrow("OpenRouter returned 429");
  });
});
