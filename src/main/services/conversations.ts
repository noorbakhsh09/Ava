import type { Conversation, PrismaClient } from "../../generated/prisma/client";
import type { RuntimeConfig } from "../config";
import { assertAllowedWorkspace } from "../config";
import { telegramScopeKey } from "./telegram-response-policy";

export class ConversationService {
  constructor(
    private readonly db: PrismaClient,
    private readonly config: RuntimeConfig,
  ) {}

  async list(telegramChatId: string, telegramMessageThreadId?: string) {
    const scopeKey = telegramScopeKey(telegramChatId, telegramMessageThreadId);
    const [selection, conversations] = await Promise.all([
      this.db.telegramConversationSelection.findUnique({ where: { scopeKey } }),
      this.db.conversation.findMany({ orderBy: { lastUsedAt: "desc" }, take: 20 }),
    ]);
    return { selectedId: selection?.conversationId, conversations };
  }

  async createAndSelect(input: {
    telegramChatId: string;
    telegramUserId: string;
    title: string;
    telegramMessageThreadId?: string;
    workspacePath?: string;
  }) {
    const workspacePath = assertAllowedWorkspace(
      input.workspacePath ?? this.config.workspaces[0],
      this.config.workspaces,
    );
    const conversation = await this.db.conversation.create({
      data: {
        title: this.normalizeTitle(input.title),
        workspacePath,
        createdByTelegramUserId: input.telegramUserId,
      },
    });
    await this.select(
      input.telegramChatId,
      input.telegramUserId,
      conversation.id,
      input.telegramMessageThreadId,
    );
    return conversation;
  }

  async select(
    telegramChatId: string,
    telegramUserId: string,
    conversationId: string,
    telegramMessageThreadId?: string,
  ) {
    const conversation = await this.db.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) throw new Error("Conversation was not found");
    assertAllowedWorkspace(conversation.workspacePath, this.config.workspaces);
    await this.db.telegramConversationSelection.upsert({
      where: { scopeKey: telegramScopeKey(telegramChatId, telegramMessageThreadId) },
      update: { conversationId, telegramUserId },
      create: {
        scopeKey: telegramScopeKey(telegramChatId, telegramMessageThreadId),
        telegramChatId,
        telegramMessageThreadId,
        telegramUserId,
        conversationId,
      },
    });
    return conversation;
  }

  async getOrCreateSelected(input: {
    telegramChatId: string;
    telegramUserId: string;
    suggestedTitle: string;
    telegramMessageThreadId?: string;
  }): Promise<Conversation> {
    const selection = await this.db.telegramConversationSelection.findUnique({
      where: {
        scopeKey: telegramScopeKey(input.telegramChatId, input.telegramMessageThreadId),
      },
      include: { conversation: true },
    });
    if (selection?.conversation) {
      assertAllowedWorkspace(selection.conversation.workspacePath, this.config.workspaces);
      return selection.conversation;
    }
    return this.createAndSelect({
      ...input,
      title: input.suggestedTitle,
    });
  }

  async attachThread(conversationId: string, codexThreadId: string) {
    return this.db.conversation.update({
      where: { id: conversationId },
      data: { codexThreadId, lastUsedAt: new Date() },
    });
  }

  async touch(conversationId: string) {
    await this.db.conversation.update({
      where: { id: conversationId },
      data: { lastUsedAt: new Date() },
    });
  }

  private normalizeTitle(value: string) {
    return value.trim().replace(/\s+/g, " ").slice(0, 64) || "Telegram project";
  }
}
