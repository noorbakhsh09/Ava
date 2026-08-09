import { describe, expect, test } from "bun:test";
import { ConversationService } from "../src/main/services/conversations";

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

describe("persistent coding conversations", () => {
  test("creates and selects a conversation for a Telegram chat", async () => {
    let selectedId: string | undefined;
    const conversation = {
      id: "conversation_123",
      title: "Project Alpha",
      workspacePath: "/tmp/project",
      codexThreadId: null,
      createdByTelegramUserId: "42",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastUsedAt: new Date(),
    };
    const db = {
      conversation: {
        create: async () => conversation,
        findUnique: async () => conversation,
        findMany: async () => [conversation],
      },
      telegramConversationSelection: {
        upsert: async ({ create }: { create: { conversationId: string } }) => {
          selectedId = create.conversationId;
        },
        findUnique: async () => selectedId ? { conversationId: selectedId } : null,
      },
    };
    const service = new ConversationService(db as never, config);

    const created = await service.createAndSelect({
      telegramChatId: "42",
      telegramUserId: "42",
      title: "Project Alpha",
    });
    const listing = await service.list("42");

    expect(created.id).toBe("conversation_123");
    expect(listing.selectedId).toBe("conversation_123");
    expect(listing.conversations).toHaveLength(1);
  });

  test("keeps forum-topic selections independent", async () => {
    const selections = new Map<string, string>();
    const conversations = new Map([
      ["conversation_17", {
        id: "conversation_17",
        title: "Topic 17",
        workspacePath: "/tmp/project",
      }],
      ["conversation_18", {
        id: "conversation_18",
        title: "Topic 18",
        workspacePath: "/tmp/project",
      }],
    ]);
    const db = {
      conversation: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          conversations.get(where.id) ?? null,
        findMany: async () => [...conversations.values()],
      },
      telegramConversationSelection: {
        upsert: async ({ where, create }: {
          where: { scopeKey: string };
          create: { conversationId: string };
        }) => {
          selections.set(where.scopeKey, create.conversationId);
        },
        findUnique: async ({ where }: { where: { scopeKey: string } }) => {
          const conversationId = selections.get(where.scopeKey);
          return conversationId ? { conversationId } : null;
        },
      },
    };
    const service = new ConversationService(db as never, config);

    await service.select("-100123", "42", "conversation_17", "17");
    await service.select("-100123", "42", "conversation_18", "18");

    expect((await service.list("-100123", "17")).selectedId).toBe("conversation_17");
    expect((await service.list("-100123", "18")).selectedId).toBe("conversation_18");
  });
});
