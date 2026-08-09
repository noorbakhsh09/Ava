import { describe, expect, test } from "bun:test";
import {
  isTelegramMessageAddressed,
  telegramEntitiesMentionBot,
  telegramMessageContent,
} from "../src/main/services/telegram";
import {
  TelegramResponsePolicyService,
  telegramScopeKey,
} from "../src/main/services/telegram-response-policy";

describe("Telegram group and channel routing", () => {
  test("answers private messages", () => {
    expect(isTelegramMessageAddressed({
      chatType: "private",
      text: "hello",
      botUsername: "ava_bot",
      repliesToBot: false,
    })).toBe(true);
  });

  test("answers mentions and replies in groups", () => {
    expect(isTelegramMessageAddressed({
      chatType: "supergroup",
      text: "Could you help, @Ava_Bot?",
      botUsername: "ava_bot",
      repliesToBot: false,
    })).toBe(true);
    expect(isTelegramMessageAddressed({
      chatType: "group",
      text: "What about this?",
      botUsername: "ava_bot",
      repliesToBot: true,
    })).toBe(true);
  });

  test("recognizes Telegram mention and text-mention entities", () => {
    expect(telegramEntitiesMentionBot(
      "Hi @ava_bot",
      [{ type: "mention", offset: 3, length: 8 }],
      "ava_bot",
      900,
    )).toBe(true);
    expect(telegramEntitiesMentionBot(
      "Hi Ava",
      [{ type: "text_mention", offset: 3, length: 3, user: { id: 900 } }],
      "ava_bot",
      900,
    )).toBe(true);
    expect(isTelegramMessageAddressed({
      chatType: "supergroup",
      text: "Hi Ava",
      botUsername: "ava_bot",
      repliesToBot: false,
      mentionsBot: true,
    })).toBe(true);
  });

  test("extracts mentions from text and media captions", () => {
    expect(telegramMessageContent({
      text: "@ava_bot help",
      entities: [{ type: "mention", offset: 0, length: 8 }],
    })).toEqual({
      text: "@ava_bot help",
      entities: [{ type: "mention", offset: 0, length: 8 }],
    });
    expect(telegramMessageContent({
      caption: "@ava_bot describe this",
      caption_entities: [{ type: "mention", offset: 0, length: 8 }],
    })).toEqual({
      text: "@ava_bot describe this",
      entities: [{ type: "mention", offset: 0, length: 8 }],
    });
  });

  test("address matcher distinguishes ordinary messages and commands for another bot", () => {
    expect(isTelegramMessageAddressed({
      chatType: "supergroup",
      text: "This is ordinary group discussion",
      botUsername: "ava_bot",
      repliesToBot: false,
    })).toBe(false);
    expect(isTelegramMessageAddressed({
      chatType: "supergroup",
      text: "/status@another_bot",
      botUsername: "ava_bot",
      repliesToBot: false,
    })).toBe(false);
  });

  test("treats each forum topic as a separate policy scope", async () => {
    const memories = new Map<string, { key: string; value: string }>();
    const db = {
      memory: {
        findUnique: async ({ where }: { where: { key: string } }) =>
          memories.get(where.key) ?? null,
        upsert: async ({ where, create, update }: {
          where: { key: string };
          create: { key: string; value: string };
          update: { value: string };
        }) => {
          const memory = memories.has(where.key)
            ? { ...memories.get(where.key)!, ...update }
            : create;
          memories.set(where.key, memory);
          return memory;
        },
        deleteMany: async ({ where }: { where: { key: string } }) => ({
          count: memories.delete(where.key) ? 1 : 0,
        }),
      },
    };
    const service = new TelegramResponsePolicyService(db as never);

    await service.restrictToOwner({
      telegramChatId: "-100123",
      telegramMessageThreadId: "17",
      ownerTelegramUserId: "42",
    });

    const storedValue = [...memories.values()][0]?.value ?? "";
    expect(storedValue).toContain('"telegramChatId":"-100123"');
    expect(storedValue).toContain('"telegramMessageThreadId":"17"');
    expect(storedValue).toContain('"ownerTelegramUserId":"42"');

    expect(await service.allows("-100123", "17", "42", false)).toBe(true);
    expect(await service.allows("-100123", "17", "77", true)).toBe(false);
    expect(await service.allows("-100123", "18", "77", false)).toBe(true);
    expect(telegramScopeKey("-100123", "17")).toBe("-100123:topic:17");

    await service.allowEveryone("-100123", "17");
    expect(await service.allows("-100123", "17", "77", false)).toBe(true);
  });

  test("uses memory to switch from all messages to mentions only", async () => {
    const memories = new Map<string, { key: string; value: string }>();
    const db = {
      memory: {
        findUnique: async ({ where }: { where: { key: string } }) =>
          memories.get(where.key) ?? null,
        upsert: async ({ where, create, update }: {
          where: { key: string };
          create: { key: string; value: string };
          update: { value: string };
        }) => {
          const memory = memories.has(where.key)
            ? { ...memories.get(where.key)!, ...update }
            : create;
          memories.set(where.key, memory);
          return memory;
        },
        deleteMany: async ({ where }: { where: { key: string } }) => ({
          count: memories.delete(where.key) ? 1 : 0,
        }),
      },
    };
    const service = new TelegramResponsePolicyService(db as never);

    expect(await service.allows("-100123", "17", "77", false)).toBe(true);
    await service.restrictToMentions({
      telegramChatId: "-100123",
      telegramMessageThreadId: "17",
      ownerTelegramUserId: "42",
    });
    expect(await service.allows("-100123", "17", "77", false)).toBe(false);
    expect(await service.allows("-100123", "17", "77", true)).toBe(true);
  });
});
