import "reflect-metadata";
import { mkdtemp, rm } from "node:fs/promises";
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
      expect(settings).toEqual({
        openrouterApiKey: null,
        model: "anthropic/claude-sonnet-4-6",
      });
    });
  });

  describe("saveSettings + getSettings round-trip", () => {
    it("saves and retrieves API key via safeStorage", async () => {
      await service.saveSettings({
        openrouterApiKey: "sk-or-test",
        model: "anthropic/claude-sonnet-4-6",
      });
      const settings = await service.getSettings();
      expect(settings.openrouterApiKey).toBe("sk-or-test");
      expect(settings.model).toBe("anthropic/claude-sonnet-4-6");
    });

    it("saves and retrieves model without touching API key", async () => {
      await service.saveSettings({ openrouterApiKey: "sk-or-test", model: "openai/gpt-4o" });
      await service.saveSettings({ model: "anthropic/claude-haiku-4-5" });
      const settings = await service.getSettings();
      expect(settings.openrouterApiKey).toBe("sk-or-test");
      expect(settings.model).toBe("anthropic/claude-haiku-4-5");
    });

    it("allows clearing API key by passing null", async () => {
      await service.saveSettings({ openrouterApiKey: "sk-or-test" });
      await service.saveSettings({ openrouterApiKey: null });
      const settings = await service.getSettings();
      expect(settings.openrouterApiKey).toBeNull();
    });

    it("encrypts API key via safeStorage.encryptString", async () => {
      const { safeStorage } = await import("electron");
      await service.saveSettings({ openrouterApiKey: "sk-or-test" });
      expect(safeStorage.encryptString).toHaveBeenCalledWith("sk-or-test");
    });
  });

  describe("safeStorage unavailable fallback", () => {
    it("stores and retrieves API key as plain base64 when encryption is unavailable", async () => {
      const { safeStorage } = await import("electron");
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);

      await service.saveSettings({ openrouterApiKey: "sk-plain-key" });
      const settings = await service.getSettings();

      expect(settings.openrouterApiKey).toBe("sk-plain-key");

      // Restore default
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
    });

    it("emits console.warn when saving without encryption", async () => {
      const { safeStorage } = await import("electron");
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      await service.saveSettings({ openrouterApiKey: "sk-plain-key" });

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("safeStorage unavailable"));

      warnSpy.mockRestore();
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);
    });
  });
});
