import { PrismaClient, JobSource } from "../../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { AgentSettings, SettingsUpdate } from "../config";
import { toRuntimeConfig } from "../config";
import { CodexClient } from "../clients/codex";
import { runCommand } from "./command-runner";
import { AgentOrchestrator } from "./orchestrator";
import { SettingsStore } from "./settings-store";
import { TelegramService } from "./telegram";
import { join } from "node:path";
import { ChatService } from "./chat";
import { GitHubClient } from "../clients/github";
import { ApprovalService } from "./approvals";
import { ConversationService } from "./conversations";

export type ConnectionState = "disabled" | "checking" | "connected" | "error";

export interface ServiceStatus {
  state: ConnectionState;
  message: string;
  checkedAt?: string;
}

export interface RuntimeStatus {
  database: ServiceStatus;
  telegram: ServiceStatus;
  codex: ServiceStatus;
  github: ServiceStatus;
  agentReady: boolean;
}

const disabled = (message: string): ServiceStatus => ({ state: "disabled", message });

export class RuntimeManager {
  private restartQueue: Promise<void> = Promise.resolve();
  private settings!: AgentSettings;
  private db?: PrismaClient;
  private orchestrator?: AgentOrchestrator;
  private telegram?: TelegramService;
  private status: RuntimeStatus = {
    database: disabled("Add a PostgreSQL URL"),
    telegram: disabled("Add a bot token and trusted user IDs"),
    codex: disabled("Codex CLI has not been checked"),
    github: disabled("GitHub CLI has not been checked"),
    agentReady: false,
  };

  constructor(
    private readonly store: SettingsStore,
    private readonly projectRoot: string,
  ) {}

  async initialize() {
    this.settings = await this.store.load();
    void this.restart().catch((error) => console.error("Runtime initialization failed", error));
  }

  getStatus() {
    return this.status;
  }

  getPublicSettings() {
    return this.store.toPublic(this.settings);
  }

  async saveSettings(update: SettingsUpdate) {
    this.settings = await this.store.save(update);
    await this.restart();
    return { settings: this.getPublicSettings(), status: this.getStatus() };
  }

  restart() {
    this.restartQueue = this.restartQueue.then(() => this.restartServices());
    return this.restartQueue;
  }

