CREATE TYPE "ApprovalAction" AS ENUM ('MEMORY_UPSERT', 'MEMORY_DELETE', 'CREATE_JOB');
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'PROCESSING', 'APPROVED', 'DENIED', 'FAILED');

CREATE TABLE "ApprovalRequest" (
  "id" TEXT NOT NULL,
  "action" "ApprovalAction" NOT NULL,
  "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "requesterTelegramUserId" TEXT NOT NULL,
  "requesterTelegramChatId" TEXT NOT NULL,
  "requesterDisplayName" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "reviewedByTelegramUserId" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApprovalRequest_status_createdAt_idx" ON "ApprovalRequest"("status", "createdAt");
CREATE INDEX "ApprovalRequest_requesterTelegramUserId_createdAt_idx" ON "ApprovalRequest"("requesterTelegramUserId", "createdAt");
