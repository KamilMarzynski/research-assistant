import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { safeStorage } from "electron";
import { inject, injectable } from "tsyringe";
import { USER_DATA_PATH_TOKEN } from "../di/tokens";

export interface AppSettings {
  openrouterApiKey: string | null;
  model: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  openrouterApiKey: null,
  model: "anthropic/claude-sonnet-4-6",
};

interface StoredSettings {
  encryptedApiKey?: string;
  model?: string;
}

@injectable()
export class SettingsService {
  private readonly settingsPath: string;

  constructor(@inject(USER_DATA_PATH_TOKEN) userDataPath: string) {
    this.settingsPath = join(userDataPath, "settings.json");
  }

  async getSettings(): Promise<AppSettings> {
    try {
      const raw = await readFile(this.settingsPath, "utf-8");
      const stored = JSON.parse(raw) as StoredSettings;

      let openrouterApiKey: string | null = null;
      if (stored.encryptedApiKey) {
        const buf = Buffer.from(stored.encryptedApiKey, "base64");
        if (safeStorage.isEncryptionAvailable()) {
          openrouterApiKey = safeStorage.decryptString(buf);
        } else {
          openrouterApiKey = buf.toString("utf-8");
        }
      }

      return {
        openrouterApiKey,
        model: stored.model ?? DEFAULT_SETTINGS.model,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async saveSettings(patch: Partial<AppSettings>): Promise<void> {
    const current = await this.getSettings();
    const next: AppSettings = { ...current, ...patch };

    let encryptedApiKey: string | undefined;
    if (next.openrouterApiKey !== null) {
      if (safeStorage.isEncryptionAvailable()) {
        encryptedApiKey = safeStorage.encryptString(next.openrouterApiKey).toString("base64");
      } else {
        console.warn("[SettingsService] safeStorage unavailable — key stored without encryption");
        encryptedApiKey = Buffer.from(next.openrouterApiKey).toString("base64");
      }
    }

    const stored: StoredSettings = { model: next.model };
    if (encryptedApiKey !== undefined) stored.encryptedApiKey = encryptedApiKey;

    await mkdir(dirname(this.settingsPath), { recursive: true });
    await writeFile(this.settingsPath, JSON.stringify(stored), "utf-8");
  }
}
