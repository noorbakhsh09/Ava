import {
  JobSource,
  JobStatus,
  Prisma,
  PrismaClient,
  ResultDeliveryStatus,
  type AgentJob,
} from "../../generated/prisma/client";
import type { RuntimeConfig } from "../config";
import { assertAllowedWorkspace } from "../config";
import { CodexClient, type CodexEvent } from "../clients/codex";
import { CommandError } from "./command-runner";
import type { ConversationService } from "./conversations";

type JobFinishedListener = (job: AgentJob) => void | Promise<void>;
export type JobProgressUpdate =
  | { phase: "started"; job: AgentJob }
  | { phase: "event"; job: AgentJob; event: CodexEvent };
type JobProgressListener = (update: JobProgressUpdate) => void | Promise<void>;

const GITHUB_JOB_POLICY = [
  "Ava coding-job GitHub policy:",
  "- Git and GitHub CLI (gh) are available for this allowlisted repository.",
  "- Use branches, commits, pushes, issues, releases, and pull requests only when the user requests them or they are necessary to complete the requested GitHub workflow.",
  "- Never print, persist, or expose authentication tokens.",
  "- Do not force-push, delete branches, merge/close pull requests, or modify repository settings unless the user explicitly requests that exact action.",
  "- Before creating a pull request, verify the diff and relevant tests, use a non-default branch, push it, and return the pull request URL.",
].join("\n");

function workspaceRootPolicy(workspaces: string[]) {
  return [
    "Ava workspace-root policy:",
    "- The configured paths below are trusted parent folders. You may inspect and modify their descendants.",
    "- Locate the repository requested by the user inside these roots; do not assume the starting directory is itself a Git repository.",
    "- Do not modify unrelated projects.",
    ...workspaces.map((workspace) => `- ${workspace}`),
  ].join("\n");
}

function jobErrorMessage(error: unknown) {
  if (error instanceof CommandError) {
    const detail = error.stderr.trim();
    if (detail) return `${error.message}\n\n${detail.slice(-4_000)}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export class AgentOrchestrator {
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<JobFinishedListener>();
  private readonly progressListeners = new Set<JobProgressListener>();

  constructor(
    private readonly db: PrismaClient,
    private readonly config: RuntimeConfig,
    private readonly codex: CodexClient,
    private readonly conversations: ConversationService,
  ) {}

  onFinished(listener: JobFinishedListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onProgress(listener: JobProgressListener) {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  async enqueueAdHoc(input: {
    prompt: string;
    source: JobSource;
    workspacePath?: string;
    telegramChatId?: string;
    conversationId?: string;
    approvalRequestId?: string;
  }) {
    const conversation = input.conversationId
      ? await this.db.conversation.findUnique({ where: { id: input.conversationId } })
      : undefined;
    if (input.conversationId && !conversation) throw new Error("Conversation was not found");
    const workspacePath = assertAllowedWorkspace(
      conversation?.workspacePath ?? input.workspacePath ?? this.config.workspaces[0],
      this.config.workspaces,
    );
    const job = await this.db.agentJob.create({
      data: {
        prompt: input.prompt,
        source: input.source,
        workspacePath,
        telegramChatId: input.telegramChatId,
        conversationId: conversation?.id,
        approvalRequestId: input.approvalRequestId,
        resultDeliveryStatus: input.approvalRequestId ? ResultDeliveryStatus.PENDING : undefined,
      },
    });
    this.schedule(job.id);
    return job;
  }

  private schedule(jobId: string) {
    this.queue = this.queue.then(() => this.execute(jobId)).catch((error) => {
      console.error("Unexpected queue failure", error);
    });
  }

  private async execute(jobId: string) {
    const job = await this.db.agentJob.update({
      where: { id: jobId },
      data: { status: JobStatus.RUNNING, startedAt: new Date() },
    });
    const conversation = job.conversationId
      ? await this.db.conversation.findUnique({ where: { id: job.conversationId } })
      : null;
    await this.notifyProgress({ phase: "started", job });

    try {
      const result = await this.codex.run(
        `${GITHUB_JOB_POLICY}\n\n${workspaceRootPolicy(this.config.workspaces)}\n\nUser coding request:\n${job.prompt}`,
        job.workspacePath,
        async (event) => {
          if (event.type === "thread.started" || event.type === "item.completed") {
            await this.db.agentEvent.create({
              data: {
                jobId,
                kind: event.type ?? "unknown",
                payload: event as Prisma.InputJsonValue,
              },
            });
          }
          if (
            conversation &&
            event.type === "thread.started" &&
            typeof event.thread_id === "string" &&
            event.thread_id !== conversation.codexThreadId
          ) {
            await this.conversations.attachThread(conversation.id, event.thread_id);
            conversation.codexThreadId = event.thread_id;
          }
          await this.notifyProgress({ phase: "event", job, event });
        },
        {
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          githubAccess: true,
          skipGitRepoCheck: true,
          additionalWritableDirectories: this.config.workspaces,
          resumeThreadId: conversation?.codexThreadId ?? undefined,
        },
      );

      if (conversation) {
        if (result.threadId && result.threadId !== conversation.codexThreadId) {
          await this.conversations.attachThread(conversation.id, result.threadId);
        } else {
          await this.conversations.touch(conversation.id);
        }
      }

      const completed = await this.db.agentJob.update({
        where: { id: jobId },
        data: {
          status: JobStatus.COMPLETED,
          codexThreadId: result.threadId ?? conversation?.codexThreadId,
          result: result.finalMessage,
          finishedAt: new Date(),
        },
      });

      await this.notify(completed);
    } catch (error) {
      const message = jobErrorMessage(error);
      const failed = await this.db.agentJob.update({
        where: { id: jobId },
        data: {
          status: JobStatus.FAILED,
          error: message,
          finishedAt: new Date(),
        },
      });
      await this.notify(failed);
    }
  }

  private async notify(job: AgentJob) {
    await Promise.allSettled([...this.listeners].map((listener) => listener(job)));
  }

  private async notifyProgress(update: JobProgressUpdate) {
    await Promise.allSettled(
      [...this.progressListeners].map((listener) => listener(update)),
    );
  }
}
