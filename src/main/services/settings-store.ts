import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { safeStorage } from "electron";
import {
  settingsSchema,
  type AgentSettings,
  type PublicSettings,
  type SettingsUpdate,
  postgresUrlHint,
} from "../config";

const SECRET_KEYS = ["postgresUrl", "telegramBotToken", "codexAuthToken", "githubToken"] as const;
type SecretKey = (typeof SECRET_KEYS)[number];

interface StoredSettings {
  version: number;
  values: Omit<AgentSettings, SecretKey>;
  secrets: Partial<Record<SecretKey, string>>;
}

export class SettingsStore {
  constructor(private readonly path: string) {}

  async load(): Promise<AgentSettings> {
    try {
      const stored = JSON.parse(await readFile(this.path, "utf8")) as StoredSettings;
      const secrets = Object.fromEntries(
        SECRET_KEYS.map((key) => [key, this.decrypt(stored.secrets?.[key])]),
      );
      const settings = settingsSchema.parse({ ...stored.values, ...secrets });
      if (stored.version !== 3) await this.persist(settings);
      return settings;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("Could not load settings; using defaults", error);
      }
      return settingsSchema.parse({});
    }
  }

  async save(update: SettingsUpdate): Promise<AgentSettings> {
    const current = await this.load();
    const nextInput: Record<string, unknown> = { ...current, ...update };

    for (const key of SECRET_KEYS) {
      const clearKey = `clear${key[0].toUpperCase()}${key.slice(1)}` as keyof SettingsUpdate;
      if (update[clearKey]) nextInput[key] = "";
      else if (update[key] === undefined || update[key] === "") nextInput[key] = current[key];
    }

    const next = settingsSchema.parse(nextInput);
    await this.persist(next);
    return next;
  }

  private async persist(settings: AgentSettings) {
    const values: StoredSettings["values"] = {
      telegramAllowedUserIds: settings.telegramAllowedUserIds,
      codexBaseUrl: settings.codexBaseUrl,
      codexProvider: settings.codexProvider,
      workspaces: settings.workspaces,
    };
    const secrets: Partial<Record<SecretKey, string>> = {};
    for (const key of SECRET_KEYS) {
      secrets[key] = this.encrypt(settings[key]);
    }

    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(
      this.path,
      JSON.stringify({ version: 3, values, secrets } satisfies StoredSettings, null, 2),
      { encoding: "utf8", mode: 0o600 },
    );
  }

  toPublic(settings: AgentSettings): PublicSettings {
    return {
      postgresUrlHint: postgresUrlHint(settings.postgresUrl),
      hasPostgresUrl: Boolean(settings.postgresUrl),
      telegramAllowedUserIds: settings.telegramAllowedUserIds,
      codexBaseUrl: settings.codexBaseUrl,
      codexProvider: settings.codexProvider,
      workspaces: settings.workspaces,
      hasTelegramBotToken: Boolean(settings.telegramBotToken),
      hasCodexAuthToken: Boolean(settings.codexAuthToken),
      hasGithubToken: Boolean(settings.githubToken),
    };
  }

  private encrypt(value: string): string {
    if (!value) return "";
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS-backed secret encryption is not available; secrets were not saved.");
    }
    return safeStorage.encryptString(value).toString("base64");
  }

  private decrypt(value?: string): string {
    if (!value) return "";
    if (!safeStorage.isEncryptionAvailable()) return "";
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  }
}
