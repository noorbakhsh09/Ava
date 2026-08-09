ALTER TABLE "AgentJob"
  ADD COLUMN "telegramMessageThreadId" TEXT;

ALTER TABLE "ChatMessage"
  ADD COLUMN "telegramMessageThreadId" TEXT;

ALTER TABLE "ApprovalRequest"
  ADD COLUMN "requesterTelegramMessageThreadId" TEXT;

ALTER TABLE "TelegramConversationSelection"
  ADD COLUMN "scopeKey" TEXT,
  ADD COLUMN "telegramMessageThreadId" TEXT;

UPDATE "TelegramConversationSelection"
SET "scopeKey" = "telegramChatId";

ALTER TABLE "TelegramConversationSelection"
  DROP CONSTRAINT "TelegramConversationSelection_pkey",
  ALTER COLUMN "scopeKey" SET NOT NULL,
  ADD CONSTRAINT "TelegramConversationSelection_pkey" PRIMARY KEY ("scopeKey");

CREATE INDEX "AgentJob_telegramChatId_telegramMessageThreadId_idx"
  ON "AgentJob"("telegramChatId", "telegramMessageThreadId");
CREATE INDEX "ChatMessage_telegramChatId_telegramMessageThreadId_createdAt_idx"
  ON "ChatMessage"("telegramChatId", "telegramMessageThreadId", "createdAt");
CREATE INDEX "TelegramConversationSelection_telegramChatId_idx"
  ON "TelegramConversationSelection"("telegramChatId");
