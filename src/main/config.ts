import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";

export const settingsSchema = z.object({
  postgresUrl: z.string().trim().default(""),
  telegramBotToken: z.string().trim().default(""),
  telegramAllowedUserIds: z.array(z.string().trim().regex(/^\d+$/)).default([]),
  codexBaseUrl: z.string().trim().url().default("https://codex-gateway.example.com/v1"),
  codexAuthToken: z.string().trim().default(""),
  codexProvider: z.string().trim().regex(/^[a-zA-Z0-9_-]+$/).default("custom_gateway"),
  githubToken: z.string().trim().default(""),
  workspaces: z.array(z.string().trim().min(1)).min(1).default([process.cwd()]),
});

export type AgentSettings = z.infer<typeof settingsSchema>;

export interface PublicSettings extends Omit<
  AgentSettings,
  "postgresUrl" | "telegramBotToken" | "codexAuthToken" | "githubToken"
> {
  postgresUrlHint: string;
  hasPostgresUrl: boolean;
  hasTelegramBotToken: boolean;
  hasCodexAuthToken: boolean;
  hasGithubToken: boolean;
}

export interface SettingsUpdate extends Partial<AgentSettings> {
  clearPostgresUrl?: boolean;
  clearTelegramBotToken?: boolean;
  clearCodexAuthToken?: boolean;
  clearGithubToken?: boolean;
}

export function postgresUrlHint(value: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "Configured";
  }
}

export interface RuntimeConfig {
  postgresUrl: string;
  telegramBotToken: string;
  telegramAllowedUserIds: Set<string>;
  workspaces: string[];
  codexBin: string;
  codexBaseUrl: string;
  codexAuthToken: string;
  codexModelProvider: string;
  githubBin: string;
  githubToken: string;
  codexTimeoutMs: number;
  localApiPort: number;
  localApiToken: string;
}

export function toRuntimeConfig(settings: AgentSettings): RuntimeConfig {
  return {
    postgresUrl: settings.postgresUrl,
    telegramBotToken: settings.telegramBotToken,
    telegramAllowedUserIds: new Set(settings.telegramAllowedUserIds),
    workspaces: settings.workspaces.map((path) => resolve(path)),
    codexBin: "codex",
    codexBaseUrl: settings.codexBaseUrl,
    codexAuthToken: settings.codexAuthToken,
    codexModelProvider: settings.codexProvider,
    githubBin: "gh",
    githubToken: settings.githubToken,
    codexTimeoutMs: 1_800_000,
    localApiPort: Number(process.env.LOCAL_API_PORT || 3421),
    localApiToken: randomBytes(32).toString("hex"),
  };
}

export function assertAllowedWorkspace(requested: string, allowed: string[]): string {
  const candidate = resolve(requested);
  if (!allowed.includes(candidate)) throw new Error(`Workspace is not allowlisted: ${candidate}`);
  return candidate;
}
