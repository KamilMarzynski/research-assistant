import { describe, expect, it, vi } from "vitest";
import { OpenAiProviderClient } from "../OpenAiProviderClient";

describe("OpenAiProviderClient", () => {
  it("returns only gpt-* model IDs without context metadata", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: "gpt-4o" }, { id: "whisper-1" }, { id: "gpt-4o-mini" }],
      }),
    }) as typeof fetch;

    const client = new OpenAiProviderClient("sk-openai");
    await expect(client.listModels()).resolves.toEqual([
      { id: "gpt-4o", name: "gpt-4o", provider: "openai", source: "provider-api" },
      { id: "gpt-4o-mini", name: "gpt-4o-mini", provider: "openai", source: "provider-api" },
    ]);
  });

  it("throws on 401", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    }) as typeof fetch;

    const client = new OpenAiProviderClient("sk-bad");
    await expect(client.listModels()).rejects.toThrow("Invalid API key");
  });

  it("throws on other non-ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }) as typeof fetch;

    const client = new OpenAiProviderClient("sk-test");
    await expect(client.listModels()).rejects.toThrow("OpenAI returned 500");
  });

  it("returns null for unknown model", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: "gpt-4o" }],
      }),
    }) as typeof fetch;

    const client = new OpenAiProviderClient("sk-openai");
    await expect(client.getModelMetadata("unknown")).resolves.toBeNull();
  });
});