  private async restartServices() {
    await this.stopServices();
    const config = toRuntimeConfig(this.settings);
    const checkedAt = () => new Date().toISOString();

    this.status = {
      database: config.postgresUrl
        ? { state: "checking", message: "Connecting…" }
        : disabled("Add a PostgreSQL URL"),
      telegram: config.telegramBotToken
        ? { state: "checking", message: "Connecting…" }
        : disabled("Add a bot token"),
      codex: { state: "checking", message: "Checking Codex CLI…" },
      github: { state: "checking", message: "Checking GitHub CLI…" },
      agentReady: false,
    };

    const codex = new CodexClient(config);
    try {
      const version = await runCommand(config.codexBin, ["--version"], { timeoutMs: 10_000 });
      await codex.probe(config.workspaces[0]);
      this.status.codex = {
        state: "connected",
        message: `${version.stdout.trim()} · ${config.codexModelProvider} gateway responded`,
        checkedAt: checkedAt(),
      };
    } catch (error) {
      this.status.codex = { state: "error", message: this.message(error), checkedAt: checkedAt() };
    }

    const github = new GitHubClient(config);
    try {
      this.status.github = {
        state: "connected",
        message: await github.probe(),
        checkedAt: checkedAt(),
      };
    } catch (error) {
      this.status.github = { state: "error", message: this.message(error), checkedAt: checkedAt() };
    }

    if (config.postgresUrl) {
      const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.postgresUrl }) });
      try {
        await db.$connect();
        const tables = await db.$queryRawUnsafe<Array<{
          agent_job: string | null;
          memory: string | null;
          chat_message: string | null;
          approval_request: string | null;
          conversation: string | null;
          conversation_selection: string | null;
          memory_owner_column: boolean;
          approval_job_column: boolean;
          result_delivery_column: boolean;
        }>>(
          `SELECT
            to_regclass('"AgentJob"')::text AS agent_job,
            to_regclass('"Memory"')::text AS memory,
            to_regclass('"ChatMessage"')::text AS chat_message,
            to_regclass('"ApprovalRequest"')::text AS approval_request,
            to_regclass('"Conversation"')::text AS conversation,
            to_regclass('"TelegramConversationSelection"')::text AS conversation_selection,
            EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'Memory'
                AND column_name = 'telegramUserId'
            ) AS memory_owner_column,
            EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'AgentJob'
                AND column_name = 'approvalRequestId'
            ) AS approval_job_column,
            EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'AgentJob'
                AND column_name = 'resultDeliveryStatus'
            ) AS result_delivery_column`,
        );
        if (
          !tables[0]?.agent_job ||
          !tables[0]?.memory ||
          !tables[0]?.chat_message ||
          !tables[0]?.approval_request ||
          !tables[0]?.conversation ||
          !tables[0]?.conversation_selection ||
          tables[0]?.memory_owner_column ||
          !tables[0]?.approval_job_column ||
          !tables[0]?.result_delivery_column
        ) {
          throw new Error("Connected, but migrations are pending. Click Apply migrations in Ava.");
        }
        this.db = db;
        this.status.database = { state: "connected", message: "PostgreSQL and schema ready", checkedAt: checkedAt() };
      } catch (error) {
        await db.$disconnect().catch(() => undefined);
        this.status.database = { state: "error", message: this.message(error), checkedAt: checkedAt() };
      }
    }

    if (this.db) {
      const conversations = new ConversationService(this.db, config);
      const orchestrator = new AgentOrchestrator(this.db, config, codex, conversations);
      this.orchestrator = orchestrator;
      const approvals = new ApprovalService(this.db, config, orchestrator, conversations);
      const chat = new ChatService(this.db, config, codex, orchestrator, approvals, conversations);
      const telegram = new TelegramService(
        config,
        this.db,
        orchestrator,
        chat,
        approvals,
        conversations,
      );
      this.telegram = telegram;
      if (telegram.enabled) {
        try {
          const bot = await telegram.start();
          this.status.telegram = {
            state: "connected",
            message: `@${bot?.username ?? "bot"} · ${config.telegramAllowedUserIds.size} trusted administrator(s)`,
            checkedAt: checkedAt(),
          };
        } catch (error) {
          this.status.telegram = { state: "error", message: this.message(error), checkedAt: checkedAt() };
        }
      }
    } else if (config.telegramBotToken) {
      this.status.telegram = { state: "error", message: "Waiting for a ready database", checkedAt: checkedAt() };
    }

    this.status.agentReady = Boolean(
      this.orchestrator &&
        this.status.database.state === "connected" &&
        this.status.telegram.state === "connected" &&
        this.status.codex.state === "connected",
    );
  }

  async stop() {
    await this.stopServices();
  }

  async listJobs() {
    if (!this.db) return [];
    return this.db.agentJob.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  }

  async enqueuePrompt(prompt: string, workspacePath?: string) {
    if (!this.orchestrator) throw new Error("Agent is not ready");
    return this.orchestrator.enqueueAdHoc({ prompt, workspacePath, source: JobSource.DESKTOP });
  }

  async migrateDatabase() {
    if (!this.settings.postgresUrl) throw new Error("Save a PostgreSQL URL first");
    const result = await runCommand(
      "bun",
      ["x", "prisma", "migrate", "deploy", "--schema", join(this.projectRoot, "prisma/schema.prisma")],
      {
        cwd: this.projectRoot,
        env: { ...process.env, DATABASE_URL: this.settings.postgresUrl },
        timeoutMs: 120_000,
        maxOutputBytes: 2 * 1024 * 1024,
      },
    );
    await this.restart();
    return { output: result.stdout, status: this.status };
  }

  private async stopServices() {
    await this.telegram?.stop().catch(() => undefined);
    await this.db?.$disconnect().catch(() => undefined);
    this.telegram = undefined;
    this.orchestrator = undefined;
    this.db = undefined;
  }

  private message(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
