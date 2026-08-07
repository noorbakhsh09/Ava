import { describe, expect, test } from "bun:test";
import { ApprovalAction, ApprovalStatus } from "../src/generated/prisma/client";
import { ApprovalService } from "../src/main/services/approvals";

const config = {
  postgresUrl: "",
  telegramBotToken: "",
  telegramAllowedUserIds: new Set<string>(["42"]),
  workspaces: ["/tmp/project"],
  codexBin: "codex",
  codexBaseUrl: "https://example.test",
  codexAuthToken: "",
  codexModelProvider: "custom_gateway",
  githubBin: "gh",
  githubToken: "",
  codexTimeoutMs: 1_000,
  localApiPort: 3421,
  localApiToken: "test",
};

function harness() {
  let stored: Record<string, unknown> | undefined;
  const calls = { memories: [] as unknown[], jobs: [] as unknown[] };
  const approvalRequest = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      stored = {
        id: "approval_123",
        status: ApprovalStatus.PENDING,
        reviewedByTelegramUserId: null,
        error: null,
        createdAt: new Date(),
        reviewedAt: null,
        updatedAt: new Date(),
        ...data,
      };
      return stored;
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (!stored || stored.id !== where.id || stored.status !== where.status) return { count: 0 };
      stored = { ...stored, ...data };
      return { count: 1 };
    },
    findUnique: async () => stored ?? null,
    findUniqueOrThrow: async () => {
      if (!stored) throw new Error("not found");
      return stored;
    },
    update: async ({ data }: { data: Record<string, unknown> }) => {
      if (!stored) throw new Error("not found");
      stored = { ...stored, ...data };
      return stored;
    },
  };
  const db = {
    approvalRequest,
    memory: {
      upsert: async (input: unknown) => calls.memories.push(input),
      deleteMany: async (input: unknown) => calls.memories.push(input),
    },
  };
  const orchestrator = {
    enqueueAdHoc: async (input: unknown) => {
      calls.jobs.push(input);
      return { id: "job_123" };
    },
  };
  const conversations = {
    getOrCreateSelected: async () => ({ id: "conversation_123", title: "Pull request project" }),
  };
  const service = new ApprovalService(
    db as never,
    config,
    orchestrator as never,
    conversations as never,
  );
  return { calls, service, getStored: () => stored };
}

describe("chat-only user approvals", () => {
  test("persists the request and notifies the administrator without executing it", async () => {
    const { calls, service, getStored } = harness();
    let notified = false;
    service.onRequested(() => {
      notified = true;
    });

    const result = await service.request({
      requesterTelegramUserId: "77",
      requesterTelegramChatId: "100",
      requesterDisplayName: "Guest",
      action: ApprovalAction.MEMORY_UPSERT,
      payload: { key: "language", value: "Reply in Persian" },
    });

    expect(result.notified).toBe(true);
    expect(notified).toBe(true);
    expect(getStored()?.status).toBe(ApprovalStatus.PENDING);
    expect(calls.memories).toHaveLength(0);
    expect(calls.jobs).toHaveLength(0);
  });

  test("lets a trusted administrator approve a coding job exactly once", async () => {
    const { calls, service, getStored } = harness();
    await service.request({
      requesterTelegramUserId: "77",
      requesterTelegramChatId: "100",
      requesterDisplayName: "Guest",
      action: ApprovalAction.CREATE_JOB,
      payload: { prompt: "Open a pull request" },
    });

    const result = await service.approve("approval_123", "42");

    expect(calls.jobs).toHaveLength(1);
    expect(result.message).toContain("job_123");
    expect(result.message).toContain("buttons to share it with the requester");
    expect(JSON.stringify(calls.jobs[0])).toContain('"telegramChatId":"42"');
    expect(JSON.stringify(calls.jobs[0])).not.toContain('"telegramChatId":"100"');
    expect(JSON.stringify(calls.jobs[0])).toContain('"conversationId":"conversation_123"');
    expect(JSON.stringify(calls.jobs[0])).toContain('"approvalRequestId":"approval_123"');
    expect(getStored()?.status).toBe(ApprovalStatus.APPROVED);
    await expect(service.approve("approval_123", "42")).rejects.toThrow("already approved");
    expect(calls.jobs).toHaveLength(1);
  });

  test("rejects approval decisions from an untrusted reviewer", async () => {
    const { service, getStored } = harness();
    await service.request({
      requesterTelegramUserId: "77",
      requesterTelegramChatId: "100",
      requesterDisplayName: "Guest",
      action: ApprovalAction.MEMORY_DELETE,
      payload: { key: "language" },
    });

    await expect(service.approve("approval_123", "77")).rejects.toThrow("trusted Telegram administrator");
    expect(getStored()?.status).toBe(ApprovalStatus.PENDING);
  });

  test("denial leaves memory and jobs unchanged", async () => {
    const { calls, service, getStored } = harness();
    await service.request({
      requesterTelegramUserId: "77",
      requesterTelegramChatId: "100",
      requesterDisplayName: "Guest",
      action: ApprovalAction.MEMORY_UPSERT,
      payload: { key: "language", value: "Reply in Persian" },
    });

    const result = await service.deny("approval_123", "42");

    expect(result.message).toContain("denied");
    expect(getStored()?.status).toBe(ApprovalStatus.DENIED);
    expect(calls.memories).toHaveLength(0);
    expect(calls.jobs).toHaveLength(0);
  });

  test("an approved memory is stored globally without requester ownership", async () => {
    const { calls, service } = harness();
    await service.request({
      requesterTelegramUserId: "77",
      requesterTelegramChatId: "100",
      requesterDisplayName: "Guest",
      action: ApprovalAction.MEMORY_UPSERT,
      payload: { key: "language", value: "Reply in Persian" },
    });

    const result = await service.approve("approval_123", "42");

    expect(calls.memories).toHaveLength(1);
    expect(JSON.stringify(calls.memories[0])).not.toContain("telegramUserId");
    expect(result.message).toContain("for all users");
  });
});
