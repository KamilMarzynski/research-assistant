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
  dialog: {
    showErrorBox: vi.fn(),
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
      expect(settings.providerCredentials.openrouter.apiKey).toBeNull();
      expect(settings.providerCredentials.openrouter.defaultModel).toBe(
        "anthropic/claude-sonnet-4-6",
      );
      expect(settings.providerCredentials.openai.apiKey).toBeNull();
      expect(settings.providerCredentials.ollama.host).toBe("http://localhost:11434");
      expect(settings.langfuseEnabled).toBe(false);
      expect(settings.webAccessEnabled).toBe(true);
    });

    it("returns langfuseEnabled false when no settings file exists", async () => {
      const settings = await service.getSettings();
      expect(settings.langfuseEnabled).toBe(false);
      expect(settings.webAccessEnabled).toBe(true);
    });
  });

  describe("saveSettings + getSettings round-trip", () => {
    it("saves and retrieves API key via safeStorage", async () => {
      await service.saveSettings({
        providerCredentials: {
          openrouter: { apiKey: "sk-or-test", defaultModel: "anthropic/claude-sonnet-4-6" },
          openai: { apiKey: null, defaultModel: "gpt-4o" },
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
          ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
        },
      });
      await service.saveSettings({
        providerCredentials: {
          openrouter: { apiKey: "sk-or-test", defaultModel: "anthropic/claude-haiku-4-5" },
          openai: { apiKey: null, defaultModel: "gpt-4o" },
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
      expect(settings.webAccessEnabled).toBe(true);
    });

    it("migration: webAccessEnabled defaults to true even when langfuseEnabled is false", async () => {
      // V0 settings with no webAccessEnabled but explicit langfuseEnabled=false
      await writeFile(
        join(tmpDir, "settings.json"),
        JSON.stringify({ langfuseEnabled: false, model: "anthropic/claude-sonnet-4-6" }),
        "utf-8",
      );
      const settings = await service.getSettings();
      expect(settings.langfuseEnabled).toBe(false);
      // Bug was: webAccessEnabled: stored.langfuseEnabled ?? true → false when langfuseEnabled=false
      expect(settings.webAccessEnabled).toBe(true);
    });

    it("allows clearing API key by passing null", async () => {
      await service.saveSettings({
        providerCredentials: {
          openrouter: { apiKey: "sk-or-test", defaultModel: "anthropic/claude-sonnet-4-6" },
          openai: { apiKey: null, defaultModel: "gpt-4o" },
          ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
        },
      });
      await service.saveSettings({
        providerCredentials: {
          openrouter: { apiKey: null, defaultModel: "anthropic/claude-sonnet-4-6" },
          openai: { apiKey: null, defaultModel: "gpt-4o" },
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
          ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
        },
      });
      expect(safeStorage.encryptString).toHaveBeenCalledWith("sk-or-test");
    });
  });

  describe("safeStorage unavailable fallback", () => {
    it("throws when encryption is unavailable on save", async () => {
      const { safeStorage, dialog } = await import("electron");
      (safeStorage.isEncryptionAvailable as ReturnType<typeof vi.fn>).mockReturnValue(false);

      await expect(
        service.saveSettings({
          providerCredentials: {
            openrouter: { apiKey: "sk-plain-key", defaultModel: "anthropic/claude-sonnet-4-6" },
            openai: { apiKey: null, defaultModel: "gpt-4o" },
            ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
          },
        }),
      ).rejects.toThrow("safeStorage unavailable");

      expect(dialog.showErrorBox).toHaveBeenCalledWith(
        "Encryption Unavailable",
        expect.stringContaining("secure credential storage"),
      );

      // Restore default
      (safeStorage.isEncryptionAvailable as ReturnType<typeof vi.fn>).mockReturnValue(true);
    });

    it("throws when encryption is unavailable on get (decrypt fails)", async () => {
      // First save with encryption available (stores encrypted data)
      await service.saveSettings({
        providerCredentials: {
          openrouter: { apiKey: "sk-plain-key", defaultModel: "anthropic/claude-sonnet-4-6" },
          openai: { apiKey: null, defaultModel: "gpt-4o" },
          ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
        },
      });

      // Now make decryption unavailable
      const { safeStorage, dialog } = await import("electron");
      (safeStorage.isEncryptionAvailable as ReturnType<typeof vi.fn>).mockReturnValue(false);

      await expect(service.getSettings()).rejects.toThrow("safeStorage unavailable");

      expect(dialog.showErrorBox).toHaveBeenCalledWith(
        "Encryption Unavailable",
        expect.stringContaining("secure credential storage"),
      );

      // Restore default
      (safeStorage.isEncryptionAvailable as ReturnType<typeof vi.fn>).mockReturnValue(true);
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
      expect(settings.providerCredentials.ollama.host).toBe("http://localhost:11434");
      expect(settings.langfuseEnabled).toBe(true);
      expect(settings.webAccessEnabled).toBe(true);

      // Verify stored file was rewritten to v1
      const raw = await readFile(join(tmpDir, "settings.json"), "utf-8");
      const stored = JSON.parse(raw);
      expect(stored.version).toBe(1);
      expect(stored.encryptedApiKey).toBeUndefined();
      expect(stored.model).toBeUndefined();
      expect(stored.webAccessEnabled).toBe(true);
    });
  });
});
