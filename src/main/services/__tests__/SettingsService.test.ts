import "reflect-metadata";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock electron — safeStorage is main-process only
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(s)),
    decryptString: vi.fn((b: Buffer) => b.toString("utf-8")),
  },
}));

// Import after mock is registered
const mod = await import("../SettingsService");
const SettingsService = mod.SettingsService as typeof mod.SettingsService;

describe("SettingsService", () => {
  let tmpDir: string;
  let service: InstanceType<typeof SettingsService>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "settings-test-"));
    service = new SettingsService(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("getSettings", () => {
    it("returns defaults when no settings file exists", async () => {
      const settings = await service.getSettings();
      expect(settings.activeProvider).toBe("openrouter");
      expect(settings.defaultCloudProvider).toBe("openrouter");
      expect(settings.providerCredentials.openrouter.apiKey).toBeNull();
      expect(settings.providerCredentials.openrouter.defaultModel).toBe(
        "anthropic/claude-sonnet-4-6",
      );
      expect(settings.providerCredentials.openai.apiKey).toBeNull();
      expect(settings.providerCredentials.anthropic.apiKey).toBeNull();
      expect(settings.providerCredentials.ollama.host).toBe("http://localhost:11434");
      expect(settings.langfuseEnabled).toBe(false);
    });

    it("returns langfuseEnabled false when no settings file exists", async () => {
      const settings = await service.getSettings();
      expect(settings.langfuseEnabled).toBe(false);
    });
  });

  describe("saveSettings + getSettings round-trip", () => {
    it("saves and retrieves API key via safeStorage", async () => {
      await service.saveSettings({
        providerCredentials: {
          openrouter: { apiKey: "sk-or-test", defaultModel: "anthropic/claude-sonnet-4-6" },
          openai: { apiKey: null, defaultModel: "gpt-4o" },
          anthropic: { apiKey: null, defaultModel: "claude-3-5-sonnet-20241022" },
          ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
        },
      });
      const settings = await service.getSettings();
      expect(settings.providerCredentials.openrouter.apiKey).toBe("sk-or-test");
      expect(settings.providerCredentials.openrouter.defaultModel).toBe(
        "anthropic/claude-sonnet-4-6",
      );
    });

    it("saves and retrieves model without touching API key", async () => {
      await service.saveSettings({
        providerCredentials: {
          openrouter: { apiKey: "sk-or-test", defaultModel: "openai/gpt-4o" },
          openai: { apiKey: null, defaultModel: "gpt-4o" },
          anthropic: { apiKey: null, defaultModel: "claude-3-5-sonnet-20241022" },
          ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
        },
      });
      await service.saveSettings({
        providerCredentials: {
          openrouter: { apiKey: "sk-or-test", defaultModel: "anthropic/claude-haiku-4-5" },
          openai: { apiKey: null, defaultModel: "gpt-4o" },
          anthropic: { apiKey: null, defaultModel: "claude-3-5-sonnet-20241022" },
          ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
        },
      });
      const settings = await service.getSettings();
      expect(settings.providerCredentials.openrouter.apiKey).toBe("sk-or-test");
      expect(settings.providerCredentials.openrouter.defaultModel).toBe(
        "anthropic/claude-haiku-4-5",
      );
    });

    it("saves and retrieves langfuseEnabled true", async () => {
      await service.saveSettings({ langfuseEnabled: true });
      const settings = await service.getSettings();
      expect(settings.langfuseEnabled).toBe(true);
    });

    it("langfuseEnabled defaults to false when missing from stored JSON", async () => {
      // Write a raw JSON file without langfuseEnabled to genuinely simulate an old settings file
      await writeFile(
        join(tmpDir, "settings.json"),
        JSON.stringify({ model: "anthropic/claude-sonnet-4-6" }),
        "utf-8",
      );
      const settings = await service.getSettings();
      expect(settings.langfuseEnabled).toBe(false);
    });

    it("allows clearing API key by passing null", async () => {
      await service.saveSettings({
        providerCredentials: {
          openrouter: { apiKey: "sk-or-test", defaultModel: "anthropic/claude-sonnet-4-6" },
          openai: { apiKey: null, defaultModel: "gpt-4o" },
          anthropic: { apiKey: null, defaultModel: "claude-3-5-sonnet-20241022" },
          ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
        },
      });
      await service.saveSettings({
        providerCredentials: {
          openrouter: { apiKey: null, defaultModel: "anthropic/claude-sonnet-4-6" },
          openai: { apiKey: null, defaultModel: "gpt-4o" },
          anthropic: { apiKey: null, defaultModel: "claude-3-5-sonnet-20241022" },
          ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
        },
      });
      const settings = await service.getSettings();
      expect(settings.providerCredentials.openrouter.apiKey).toBeNull();
    });

    it("encrypts API key via safeStorage.encryptString", async () => {
      const { safeStorage } = await import("electron");
      await service.saveSettings({
        providerCredentials: {
          openrouter: { apiKey: "sk-or-test", defaultModel: "anthropic/claude-sonnet-4-6" },
          openai: { apiKey: null, defaultModel: "gpt-4o" },
          anthropic: { apiKey: null, defaultModel: "claude-3-5-sonnet-20241022" },
          ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
        },
      });
      expect(safeStorage.encryptString).toHaveBeenCalledWith("sk-or-test");
    });
  });

  describe("safeStorage unavailable fallback", () => {
    it("stores and retrieves API key as plain base64 when encryption is unavailable", async () => {
      const { safeStorage } = await import("electron");
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);

      await service.saveSettings({
        providerCredentials: {
          openrouter: { apiKey: "sk-plain-key", defaultModel: "anthropic/claude-sonnet-4-6" },
          openai: { apiKey: null, defaultModel: "gpt-4o" },
          anthropic: { apiKey: null, defaultModel: "claude-3-5-sonnet-20241022" },
          ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
        },
      });
      const settings = await service.getSettings();

      expect(settings.providerCredentials.openrouter.apiKey).toBe("sk-plain-key");

      // Restore default
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
    });

    it("emits console.warn when saving without encryption", async () => {
      const { safeStorage } = await import("electron");
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await service.saveSettings({
        providerCredentials: {
          openrouter: { apiKey: "sk-plain-key", defaultModel: "anthropic/claude-sonnet-4-6" },
          openai: { apiKey: null, defaultModel: "gpt-4o" },
          anthropic: { apiKey: null, defaultModel: "claude-3-5-sonnet-20241022" },
          ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
        },
      });

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("safeStorage unavailable"));

      warnSpy.mockRestore();
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
    });
  });

  describe("v0 → v1 migration", () => {
    it("migrates old encryptedApiKey + model to providerCredentials.openrouter", async () => {
      await writeFile(
        join(tmpDir, "settings.json"),
        JSON.stringify({
          encryptedApiKey: Buffer.from("sk-legacy").toString("base64"),
          model: "legacy-model",
          langfuseEnabled: true,
        }),
        "utf-8",
      );

      const settings = await service.getSettings();
      expect(settings.providerCredentials.openrouter.apiKey).toBe("sk-legacy");
      expect(settings.providerCredentials.openrouter.defaultModel).toBe("legacy-model");
      expect(settings.providerCredentials.openai.defaultModel).toBe("gpt-4o");
      expect(settings.providerCredentials.anthropic.defaultModel).toBe(
        "claude-3-5-sonnet-20241022",
      );
      expect(settings.providerCredentials.ollama.host).toBe("http://localhost:11434");
      expect(settings.langfuseEnabled).toBe(true);

      // Verify stored file was rewritten to v1
      const raw = await readFile(join(tmpDir, "settings.json"), "utf-8");
      const stored = JSON.parse(raw);
      expect(stored.version).toBe(1);
      expect(stored.encryptedApiKey).toBeUndefined();
      expect(stored.model).toBeUndefined();
    });
  });
});
