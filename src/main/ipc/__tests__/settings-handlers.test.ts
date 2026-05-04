import "reflect-metadata";
import { describe, expect, it } from "vitest";

interface TestSettings {
  activeProvider: "openrouter" | "openai" | "anthropic" | "ollama";
  defaultCloudProvider: "openrouter" | "openai" | "anthropic";
  providerCredentials: {
    openrouter: { apiKey: string | null; defaultModel: string };
    openai: { apiKey: string | null; defaultModel: string };
    anthropic: { apiKey: string | null; defaultModel: string };
    ollama: { host: string; defaultModel: string };
  };
  langfuseEnabled: boolean;
  webAccessEnabled: boolean;
}

// Extract the hasApiKey calculation logic for isolated testing
function computeHasApiKey(settings: TestSettings): boolean {
  const activeCreds = settings.providerCredentials[settings.activeProvider];
  if (settings.activeProvider === "ollama") {
    return true;
  }
  const activeApiKey = "apiKey" in activeCreds ? (activeCreds.apiKey ?? null) : null;
  return activeApiKey !== null && activeApiKey !== "";
}

describe("GET_SETTINGS hasApiKey logic", () => {
  const baseSettings: TestSettings = {
    activeProvider: "openrouter",
    defaultCloudProvider: "openrouter",
    providerCredentials: {
      openrouter: { apiKey: null, defaultModel: "anthropic/claude-sonnet-4-6" },
      openai: { apiKey: null, defaultModel: "gpt-4o" },
      anthropic: { apiKey: null, defaultModel: "claude-3-5-sonnet-20241022" },
      ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
    },
    langfuseEnabled: false,
    webAccessEnabled: true,
  };

  it("returns false for openrouter without api key", () => {
    const settings = { ...baseSettings, activeProvider: "openrouter" as const };
    expect(computeHasApiKey(settings)).toBe(false);
  });

  it("returns true for openrouter with api key", () => {
    const settings = {
      ...baseSettings,
      activeProvider: "openrouter" as const,
      providerCredentials: {
        ...baseSettings.providerCredentials,
        openrouter: { apiKey: "sk-or-test", defaultModel: "anthropic/claude-sonnet-4-6" },
      },
    };
    expect(computeHasApiKey(settings)).toBe(true);
  });

  it("returns false for openai without api key", () => {
    const settings = { ...baseSettings, activeProvider: "openai" as const };
    expect(computeHasApiKey(settings)).toBe(false);
  });

  it("returns true for openai with api key", () => {
    const settings = {
      ...baseSettings,
      activeProvider: "openai" as const,
      providerCredentials: {
        ...baseSettings.providerCredentials,
        openai: { apiKey: "sk-openai", defaultModel: "gpt-4o" },
      },
    };
    expect(computeHasApiKey(settings)).toBe(true);
  });

  it("returns true for ollama (no api key needed)", () => {
    const settings = { ...baseSettings, activeProvider: "ollama" as const };
    expect(computeHasApiKey(settings)).toBe(true);
  });

  it("returns true for ollama with custom host and model", () => {
    const settings = {
      ...baseSettings,
      activeProvider: "ollama" as const,
      providerCredentials: {
        ...baseSettings.providerCredentials,
        ollama: { host: "http://192.168.1.10:11434", defaultModel: "kimi-k2.6" },
      },
    };
    expect(computeHasApiKey(settings)).toBe(true);
  });
});
