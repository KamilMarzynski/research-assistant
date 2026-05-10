import { describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../../services/SettingsService";
import { checkOllamaAvailable, isCloudProvider, resolveProvider } from "../model-provider";

const baseSettings: AppSettings = {
  activeProvider: "openrouter",
  providerCredentials: {
    openrouter: { apiKey: "sk-test", defaultModel: "anthropic/claude-sonnet-4-6" },
    openai: { apiKey: "sk-openai", defaultModel: "gpt-4o" },
    ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
  },
  langfuseEnabled: false,
  webAccessEnabled: true,
  theme: "system",
};

describe("isCloudProvider", () => {
  it("returns true for openrouter", () => {
    expect(isCloudProvider({ type: "openrouter", apiKey: "", model: "" })).toBe(true);
  });
  it("returns true for openai", () => {
    expect(isCloudProvider({ type: "openai", apiKey: "", model: "" })).toBe(true);
  });
  it("returns false for ollama", () => {
    expect(isCloudProvider({ type: "ollama", host: "", model: "" })).toBe(false);
  });
});

describe("getCloudCreds edge cases", () => {
  it("falls back to default cloud provider when credentials object is malformed", () => {
    const settings = {
      ...baseSettings,
      providerCredentials: {
        ...baseSettings.providerCredentials,
        openrouter: "not-an-object" as never,
      },
    };
    const p = resolveProvider({ settings });
    expect((p as { apiKey?: string }).apiKey).toBe("");
    expect((p as { model?: string }).model).toBe("");
  });

  it("falls back when credentials object is null", () => {
    const settings = {
      ...baseSettings,
      providerCredentials: {
        ...baseSettings.providerCredentials,
        openrouter: null as never,
      },
    };
    const p = resolveProvider({ settings });
    expect((p as { apiKey?: string }).apiKey).toBe("");
    expect((p as { model?: string }).model).toBe("");
  });
});

describe("resolveProvider", () => {
  it("resolves openrouter when active", () => {
    const p = resolveProvider({ settings: baseSettings });
    expect(p).toEqual({
      type: "openrouter",
      apiKey: "sk-test",
      model: "anthropic/claude-sonnet-4-6",
    });
  });

  it("resolves ollama when active", () => {
    const settings = { ...baseSettings, activeProvider: "ollama" as const };
    const p = resolveProvider({ settings });
    expect(p).toEqual({ type: "ollama", host: "http://localhost:11434", model: "llama3.2:3b" });
  });

  it("resolves openai when active", () => {
    const settings = { ...baseSettings, activeProvider: "openai" as const };
    const p = resolveProvider({ settings });
    expect(p).toEqual({ type: "openai", apiKey: "sk-openai", model: "gpt-4o" });
  });

  it("respects forceCloud", () => {
    const settings = { ...baseSettings, activeProvider: "ollama" as const };
    const p = resolveProvider({ settings, forceCloud: true });
    expect(p.type).toBe("openrouter");
    expect(p.model).toBe("anthropic/claude-sonnet-4-6");
  });

  it("respects projectModelOverride", () => {
    const p = resolveProvider({
      settings: baseSettings,
      projectModelOverride: "ollama:mistral:7b",
    });
    expect(p).toEqual({ type: "ollama", host: "http://localhost:11434", model: "mistral:7b" });
  });

  it("falls back to default cloud provider for unknown override", () => {
    const p = resolveProvider({
      settings: baseSettings,
      projectModelOverride: "unknown:model",
    });
    expect(p.type).toBe("openrouter");
  });

  it("handles ollama override with colons in model name", () => {
    const p = resolveProvider({
      settings: baseSettings,
      projectModelOverride: "ollama:llama3.2:3b",
    });
    expect(p).toEqual({ type: "ollama", host: "http://localhost:11434", model: "llama3.2:3b" });
  });

  it("handles openrouter override", () => {
    const p = resolveProvider({
      settings: baseSettings,
      projectModelOverride: "openrouter:anthropic/claude-sonnet-4-6",
    });
    expect(p).toEqual({
      type: "openrouter",
      apiKey: "sk-test",
      model: "anthropic/claude-sonnet-4-6",
    });
  });

  it("handles openai override", () => {
    const p = resolveProvider({
      settings: baseSettings,
      projectModelOverride: "openai:gpt-4o",
    });
    expect(p).toEqual({ type: "openai", apiKey: "sk-openai", model: "gpt-4o" });
  });

  it("falls back to default when override has no model part", () => {
    const p = resolveProvider({
      settings: baseSettings,
      projectModelOverride: "openrouter:",
    });
    expect(p.type).toBe("openrouter");
  });

  it("resolves with invalid active provider to default cloud provider", () => {
    const settings = { ...baseSettings, activeProvider: "invalid" as never };
    const p = resolveProvider({ settings });
    expect(p.type).toBe("openrouter");
  });
});

describe("checkOllamaAvailable", () => {
  it("returns true when fetch succeeds", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    const result = await checkOllamaAvailable("http://localhost:11434");
    expect(result).toBe(true);
  });

  it("returns false when fetch fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
    const result = await checkOllamaAvailable("http://localhost:11434");
    expect(result).toBe(false);
  });

  it("returns false for non-http protocols", async () => {
    const result = await checkOllamaAvailable("file:///etc/passwd");
    expect(result).toBe(false);
  });
});
