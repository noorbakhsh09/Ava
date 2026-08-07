CREATE TYPE "ChatRole" AS ENUM ('USER', 'ASSISTANT');

CREATE TABLE "Memory" (
  "id" TEXT NOT NULL,
  "telegramUserId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatMessage" (
  "id" TEXT NOT NULL,
  "telegramUserId" TEXT NOT NULL,
  "telegramChatId" TEXT NOT NULL,
  "role" "ChatRole" NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Memory_telegramUserId_key_key" ON "Memory"("telegramUserId", "key");
CREATE INDEX "Memory_telegramUserId_updatedAt_idx" ON "Memory"("telegramUserId", "updatedAt");
CREATE INDEX "ChatMessage_telegramUserId_createdAt_idx" ON "ChatMessage"("telegramUserId", "createdAt");
CREATE INDEX "ChatMessage_telegramChatId_createdAt_idx" ON "ChatMessage"("telegramChatId", "createdAt");
