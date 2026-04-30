import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { safeStorage } from "electron";
import { inject, injectable } from "tsyringe";
import { USER_DATA_PATH_TOKEN } from "../di/tokens";

export interface ProviderCredentials {
  apiKey: string | null;
  defaultModel: string;
}

export interface AppSettings {
  activeProvider: "openrouter" | "openai" | "anthropic" | "ollama";
  defaultCloudProvider: "openrouter" | "openai" | "anthropic";
  providerCredentials: {
    openrouter: ProviderCredentials;
    openai: ProviderCredentials;
    anthropic: ProviderCredentials;
    ollama: { host: string; defaultModel: string };
  };
  langfuseEnabled: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  activeProvider: "openrouter",
  defaultCloudProvider: "openrouter",
  providerCredentials: {
    openrouter: { apiKey: null, defaultModel: "anthropic/claude-sonnet-4-6" },
    openai: { apiKey: null, defaultModel: "gpt-4o" },
    anthropic: { apiKey: null, defaultModel: "claude-3-5-sonnet-20241022" },
    ollama: { host: "http://localhost:11434", defaultModel: "llama3.2:3b" },
  },
  langfuseEnabled: false,
};

interface StoredProviderCredentials {
  apiKey?: string;
  defaultModel?: string;
}

interface StoredOllamaCredentials {
  host?: string;
  defaultModel?: string;
}

interface StoredSettings {
  version?: number;
  activeProvider?: string;
  defaultCloudProvider?: string;
  providerCredentials?: {
    openrouter?: StoredProviderCredentials;
    openai?: StoredProviderCredentials;
    anthropic?: StoredProviderCredentials;
    ollama?: StoredOllamaCredentials;
  };
  langfuseEnabled?: boolean;
  // Legacy fields (migrated then removed)
  encryptedApiKey?: string;
  model?: string;
}

function encryptApiKey(key: string | null): string | undefined {
  if (key === null) return undefined;
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(key).toString("base64");
  }
  console.warn("[SettingsService] safeStorage unavailable — key stored without encryption");
  return Buffer.from(key).toString("base64");
}

function decryptApiKey(encrypted: string | undefined): string | null {
  if (!encrypted) return null;
  const buf = Buffer.from(encrypted, "base64");
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(buf);
  }
  return buf.toString("utf-8");
}

@injectable()
export class SettingsService {
  private readonly settingsPath: string;

  constructor(@inject(USER_DATA_PATH_TOKEN) userDataPath: string) {
    this.settingsPath = join(userDataPath, "settings.json");
  }

  private async readStored(): Promise<StoredSettings> {
    try {
      const raw = await readFile(this.settingsPath, "utf-8");
      return JSON.parse(raw) as StoredSettings;
    } catch {
      return {};
    }
  }

  private async writeStored(stored: StoredSettings): Promise<void> {
    await mkdir(dirname(this.settingsPath), { recursive: true });
    await writeFile(this.settingsPath, JSON.stringify(stored, null, 2), "utf-8");
  }

  private migrateV0ToV1(stored: StoredSettings): StoredSettings {
    if (stored.version === 1) return stored;

    const migrated: StoredSettings = {
      version: 1,
      activeProvider: "openrouter",
      defaultCloudProvider: "openrouter",
      providerCredentials: {
        openrouter: {
          apiKey: stored.encryptedApiKey,
          defaultModel:
            stored.model ?? DEFAULT_SETTINGS.providerCredentials.openrouter.defaultModel,
        },
        openai: {
          apiKey: undefined,
          defaultModel: DEFAULT_SETTINGS.providerCredentials.openai.defaultModel,
        },
        anthropic: {
          apiKey: undefined,
          defaultModel: DEFAULT_SETTINGS.providerCredentials.anthropic.defaultModel,
        },
        ollama: {
          host: DEFAULT_SETTINGS.providerCredentials.ollama.host,
          defaultModel: DEFAULT_SETTINGS.providerCredentials.ollama.defaultModel,
        },
      },
      langfuseEnabled: stored.langfuseEnabled ?? false,
    };

    delete migrated.encryptedApiKey;
    delete migrated.model;

    return migrated;
  }

  async getSettings(): Promise<AppSettings> {
    const stored = await this.readStored();
    const migrated = this.migrateV0ToV1(stored);

    if (migrated.version !== stored.version) {
      await this.writeStored(migrated);
    }

    const creds = migrated.providerCredentials ?? {};

    return {
      activeProvider: (migrated.activeProvider ??
        DEFAULT_SETTINGS.activeProvider) as AppSettings["activeProvider"],
      defaultCloudProvider: (migrated.defaultCloudProvider ??
        DEFAULT_SETTINGS.defaultCloudProvider) as AppSettings["defaultCloudProvider"],
      providerCredentials: {
        openrouter: {
          apiKey: decryptApiKey(creds.openrouter?.apiKey),
          defaultModel:
            creds.openrouter?.defaultModel ??
            DEFAULT_SETTINGS.providerCredentials.openrouter.defaultModel,
        },
        openai: {
          apiKey: decryptApiKey(creds.openai?.apiKey),
          defaultModel:
            creds.openai?.defaultModel ?? DEFAULT_SETTINGS.providerCredentials.openai.defaultModel,
        },
        anthropic: {
          apiKey: decryptApiKey(creds.anthropic?.apiKey),
          defaultModel:
            creds.anthropic?.defaultModel ??
            DEFAULT_SETTINGS.providerCredentials.anthropic.defaultModel,
        },
        ollama: {
          host: creds.ollama?.host ?? DEFAULT_SETTINGS.providerCredentials.ollama.host,
          defaultModel:
            creds.ollama?.defaultModel ?? DEFAULT_SETTINGS.providerCredentials.ollama.defaultModel,
        },
      },
      langfuseEnabled: migrated.langfuseEnabled ?? false,
    };
  }

  async saveSettings(patch: Partial<AppSettings>): Promise<void> {
    const current = await this.getSettings();
    const next: AppSettings = { ...current, ...patch };

    if (patch.providerCredentials) {
      next.providerCredentials = {
        openrouter: {
          ...current.providerCredentials.openrouter,
          ...patch.providerCredentials.openrouter,
        },
        openai: { ...current.providerCredentials.openai, ...patch.providerCredentials.openai },
        anthropic: {
          ...current.providerCredentials.anthropic,
          ...patch.providerCredentials.anthropic,
        },
        ollama: { ...current.providerCredentials.ollama, ...patch.providerCredentials.ollama },
      };
    }

    const stored: StoredSettings = {
      version: 1,
      activeProvider: next.activeProvider,
      defaultCloudProvider: next.defaultCloudProvider,
      providerCredentials: {
        openrouter: {
          apiKey: encryptApiKey(next.providerCredentials.openrouter.apiKey),
          defaultModel: next.providerCredentials.openrouter.defaultModel,
        },
        openai: {
          apiKey: encryptApiKey(next.providerCredentials.openai.apiKey),
          defaultModel: next.providerCredentials.openai.defaultModel,
        },
        anthropic: {
          apiKey: encryptApiKey(next.providerCredentials.anthropic.apiKey),
          defaultModel: next.providerCredentials.anthropic.defaultModel,
        },
        ollama: {
          host: next.providerCredentials.ollama.host,
          defaultModel: next.providerCredentials.ollama.defaultModel,
        },
      },
      langfuseEnabled: next.langfuseEnabled,
    };

    await this.writeStored(stored);
  }
}
