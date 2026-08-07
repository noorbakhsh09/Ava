import {
  ApprovalAction,
  ApprovalStatus,
  JobSource,
  Prisma,
  type ApprovalRequest,
  type PrismaClient,
} from "../../generated/prisma/client";
import type { RuntimeConfig } from "../config";
import type { AgentOrchestrator } from "./orchestrator";
import { z } from "zod";
import type { ConversationService } from "./conversations";

const memoryUpsertPayload = z.object({
  key: z.string().trim().min(1).max(64),
  value: z.string().trim().min(1).max(8_000),
});
const memoryDeletePayload = z.object({ key: z.string().trim().min(1).max(64) });
const createJobPayload = z.object({ prompt: z.string().trim().min(1).max(20_000) });

export type ApprovalRequestInput = {
  requesterTelegramUserId: string;
  requesterTelegramChatId: string;
  requesterDisplayName: string;
} & (
  | { action: typeof ApprovalAction.MEMORY_UPSERT; payload: z.infer<typeof memoryUpsertPayload> }
  | { action: typeof ApprovalAction.MEMORY_DELETE; payload: z.infer<typeof memoryDeletePayload> }
  | { action: typeof ApprovalAction.CREATE_JOB; payload: z.infer<typeof createJobPayload> }
);

type ApprovalRequestedListener = (request: ApprovalRequest) => void | Promise<void>;

export interface ApprovalDecisionResult {
  request: ApprovalRequest;
  message: string;
}

export class ApprovalService {
  private readonly listeners = new Set<ApprovalRequestedListener>();

  constructor(
    private readonly db: PrismaClient,
    private readonly config: RuntimeConfig,
    private readonly orchestrator: AgentOrchestrator,
    private readonly conversations: ConversationService,
  ) {}

  onRequested(listener: ApprovalRequestedListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async request(input: ApprovalRequestInput) {
    if (this.config.telegramAllowedUserIds.has(input.requesterTelegramUserId)) {
      throw new Error("Trusted users do not require approval");
    }

    const payload = this.validatePayload(input.action, input.payload);
    const request = await this.db.approvalRequest.create({
      data: {
        action: input.action,
        requesterTelegramUserId: input.requesterTelegramUserId,
        requesterTelegramChatId: input.requesterTelegramChatId,
        requesterDisplayName: input.requesterDisplayName.trim().slice(0, 200) || "Telegram user",
        payload: payload as Prisma.InputJsonValue,
      },
    });
    const notifications = await Promise.allSettled(
      [...this.listeners].map((listener) => listener(request)),
    );
    return {
      request,
      notified: notifications.some((result) => result.status === "fulfilled"),
    };
  }

  async approve(requestId: string, reviewerTelegramUserId: string): Promise<ApprovalDecisionResult> {
    this.assertTrustedReviewer(reviewerTelegramUserId);
    const claimed = await this.db.approvalRequest.updateMany({
      where: { id: requestId, status: ApprovalStatus.PENDING },
      data: {
        status: ApprovalStatus.PROCESSING,
        reviewedByTelegramUserId: reviewerTelegramUserId,
        reviewedAt: new Date(),
      },
    });
    if (claimed.count !== 1) throw await this.unavailableRequestError(requestId);

    const request = await this.db.approvalRequest.findUniqueOrThrow({ where: { id: requestId } });
    try {
      const message = await this.execute(request, reviewerTelegramUserId);
      const approved = await this.db.approvalRequest.update({
        where: { id: requestId },
        data: { status: ApprovalStatus.APPROVED, error: null },
      });
      return { request: approved, message };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.db.approvalRequest.update({
        where: { id: requestId },
        data: { status: ApprovalStatus.FAILED, error: message },
      });
      throw error;
    }
  }

  async deny(requestId: string, reviewerTelegramUserId: string): Promise<ApprovalDecisionResult> {
    this.assertTrustedReviewer(reviewerTelegramUserId);
    const denied = await this.db.approvalRequest.updateMany({
      where: { id: requestId, status: ApprovalStatus.PENDING },
      data: {
        status: ApprovalStatus.DENIED,
        reviewedByTelegramUserId: reviewerTelegramUserId,
        reviewedAt: new Date(),
      },
    });
    if (denied.count !== 1) throw await this.unavailableRequestError(requestId);
    const request = await this.db.approvalRequest.findUniqueOrThrow({ where: { id: requestId } });
    return { request, message: "The administrator denied this action." };
  }

  private async execute(
    request: ApprovalRequest,
    reviewerTelegramUserId: string,
  ): Promise<string> {
    if (request.action === ApprovalAction.MEMORY_UPSERT) {
      const payload = memoryUpsertPayload.parse(request.payload);
      await this.db.memory.upsert({
        where: { key: payload.key },
        update: { value: payload.value },
        create: {
          key: payload.key,
          value: payload.value,
        },
      });
      return `Approved and saved shared memory **${payload.key}** for all users.`;
    }

    if (request.action === ApprovalAction.MEMORY_DELETE) {
      const payload = memoryDeletePayload.parse(request.payload);
      await this.db.memory.deleteMany({
        where: { key: payload.key },
      });
      return `Approved and removed shared memory **${payload.key}** for all users.`;
    }

    const payload = createJobPayload.parse(request.payload);
    const conversation = await this.conversations.getOrCreateSelected({
      telegramChatId: reviewerTelegramUserId,
      telegramUserId: reviewerTelegramUserId,
      suggestedTitle: payload.prompt,
    });
    const job = await this.orchestrator.enqueueAdHoc({
      prompt: payload.prompt,
      source: JobSource.TELEGRAM,
      telegramChatId: reviewerTelegramUserId,
      conversationId: conversation.id,
      approvalRequestId: request.id,
    });
    return `Approved and queued coding job \`${job.id}\` in **${conversation.title}**. Its result will be sent to you, with buttons to share it with the requester or keep it private.`;
  }

  private validatePayload(action: ApprovalAction, payload: unknown) {
    if (action === ApprovalAction.MEMORY_UPSERT) return memoryUpsertPayload.parse(payload);
    if (action === ApprovalAction.MEMORY_DELETE) return memoryDeletePayload.parse(payload);
    return createJobPayload.parse(payload);
  }

  private assertTrustedReviewer(reviewerTelegramUserId: string) {
    if (!this.config.telegramAllowedUserIds.has(reviewerTelegramUserId)) {
      throw new Error("Only a trusted Telegram administrator can review approval requests");
    }
  }

  private async unavailableRequestError(requestId: string) {
    const request = await this.db.approvalRequest.findUnique({ where: { id: requestId } });
    return new Error(
      request
        ? `Approval request is already ${request.status.toLowerCase()}`
        : "Approval request was not found",
    );
  }
}

export function describeApprovalRequest(request: ApprovalRequest) {
  if (request.action === ApprovalAction.MEMORY_UPSERT) {
    const payload = memoryUpsertPayload.parse(request.payload);
    return `Set shared memory for all users — **${payload.key}**: ${payload.value}`;
  }
  if (request.action === ApprovalAction.MEMORY_DELETE) {
    const payload = memoryDeletePayload.parse(request.payload);
    return `Delete shared memory for all users — **${payload.key}**`;
  }
  const payload = createJobPayload.parse(request.payload);
  return `Coding/GitHub job: ${payload.prompt}`;
}
