import { describe, expect, test } from "bun:test";
import { JobSource, JobStatus } from "../src/generated/prisma/client";
import { AgentOrchestrator } from "../src/main/services/orchestrator";

const config = {
  postgresUrl: "",
  telegramBotToken: "",
  telegramAllowedUserIds: new Set<string>(),
  workspaces: ["/tmp/project"],
  codexBin: "codex",
  codexBaseUrl: "https://example.test",
  codexAuthToken: "",
  codexModelProvider: "custom_gateway",
  githubBin: "gh",
  githubToken: "github_secret",
  codexTimeoutMs: 1_000,
  localApiPort: 3421,
  localApiToken: "test",
};

describe("coding job execution", () => {
  test("runs Codex with GPT-5.6 Sol and high reasoning", async () => {
    const job = {
      id: "job_123",
      prompt: "Fix the login bug",
      source: JobSource.TELEGRAM,
      status: JobStatus.QUEUED,
      workspacePath: "/tmp/project",
      telegramChatId: "99",
      codexThreadId: null,
      result: null,
      error: null,
      createdAt: new Date(),
      startedAt: null,
      finishedAt: null,
      conversationId: "conversation_123",
    };
    const db = {
      agentJob: {
        create: async () => job,
        update: async ({ data }: { data: { status: JobStatus } }) => ({ ...job, ...data }),
      },
      agentEvent: { create: async () => undefined },
      conversation: {
        findUnique: async () => ({
          id: "conversation_123",
          title: "Login project",
          workspacePath: "/tmp/project",
          codexThreadId: "thread_existing",
        }),
      },
    };
    let runPrompt = "";
    let runOptions: unknown;
    const progressPhases: string[] = [];
    const codex = {
      run: async (
        prompt: string,
        _workspace: string,
        onEvent: (event: Record<string, unknown>) => Promise<void>,
        options: unknown,
      ) => {
        runPrompt = prompt;
        runOptions = options;
        await onEvent({
          type: "item.started",
          item: { type: "command_execution", command: "bun test" },
        });
        return { threadId: "thread_existing", finalMessage: "Done" };
      },
    };
    const conversations = {
      attachThread: async () => undefined,
      touch: async () => undefined,
    };
    const orchestrator = new AgentOrchestrator(
      db as never,
      config,
      codex as never,
      conversations as never,
    );
    orchestrator.onProgress((update) => {
      progressPhases.push(update.phase);
    });
    const finished = new Promise<void>((resolve) => orchestrator.onFinished(() => resolve()));

    await orchestrator.enqueueAdHoc({
      prompt: job.prompt,
      source: JobSource.TELEGRAM,
      telegramChatId: job.telegramChatId,
      conversationId: job.conversationId,
    });
    await finished;

    expect(runOptions).toEqual({
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      githubAccess: true,
      skipGitRepoCheck: true,
      additionalWritableDirectories: config.workspaces,
      resumeThreadId: "thread_existing",
    });
    expect(runPrompt).toContain("Git and GitHub CLI (gh) are available");
    expect(runPrompt).toContain("trusted parent folders");
    expect(runPrompt).toContain(job.prompt);
    expect(runPrompt).not.toContain(config.githubToken);
    expect(progressPhases).toEqual(["started", "event"]);
  });
});
