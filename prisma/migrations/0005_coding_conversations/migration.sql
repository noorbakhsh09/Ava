CREATE TABLE "Conversation" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "workspacePath" TEXT NOT NULL,
  "codexThreadId" TEXT,
  "createdByTelegramUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TelegramConversationSelection" (
  "telegramChatId" TEXT NOT NULL,
  "telegramUserId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TelegramConversationSelection_pkey" PRIMARY KEY ("telegramChatId")
);

ALTER TABLE "AgentJob" ADD COLUMN "conversationId" TEXT;

CREATE UNIQUE INDEX "Conversation_codexThreadId_key" ON "Conversation"("codexThreadId");
CREATE INDEX "Conversation_lastUsedAt_idx" ON "Conversation"("lastUsedAt");
CREATE INDEX "TelegramConversationSelection_conversationId_idx" ON "TelegramConversationSelection"("conversationId");
CREATE INDEX "AgentJob_conversationId_createdAt_idx" ON "AgentJob"("conversationId", "createdAt");

ALTER TABLE "TelegramConversationSelection"
  ADD CONSTRAINT "TelegramConversationSelection_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentJob"
  ADD CONSTRAINT "AgentJob_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
