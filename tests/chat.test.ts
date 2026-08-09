import { describe, expect, test } from "bun:test";
import { ChatService } from "../src/main/services/chat";
import { JobSource } from "../src/generated/prisma/client";

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

function harness(decision: unknown) {
  const calls = {
    memories: [] as unknown[],
    jobs: [] as unknown[],
    messages: [] as unknown[],
    approvals: [] as unknown[],
    memoryReads: [] as unknown[],
    schemas: [] as unknown[],
    prompts: [] as string[],
    responsePolicies: [] as unknown[],
  };
  const db = {
    memory: {
      findMany: async (input: unknown) => {
        calls.memoryReads.push(input);
        return [];
      },
      upsert: async (input: unknown) => calls.memories.push(input),
      deleteMany: async (input: unknown) => calls.memories.push(input),
    },
    chatMessage: {
      findMany: async () => [],
      create: async (input: unknown) => calls.messages.push(input),
    },
  };
  const decisions = Array.isArray(decision) ? [...decision] : [decision];
  const codex = {
    runStructured: async (_prompt: string, _workspace: string, schema: unknown) => {
      calls.prompts.push(_prompt);
      calls.schemas.push(schema);
      return decisions.shift() ?? { reply: "", toolCalls: [] };
    },
  };
  const orchestrator = {
    enqueueAdHoc: async (input: unknown) => {
      calls.jobs.push(input);
      return { id: "job_123" };
    },
  };
  const approvals = {
    request: async (input: unknown) => {
      calls.approvals.push(input);
      return { request: { id: "approval_123" }, notified: true };
    },
  };
  const conversations = {
    getOrCreateSelected: async () => ({ id: "conversation_123", title: "Login project" }),
  };
  const responsePolicies = {
    restrictToOwner: async (input: unknown) => calls.responsePolicies.push({ restrict: input }),
    restrictToMentions: async (input: unknown) =>
      calls.responsePolicies.push({ mentions: input }),
    allowEveryone: async (chatId: string, threadId?: string) =>
      calls.responsePolicies.push({ everyone: { chatId, threadId } }),
  };
  const service = new ChatService(
    db as never,
    config,
    codex as never,
    orchestrator as never,
    approvals as never,
    conversations as never,
    responsePolicies as never,
  );
  return { calls, service };
}

