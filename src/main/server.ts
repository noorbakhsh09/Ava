import { Elysia, t } from "elysia";
import { node } from "@elysiajs/node";
import { cors } from "@elysiajs/cors";
import type { RuntimeManager } from "./services/runtime-manager";

export class LocalApiServer {
  private app?: Elysia;

  constructor(
    private readonly runtime: RuntimeManager,
    private readonly port: number,
    private readonly token: string,
  ) {}

  async start() {
    const runtime = this.runtime;
    const token = this.token;
    const app = new Elysia({ adapter: node() })
      .use(cors({ origin: true, allowedHeaders: ["content-type", "authorization"] }))
      .onBeforeHandle(({ headers, set }) => {
        if (headers.authorization !== `Bearer ${token}`) {
          set.status = 401;
          return { error: "Unauthorized" };
        }
      })
      .onError(({ error, set }) => {
        set.status = 400;
        return { error: error instanceof Error ? error.message : String(error) };
      })
      .get("/api/bootstrap", () => ({
        settings: runtime.getPublicSettings(),
        status: runtime.getStatus(),
      }))
      .get("/api/status", () => runtime.getStatus())
      .post("/api/status/recheck", async () => {
        await runtime.restart();
        return runtime.getStatus();
      })
      .post(
        "/api/settings",
        ({ body }) => runtime.saveSettings(body),
        {
          body: t.Object({
            postgresUrl: t.Optional(t.String()),
            clearPostgresUrl: t.Optional(t.Boolean()),
            telegramBotToken: t.Optional(t.String()),
            telegramAllowedUserIds: t.Optional(t.Array(t.String())),
            codexBaseUrl: t.Optional(t.String()),
            codexAuthToken: t.Optional(t.String()),
            codexProvider: t.Optional(t.String()),
            githubToken: t.Optional(t.String()),
            workspaces: t.Optional(t.Array(t.String())),
            clearTelegramBotToken: t.Optional(t.Boolean()),
            clearCodexAuthToken: t.Optional(t.Boolean()),
            clearGithubToken: t.Optional(t.Boolean()),
          }),
        },
      )
      .post("/api/database/migrate", () => runtime.migrateDatabase())
      .get("/api/jobs", () => runtime.listJobs())
      .post(
        "/api/jobs/prompt",
        ({ body }) => runtime.enqueuePrompt(body.prompt, body.workspacePath),
        { body: t.Object({ prompt: t.String({ minLength: 1 }), workspacePath: t.Optional(t.String()) }) },
      );

    await app.listen({ hostname: "127.0.0.1", port: this.port });
    this.app = app as unknown as Elysia;
  }

  async stop() {
    const app = this.app;
    this.app = undefined;
    if (!app) return;
    await app.stop().catch((error) => {
      if (!(error instanceof Error) || !error.message.includes("isn't running")) throw error;
    });
  }
}
