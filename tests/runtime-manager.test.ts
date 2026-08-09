import { describe, expect, test } from "bun:test";
import { RuntimeManager } from "../src/main/services/runtime-manager";

function message(id: string, createdAt: Date) {
  return {
    id,
    telegramUserId: "user-1",
    telegramChatId: "chat-1",
    telegramMessageThreadId: null,
    role: "USER",
    content: `Message ${id}`,
    createdAt,
  };
}

describe("Electron activity and chat APIs", () => {
  test("paginates activity newest first with a default of 50 rows", async () => {
    const calls: unknown[] = [];
    const rows = [message("newest", new Date("2026-08-08T12:00:00.000Z"))];
    const manager = new RuntimeManager({} as never, "/tmp/project");
    (manager as any).db = {
      chatMessage: {
        count: async () => 125,
        findMany: async (input: unknown) => {
          calls.push(input);
          return rows;
        },
      },
    };

    const result = await manager.listActivity({ page: 2, pageSize: 999 });

    expect(result.pageSize).toBe(50);
    expect(result.page).toBe(2);
    expect(result.totalPages).toBe(3);
    expect(result.rows[0]?.createdAt).toBe("2026-08-08T12:00:00.000Z");
    expect(calls[0]).toEqual({ orderBy: { createdAt: "desc" }, skip: 50, take: 50 });
  });

  test("forces desktop chat requests to trusted administrator access", async () => {
    let received: Record<string, unknown> | undefined;
    const manager = new RuntimeManager({} as never, "/tmp/project");
    (manager as any).chat = {
      respond: async (input: Record<string, unknown>) => {
        received = input;
        return "Hello from Ava";
      },
    };

    const result = await manager.sendDesktopChat("Hello");

    expect(result.reply).toBe("Hello from Ava");
    expect(received?.trusted).toBe(true);
    expect(received?.telegramUserId).toBe("electron:admin");
    expect(received?.source).toBe("DESKTOP");
  });

  test("lists newest memories and deletes by record ID", async () => {
    let deletedId = "";
    const manager = new RuntimeManager({} as never, "/tmp/project");
    (manager as any).db = {
      memory: {
        findMany: async () => [{
          id: "memory-1",
          key: "language",
          value: "Persian",
          createdAt: new Date("2026-08-01T00:00:00.000Z"),
          updatedAt: new Date("2026-08-08T00:00:00.000Z"),
        }],
        deleteMany: async ({ where }: { where: { id: string } }) => {
          deletedId = where.id;
          return { count: 1 };
        },
      },
    };

    const memories = await manager.listMemories();
    await manager.deleteMemory("memory-1");

    expect(memories[0]?.updatedAt).toBe("2026-08-08T00:00:00.000Z");
    expect(deletedId).toBe("memory-1");
  });
});
