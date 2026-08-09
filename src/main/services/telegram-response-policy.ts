import type { PrismaClient } from "../../generated/prisma/client";

const RESPONSE_POLICY_MEMORY_PREFIX = "telegram_response_policy";

interface StoredResponsePolicy {
  mode: "owner_only" | "mentions_only";
  telegramChatId: string;
  telegramMessageThreadId: string | null;
  ownerTelegramUserId: string;
}

export function telegramScopeKey(telegramChatId: string, telegramMessageThreadId?: string) {
  return telegramMessageThreadId
    ? `${telegramChatId}:topic:${telegramMessageThreadId}`
    : telegramChatId;
}

function policyMemoryKey(telegramChatId: string, telegramMessageThreadId?: string) {
  return `${RESPONSE_POLICY_MEMORY_PREFIX}:${telegramScopeKey(
    telegramChatId,
    telegramMessageThreadId,
  )}`;
}

export class TelegramResponsePolicyService {
  constructor(private readonly db: PrismaClient) {}

  get(telegramChatId: string, telegramMessageThreadId?: string) {
    return this.db.memory.findUnique({
      where: { key: policyMemoryKey(telegramChatId, telegramMessageThreadId) },
    });
  }

  async allows(
    telegramChatId: string,
    telegramMessageThreadId: string | undefined,
    telegramUserId: string | undefined,
    addressed: boolean,
  ) {
    const memory = await this.get(telegramChatId, telegramMessageThreadId);
    if (!memory) return true;
    try {
      const policy = JSON.parse(memory.value) as StoredResponsePolicy;
      if (
        policy.telegramChatId !== telegramChatId ||
        policy.telegramMessageThreadId !== (telegramMessageThreadId ?? null)
      ) return true;
      if (policy.mode === "mentions_only") return addressed;
      if (policy.mode === "owner_only") return policy.ownerTelegramUserId === telegramUserId;
      return true;
    } catch {
      // A malformed operational memory must not unexpectedly silence a chat.
      return true;
    }
  }

  restrictToOwner(input: {
    telegramChatId: string;
    telegramMessageThreadId?: string;
    ownerTelegramUserId: string;
  }) {
    return this.save({ ...input, mode: "owner_only" });
  }

  restrictToMentions(input: {
    telegramChatId: string;
    telegramMessageThreadId?: string;
    ownerTelegramUserId: string;
  }) {
    return this.save({ ...input, mode: "mentions_only" });
  }

  private save(input: {
    telegramChatId: string;
    telegramMessageThreadId?: string;
    ownerTelegramUserId: string;
    mode: StoredResponsePolicy["mode"];
  }) {
    const key = policyMemoryKey(input.telegramChatId, input.telegramMessageThreadId);
    const value = JSON.stringify({
      mode: input.mode,
      telegramChatId: input.telegramChatId,
      telegramMessageThreadId: input.telegramMessageThreadId ?? null,
      ownerTelegramUserId: input.ownerTelegramUserId,
    } satisfies StoredResponsePolicy);
    return this.db.memory.upsert({
      where: { key },
      update: {
        value,
      },
      create: {
        key,
        value,
      },
    });
  }

  async allowEveryone(telegramChatId: string, telegramMessageThreadId?: string) {
    await this.db.memory.deleteMany({
      where: { key: policyMemoryKey(telegramChatId, telegramMessageThreadId) },
    });
  }
}
