export {};

declare global {
  interface Window {
    ava: {
      bootstrap(): Promise<Bootstrap>;
      status(): Promise<RuntimeStatus>;
      recheck(): Promise<RuntimeStatus>;
      saveSettings(settings: Record<string, unknown>): Promise<Bootstrap>;
      migrateDatabase(): Promise<{ output: string; status: RuntimeStatus }>;
      chatHistory(limit?: number): Promise<ChatMessageRow[]>;
      sendChat(message: string): Promise<{ reply: string }>;
      activity(page: number, pageSize: number): Promise<ActivityPage>;
      memories(): Promise<MemoryRow[]>;
      deleteMemory(id: string): Promise<{ deleted: true }>;
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

  interface ChatMessageRow {
    id: string;
    telegramUserId: string;
    telegramChatId: string;
    telegramMessageThreadId: string | null;
    role: "USER" | "ASSISTANT";
    content: string;
    createdAt: string;
  }

  interface ActivityPage {
    rows: ChatMessageRow[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  }

  interface MemoryRow {
    id: string;
    key: string;
    value: string;
    createdAt: string;
    updatedAt: string;
  }
}