describe("conversational tool routing", () => {
  test("applies a model memory upsert", async () => {
    const { calls, service } = harness({
      reply: "I'll remember that.",
      toolCalls: [{ name: "memory_upsert", key: "response language", value: "Always reply in Persian", prompt: "" }],
    });
    const reply = await service.respond({
      telegramUserId: "42",
      telegramChatId: "99",
      displayName: "Javad",
      message: "Always reply in Persian",
    });
    expect(calls.memories).toHaveLength(1);
    expect(JSON.stringify(calls.memories[0])).toContain("response_language");
    expect(JSON.stringify(calls.memories[0])).not.toContain("telegramUserId");
    expect(JSON.stringify(calls.memoryReads[0])).not.toContain("telegramUserId");
    expect(reply).toContain("all users");
  });

  test("queues a coding job from a model tool call", async () => {
    const { calls, service } = harness({
      reply: "I sent an approval request to the administrator.",
      toolCalls: [{ name: "create_job", key: "", value: "", prompt: "Fix the login bug and run tests" }],
    });
    const reply = await service.respond({
      telegramUserId: "42",
      telegramChatId: "99",
      displayName: "Javad",
      message: "Please fix the login bug",
    });
    expect(calls.jobs).toHaveLength(1);
    expect(JSON.stringify(calls.jobs[0])).toContain("Fix the login bug");
    expect(JSON.stringify(calls.jobs[0])).toContain("conversation_123");
    expect(calls.approvals).toHaveLength(0);
    expect(reply).toContain("job_123");
    expect(reply.toLowerCase()).not.toContain("approval");
    expect(reply.toLowerCase()).not.toContain("administrator");
  });

  test("allows an untrusted user to chat without creating an approval", async () => {
    const { calls, service } = harness({ reply: "Hello! How can I help?", toolCalls: [] });
    const reply = await service.respond({
      telegramUserId: "77",
      telegramChatId: "100",
      displayName: "Guest",
      message: "Hello Ava",
    });

    expect(reply).toBe("Hello! How can I help?");
    expect(calls.approvals).toHaveLength(0);
    expect(calls.memories).toHaveLength(0);
    expect(calls.jobs).toHaveLength(0);
  });

  test("requires administrator approval for an untrusted memory request", async () => {
    const { calls, service } = harness({
      reply: "I need approval for that.",
      toolCalls: [{ name: "request_approval", key: "language", value: "Reply in Persian", prompt: "" }],
    });
    const reply = await service.respond({
      telegramUserId: "77",
      telegramChatId: "100",
      displayName: "Guest",
      message: "Always reply in Persian",
    });

    expect(calls.approvals).toHaveLength(1);
    expect(calls.memories).toHaveLength(0);
    expect(reply).toContain("alerted the administrator");
    expect(reply).toContain("approval_123");
  });

  test("requires administrator approval for an untrusted coding job", async () => {
    const { calls, service } = harness({
      reply: "I need approval for that.",
      toolCalls: [{ name: "request_approval", key: "", value: "", prompt: "Open a pull request" }],
    });
    const reply = await service.respond({
      telegramUserId: "77",
      telegramChatId: "100",
      displayName: "Guest",
      message: "Open a pull request",
    });

    expect(calls.approvals).toHaveLength(1);
    expect(calls.jobs).toHaveLength(0);
    expect(JSON.stringify(calls.schemas[0])).toContain('"enum":["request_approval"]');
    expect(JSON.stringify(calls.schemas[0])).not.toContain('"create_job"');
    expect(reply).toContain("waiting for approval");
  });

  test("repairs an untrusted action claim that omitted its approval tool call", async () => {
    const { calls, service } = harness([
      { reply: "I sent your request to the administrator for approval.", toolCalls: [] },
      {
        reply: "",
        toolCalls: [{ name: "request_approval", key: "", value: "", prompt: "Fix the checkout bug" }],
      },
    ]);
    const reply = await service.respond({
      telegramUserId: "77",
      telegramChatId: "100",
      displayName: "Guest",
      message: "Fix the checkout bug",
    });

    expect(calls.approvals).toHaveLength(1);
    expect(calls.jobs).toHaveLength(0);
    expect(reply).toContain("approval_123");
    expect(reply).toContain("alerted the administrator");
  });

  test("never claims an approval was stored when repair produces no tool call", async () => {
    const { calls, service } = harness([
      { reply: "I sent this to the admin for approval.", toolCalls: [] },
      { reply: "Administrator approval is required.", toolCalls: [] },
    ]);
    const reply = await service.respond({
      telegramUserId: "77",
      telegramChatId: "100",
      displayName: "Guest",
      message: "Do the task",
    });

    expect(calls.approvals).toHaveLength(0);
    expect(reply).toContain("No request was stored");
  });

  test("updates an existing shared memory", async () => {
    const { calls, service } = harness({
      reply: "",
      toolCalls: [{
        name: "memory_update",
        key: "response_language",
        value: "Reply in English",
        prompt: "",
      }],
    });

    const reply = await service.respond({
      telegramUserId: "42",
      telegramChatId: "99",
      displayName: "Javad",
      message: "I changed my mind; reply in English from now on",
    });

    expect(calls.memories).toHaveLength(1);
    expect(JSON.stringify(calls.memories[0])).toContain("Reply in English");
    expect(reply).toContain("saved or updated");
  });

  test("stores an owner-only response policy for the current topic", async () => {
    const { calls, service } = harness({
      reply: "",
      toolCalls: [{ name: "response_policy_set", key: "", value: "owner_only", prompt: "" }],
    });

    const reply = await service.respond({
      telegramUserId: "42",
      telegramChatId: "-100123",
      telegramMessageThreadId: "17",
      chatType: "supergroup",
      displayName: "Javad",
      message: "Only answer me in this topic",
    });

    expect(JSON.stringify(calls.responsePolicies[0])).toContain('"telegramMessageThreadId":"17"');
    expect(reply).toContain("every message from you");
  });

  test("removes a topic response restriction when the admin changes their mind", async () => {
    const { calls, service } = harness({
      reply: "",
      toolCalls: [{ name: "response_policy_set", key: "", value: "everyone", prompt: "" }],
    });

    const reply = await service.respond({
      telegramUserId: "42",
      telegramChatId: "-100123",
      telegramMessageThreadId: "17",
      chatType: "supergroup",
      displayName: "Javad",
      message: "Answer everyone again",
    });

    expect(JSON.stringify(calls.responsePolicies[0])).toContain('"threadId":"17"');
    expect(reply).toContain("every message from everyone");
  });

  test("stores a mentions-only response memory for the current topic", async () => {
    const { calls, service } = harness({
      reply: "",
      toolCalls: [{ name: "response_policy_set", key: "", value: "mentions_only", prompt: "" }],
    });

    const reply = await service.respond({
      telegramUserId: "42",
      telegramChatId: "-100123",
      telegramMessageThreadId: "17",
      chatType: "supergroup",
      displayName: "Javad",
      message: "Only answer mentions from now on",
    });

    expect(JSON.stringify(calls.responsePolicies[0])).toContain('"telegramMessageThreadId":"17"');
    expect(reply).toContain("only to mentions");
  });

  test("includes the replied message in model context", async () => {
    const { calls, service } = harness({ reply: "Here is the answer.", toolCalls: [] });
    await service.respond({
      telegramUserId: "42",
      telegramChatId: "-100123",
      telegramMessageThreadId: "17",
      chatType: "supergroup",
      displayName: "Javad",
      message: "@ava answer this",
      repliedMessage: { author: "Sara", text: "What does this error mean?" },
    });

    expect(calls.prompts[0]).toContain("What does this error mean?");
    expect(calls.prompts[0]).toContain("Sara");
  });

  test("lets the AI localize confirmed system messages from memory", async () => {
    const { calls, service } = harness([
      {
        reply: "",
        toolCalls: [{ name: "memory_update", key: "language", value: "فارسی", prompt: "" }],
      },
      { reply: "حافظه با موفقیت به‌روزرسانی شد." },
    ]);

    const reply = await service.respond({
      telegramUserId: "42",
      telegramChatId: "99",
      displayName: "Javad",
      message: "از این به بعد فارسی صحبت کن",
    });

    expect(reply).toBe("حافظه با موفقیت به‌روزرسانی شد.");
    expect(calls.prompts[1]).toContain("confirmed Ava system event");
  });

  test("treats the Electron chat as trusted without Telegram approval", async () => {
    const { calls, service } = harness({
      reply: "",
      toolCalls: [{ name: "memory_upsert", key: "desktop_preference", value: "Concise", prompt: "" }],
    });

    await service.respond({
      telegramUserId: "electron:admin",
      telegramChatId: "electron:admin",
      displayName: "Desktop administrator",
      message: "Remember to be concise",
      chatType: "private",
      trusted: true,
    });

    expect(calls.memories).toHaveLength(1);
    expect(calls.approvals).toHaveLength(0);
    expect(JSON.stringify(calls.schemas[0])).toContain("memory_upsert");
  });

  test("queues Electron coding work without a Telegram delivery target", async () => {
    const { calls, service } = harness({
      reply: "",
      toolCalls: [{ name: "create_job", key: "", value: "", prompt: "Fix desktop chat" }],
    });

    await service.respond({
      telegramUserId: "electron:admin",
      telegramChatId: "electron:admin",
      displayName: "Desktop administrator",
      message: "Fix desktop chat",
      chatType: "private",
      trusted: true,
      source: JobSource.DESKTOP,
    });

    expect(JSON.stringify(calls.jobs[0])).toContain('"source":"DESKTOP"');
    expect(JSON.stringify(calls.jobs[0])).not.toContain("telegramChatId");
  });
});
