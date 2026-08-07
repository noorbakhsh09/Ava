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
});
