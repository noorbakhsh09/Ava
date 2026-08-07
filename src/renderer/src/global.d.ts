export {};

declare global {
  interface Window {
    ava: {
      bootstrap(): Promise<Bootstrap>;
      status(): Promise<RuntimeStatus>;
      recheck(): Promise<RuntimeStatus>;
      saveSettings(settings: Record<string, unknown>): Promise<Bootstrap>;
      migrateDatabase(): Promise<{ output: string; status: RuntimeStatus }>;
    };
  }

  interface ServiceStatus {
    state: "disabled" | "checking" | "connected" | "error";
    message: string;
    checkedAt?: string;
  }

  interface RuntimeStatus {
    database: ServiceStatus;
    telegram: ServiceStatus;
    codex: ServiceStatus;
    github: ServiceStatus;
    agentReady: boolean;
  }

  interface PublicSettings {
    postgresUrlHint: string;
    hasPostgresUrl: boolean;
    telegramAllowedUserIds: string[];
    codexBaseUrl: string;
    codexProvider: string;
    workspaces: string[];
    hasTelegramBotToken: boolean;
    hasCodexAuthToken: boolean;
    hasGithubToken: boolean;
  }

  interface Bootstrap {
    settings: PublicSettings;
    status: RuntimeStatus;
  }
}
