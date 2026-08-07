CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "JobSource" AS ENUM ('DESKTOP', 'TELEGRAM');

CREATE TABLE "AgentJob" (
  "id" TEXT NOT NULL,
  "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
  "source" "JobSource" NOT NULL,
  "prompt" TEXT NOT NULL,
  "workspacePath" TEXT NOT NULL,
  "telegramChatId" TEXT,
  "codexThreadId" TEXT,
  "result" TEXT,
  "error" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentEvent" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentJob_status_createdAt_idx" ON "AgentJob"("status", "createdAt");
CREATE INDEX "AgentEvent_jobId_createdAt_idx" ON "AgentEvent"("jobId", "createdAt");

ALTER TABLE "AgentEvent"
  ADD CONSTRAINT "AgentEvent_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "AgentJob"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
