CREATE TYPE "ResultDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'DECLINED');

ALTER TABLE "AgentJob"
  ADD COLUMN "approvalRequestId" TEXT,
  ADD COLUMN "resultDeliveryStatus" "ResultDeliveryStatus";

CREATE UNIQUE INDEX "AgentJob_approvalRequestId_key" ON "AgentJob"("approvalRequestId");

ALTER TABLE "AgentJob"
  ADD CONSTRAINT "AgentJob_approvalRequestId_fkey"
  FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
