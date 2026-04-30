import { describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../../services/SettingsService";
import {
  checkOllamaAvailable,
  isCloudProvider,
  resolveProvider,
  resolveProviderWithFallback,
} from "../model-provider";

const baseSettings: AppSettings = {
  activeProvider: "openrouter",
  defaultCloudProvider: "openrouter",
  providerCredentials: {
    openrouter: { apiKey: "sk-test", defaultModel: "anthropic/claude-sonnet-4-6" },
    openai: { apiKey: "sk-openai", defaultModel: "gpt-4o" },
    anthropic: { apiKey: "sk-anthropic", defaultModel: "claude-3-5-sonnet-20241022" },
    ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
  },
  langfuseEnabled: false,
  webAccessEnabled: true,
};

describe("isCloudProvider", () => {
  it("returns true for openrouter", () => {
    expect(isCloudProvider({ type: "openrouter", apiKey: "", model: "" })).toBe(true);
  });
  it("returns true for openai", () => {
    expect(isCloudProvider({ type: "openai", apiKey: "", model: "" })).toBe(true);
  });
  it("returns true for anthropic", () => {
    expect(isCloudProvider({ type: "anthropic", apiKey: "", model: "" })).toBe(true);
  });
  it("returns false for ollama", () => {
    expect(isCloudProvider({ type: "ollama", host: "", model: "" })).toBe(false);
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

describe("resolveProviderWithFallback", () => {
  it("returns ollama when available", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    const settings = { ...baseSettings, activeProvider: "ollama" as const };
    const p = await resolveProviderWithFallback({ settings });
    expect(p.type).toBe("ollama");
  });

  it("falls back to default cloud when ollama unavailable", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
    const settings = { ...baseSettings, activeProvider: "ollama" as const };
    const p = await resolveProviderWithFallback({ settings });
    expect(p.type).toBe("openrouter");
  });

  it("emits fallback event when ollama is down", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
    const settings = { ...baseSettings, activeProvider: "ollama" as const };
    const emitMock = vi.fn();
    const eventBus = { emit: emitMock };
    await resolveProviderWithFallback({ settings }, eventBus);
    expect(emitMock).toHaveBeenCalledWith({
      type: "model:fallback",
      payload: {
        reason: "ollama_unavailable",
        requestedModel: "llama3.2:3b",
        fallbackProvider: "openrouter",
      },
    });
  });

  it("does not check ollama for non-ollama providers", async () => {
    global.fetch = vi.fn();
    const p = await resolveProviderWithFallback({ settings: baseSettings });
    expect(p.type).toBe("openrouter");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
