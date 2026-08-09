import { Bot, InlineKeyboard, type Context } from "grammy";
import {
  ApprovalAction,
  JobSource,
  JobStatus,
  ResultDeliveryStatus,
  type AgentJob,
  type ApprovalRequest,
} from "../../generated/prisma/client";
import type { RuntimeConfig } from "../config";
import type { AgentOrchestrator } from "./orchestrator";
import type { PrismaClient } from "../../generated/prisma/client";
import type { ChatService } from "./chat";
import { chunkMarkdown, markdownToTelegramHtml } from "./telegram-markdown";
import { describeApprovalRequest, type ApprovalService } from "./approvals";
import type { ConversationService } from "./conversations";
import type { JobProgressUpdate } from "./orchestrator";
import { buildProgressMessage, formatCodexProgress } from "./telegram-progress";
import type { TelegramResponsePolicyService } from "./telegram-response-policy";

export function isTelegramMessageAddressed(input: {
  chatType: "private" | "group" | "supergroup" | "channel";
  text: string;
  botUsername: string;
  repliesToBot: boolean;
  mentionsBot?: boolean;
}) {
  if (input.chatType === "private") return true;
  if (input.repliesToBot) return true;
  if (input.mentionsBot) return true;

  const command = input.text.trim().match(/^\/[^\s@]+(?:@([A-Za-z0-9_]+))?(?:\s|$)/);
  if (command) return !command[1] || command[1].toLowerCase() === input.botUsername.toLowerCase();

  const escapedUsername = input.botUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])@${escapedUsername}(?=$|[^A-Za-z0-9_])`, "i")
    .test(input.text);
}

export function telegramEntitiesMentionBot(
  text: string,
  entities: readonly {
    type: string;
    offset: number;
    length: number;
    user?: { id: number };
  }[] | undefined,
  botUsername: string,
  botId: number,
) {
  return entities?.some((entity) => {
    if (entity.type === "text_mention") return entity.user?.id === botId;
    if (entity.type !== "mention") return false;
    const username = text
      .slice(entity.offset, entity.offset + entity.length)
      .replace(/^@/, "");
    return username.toLowerCase() === botUsername.toLowerCase();
  }) ?? false;
}

export function telegramMessageContent(message: {
  text?: string;
  caption?: string;
  entities?: readonly {
    type: string;
    offset: number;
    length: number;
    user?: { id: number };
  }[];
  caption_entities?: readonly {
    type: string;
    offset: number;
    length: number;
    user?: { id: number };
  }[];
}) {
  if (typeof message.text === "string") {
    return { text: message.text, entities: message.entities };
  }
  if (typeof message.caption === "string") {
    return { text: message.caption, entities: message.caption_entities };
  }
  return undefined;
}

const ADMIN_COMMANDS = [
  { command: "start", description: "Show your Ava access level" },
  { command: "status", description: "Check Ava status" },
  { command: "conversation", description: "Select or create a coding conversation" },
  { command: "ask", description: "Send a coding task" },
  { command: "jobs", description: "Show recent coding jobs" },
] as const;

interface ProgressMessageState {
  chatId: string;
  messageId: number;
  lines: string[];
  timer?: ReturnType<typeof setTimeout>;
  editing: Promise<void>;
}

export class TelegramService {
  private bot?: Bot;
  private unsubscribeJobs?: () => void;
  private unsubscribeApprovals?: () => void;
  private unsubscribeProgress?: () => void;
  private readonly progressMessages = new Map<string, ProgressMessageState>();

  constructor(
    private readonly config: RuntimeConfig,
    private readonly db: PrismaClient,
    private readonly orchestrator: AgentOrchestrator,
    private readonly chat: ChatService,
    private readonly approvals: ApprovalService,
    private readonly conversations: ConversationService,
    private readonly responsePolicies: TelegramResponsePolicyService,
  ) {}

  get enabled() {
    return Boolean(this.config.telegramBotToken);
  }

  async start() {
    if (!this.config.telegramBotToken) return;
    if (this.config.telegramAllowedUserIds.size === 0) {
      throw new Error("TELEGRAM_ALLOWED_USER_IDS is required when the Telegram bot is enabled");
    }

    const bot = new Bot(this.config.telegramBotToken);
    this.bot = bot;
    const identity = await bot.api.getMe();
    await bot.api.deleteMyCommands({ scope: { type: "default" } });
    await bot.api.deleteMyCommands({ scope: { type: "all_private_chats" } });
    const commandRegistrations = await Promise.allSettled(
      [...this.config.telegramAllowedUserIds].map((userId) =>
        bot.api.setMyCommands(ADMIN_COMMANDS, {
          scope: { type: "chat", chat_id: userId },
        }),
      ),
    );
    for (const registration of commandRegistrations) {
      if (registration.status === "rejected") {
        console.warn("Could not register administrator Telegram commands", registration.reason);
      }
    }

    bot.use(async (ctx, next) => {
      if (ctx.chat?.type === "private" && ctx.from && !this.isTrusted(ctx.from.id)) {
        await bot.api.deleteMyCommands({
          scope: { type: "chat", chat_id: ctx.chat.id },
        }).catch(() => undefined);
      }
      await next();
    });

    bot.use(async (ctx, next) => {
      const message = ctx.msg;
      const content = message ? telegramMessageContent(message) : undefined;
      if (!message || !content || !ctx.chat || ctx.chat.type === "private") return next();
      const addressed = isTelegramMessageAddressed({
        chatType: ctx.chat.type,
        text: content.text,
        botUsername: identity.username,
        repliesToBot: message.reply_to_message?.from?.id === identity.id,
        mentionsBot: telegramEntitiesMentionBot(
          content.text,
          content.entities,
          identity.username,
          identity.id,
        ),
      });

      const telegramMessageThreadId = message.message_thread_id?.toString();
      const telegramUserId = ctx.from?.id.toString();
      if (!await this.responsePolicies.allows(
        ctx.chat.id.toString(),
        telegramMessageThreadId,
        telegramUserId,
        addressed,
      )) return;
      await next();
    });

    bot.command("start", async (ctx) => {
      const trusted = this.isTrusted(ctx.from?.id);
      return ctx.reply(await this.chat.renderSystemMessage(
        trusted
          ? "Ava is online. You are a trusted administrator. Chat normally, manage memories, or use /conversation to select a persistent coding project."
          : "Ava is online. You have chat-only access. You can talk to Ava normally; memory and coding/GitHub actions require administrator approval.",
      ));
    });
    bot.command("status", async (ctx) =>
      ctx.reply(await this.chat.renderSystemMessage(
        this.isTrusted(ctx.from?.id)
          ? "Ava is online. You are a trusted administrator."
          : "Ava is online. Your access is chat-only; actions require administrator approval.",
      )),
    );
    bot.command("conversation", async (ctx) => {
      if (!ctx.from) return ctx.reply("I could not identify your Telegram account.");
      if (!this.isTrusted(ctx.from.id)) {
        return ctx.reply("Coding conversations are available only to trusted administrators.");
      }
      const input = String(ctx.match ?? "").trim();
      if (input.toLowerCase() === "new" || input.toLowerCase().startsWith("new ")) {
        const title = input.slice(3).trim() || "Telegram project";
        const conversation = await this.conversations.createAndSelect({
          telegramChatId: ctx.chat.id.toString(),
          telegramUserId: ctx.from.id.toString(),
          title,
          telegramMessageThreadId: ctx.msg?.message_thread_id?.toString(),
        });
        return ctx.reply(await this.chat.renderSystemMessage(
          `Created and selected conversation: ${conversation.title}`,
        ));
      }
      if (input) {
        const conversation = await this.conversations.select(
          ctx.chat.id.toString(),
          ctx.from.id.toString(),
          input,
          ctx.msg?.message_thread_id?.toString(),
        );
        return ctx.reply(await this.chat.renderSystemMessage(
          `Selected conversation: ${conversation.title}`,
        ));
      }
      return this.sendConversationPicker(
        ctx.chat.id.toString(),
        ctx.msg?.message_thread_id?.toString(),
      );
    });
    bot.command("ask", async (ctx) => {
      const prompt = String(ctx.match ?? "").trim();
      if (!prompt) return ctx.reply("Usage: /ask describe the coding task");
      if (!ctx.from) return ctx.reply("I could not identify your Telegram account.");
      if (!this.isTrusted(ctx.from?.id)) {
        const result = await this.approvals.request({
          requesterTelegramUserId: ctx.from.id.toString(),
          requesterTelegramChatId: ctx.chat.id.toString(),
          requesterTelegramMessageThreadId: ctx.msg?.message_thread_id?.toString(),
          requesterDisplayName: this.displayName(ctx.from),
          action: ApprovalAction.CREATE_JOB,
          payload: { prompt },
        });
        return ctx.reply(await this.chat.renderSystemMessage(
          this.pendingApprovalMessage(result.request.id, result.notified),
        ));
      }
      const conversation = await this.conversations.getOrCreateSelected({
        telegramChatId: ctx.chat.id.toString(),
        telegramUserId: ctx.from.id.toString(),
        suggestedTitle: prompt,
        telegramMessageThreadId: ctx.msg?.message_thread_id?.toString(),
      });
      const job = await this.orchestrator.enqueueAdHoc({
        prompt,
        source: JobSource.TELEGRAM,
        telegramChatId: ctx.chat.id.toString(),
        telegramMessageThreadId: ctx.msg?.message_thread_id?.toString(),
        conversationId: conversation.id,
      });
      await ctx.reply(await this.chat.renderSystemMessage(
        `Queued job ${job.id} in ${conversation.title}.`,
      ));
    });
    bot.callbackQuery(/^ava:conversation:(.+)$/, async (ctx) => {
      if (!this.isTrusted(ctx.from.id)) {
        await ctx.answerCallbackQuery({ text: "Only a trusted administrator can select conversations.", show_alert: true });
        return;
      }
      try {
        const conversation = await this.conversations.select(
          ctx.chat?.id.toString() ?? ctx.from.id.toString(),
          ctx.from.id.toString(),
          ctx.match[1],
          ctx.msg?.message_thread_id?.toString(),
        );
        await ctx.answerCallbackQuery({ text: `Selected ${conversation.title}`.slice(0, 180) });
        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
        await ctx.reply(await this.chat.renderSystemMessage(
          `Selected conversation: ${conversation.title}`,
        ));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await ctx.answerCallbackQuery({ text: message.slice(0, 180), show_alert: true });
      }
    });
    bot.command("jobs", async (ctx) => {
      if (!this.isTrusted(ctx.from?.id)) {
        return ctx.reply("Job history is available only to trusted administrators. You can still chat normally.");
      }
      const jobs = await this.db.agentJob.findMany({ orderBy: { createdAt: "desc" }, take: 5 });
      const summary = jobs.map((job) => `${job.id}  ${job.status}`).join("\n");
      await ctx.reply(summary || "No jobs yet.");
    });
    bot.callbackQuery(/^ava:(approve|deny):(.+)$/, async (ctx) => {
      if (!this.isTrusted(ctx.from.id)) {
        await ctx.answerCallbackQuery({ text: "Only a trusted administrator can review this request.", show_alert: true });
        return;
      }

      const decision = ctx.match[1];
      const requestId = ctx.match[2];
      try {
        const result = decision === "approve"
          ? await this.approvals.approve(requestId, ctx.from.id.toString())
          : await this.approvals.deny(requestId, ctx.from.id.toString());
        await ctx.answerCallbackQuery({ text: decision === "approve" ? "Approved" : "Denied" });
        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
        const isApprovedJob =
          decision === "approve" && result.request.action === ApprovalAction.CREATE_JOB;
        await ctx.reply(await this.chat.renderSystemMessage(
          [
            `${decision === "approve" ? "✅ Approved" : "❌ Denied"} request ${requestId}.`,
            decision === "approve" ? result.message : "",
          ].filter(Boolean).join("\n\n"),
        ));
        const requesterMessage = await this.chat.renderSystemMessage(
          isApprovedJob
            ? "The administrator approved your coding task. The result will be sent to the administrator, who can choose whether to share it with you."
            : result.message,
        );
        await this.sendMarkdown(
          result.request.requesterTelegramChatId,
          requesterMessage,
          undefined,
          result.request.requesterTelegramMessageThreadId ?? undefined,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await ctx.answerCallbackQuery({ text: message.slice(0, 180), show_alert: true });
      }
    });
    bot.callbackQuery(/^ava:result:(send|skip):(.+)$/, async (ctx) => {
      if (!this.isTrusted(ctx.from.id)) {
        await ctx.answerCallbackQuery({
          text: "Only a trusted administrator can decide result delivery.",
          show_alert: true,
        });
        return;
      }

      const decision = ctx.match[1];
      const jobId = ctx.match[2];
      if (decision === "skip") {
        const declined = await this.db.agentJob.updateMany({
          where: { id: jobId, resultDeliveryStatus: ResultDeliveryStatus.PENDING },
          data: { resultDeliveryStatus: ResultDeliveryStatus.DECLINED },
        });
        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
        await ctx.answerCallbackQuery({
          text: declined.count === 1 ? "Result kept private" : "This result was already handled",
        });
        return;
      }

      const claimed = await this.db.agentJob.updateMany({
        where: { id: jobId, resultDeliveryStatus: ResultDeliveryStatus.PENDING },
        data: { resultDeliveryStatus: ResultDeliveryStatus.SENDING },
      });
      if (claimed.count !== 1) {
        await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
        await ctx.answerCallbackQuery({ text: "This result was already handled" });
        return;
      }

      const job = await this.db.agentJob.findUnique({
        where: { id: jobId },
        include: { approvalRequest: true },
      });
      const request = job?.approvalRequest;
      if (!job || !request || job.status !== JobStatus.COMPLETED) {
        await this.db.agentJob.updateMany({
          where: { id: jobId, resultDeliveryStatus: ResultDeliveryStatus.SENDING },
          data: { resultDeliveryStatus: ResultDeliveryStatus.PENDING },
        });
        await ctx.answerCallbackQuery({ text: "The completed result could not be found", show_alert: true });
        return;
      }

      try {
        await ctx.answerCallbackQuery({ text: "Sending result…" });
        await this.sendMarkdown(
          request.requesterTelegramChatId,
          `**Result for your approved task**\n\n${job.result ?? "The task completed without a result message."}`,
          undefined,
          request.requesterTelegramMessageThreadId ?? undefined,
        );
      } catch (error) {
        await this.db.agentJob.updateMany({
          where: { id: jobId, resultDeliveryStatus: ResultDeliveryStatus.SENDING },
          data: { resultDeliveryStatus: ResultDeliveryStatus.PENDING },
        });
        await ctx.reply(
          `Could not send the result to ${request.requesterDisplayName}. The delivery buttons are still available. ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }

      await this.db.agentJob.update({
        where: { id: jobId },
        data: { resultDeliveryStatus: ResultDeliveryStatus.SENT },
      });
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
      await ctx.reply(await this.chat.renderSystemMessage(
        `Result sent to ${request.requesterDisplayName}.`,
      ));
    });
    const handleText = async (ctx: Context) => {
      const message = ctx.msg;
      const content = message ? telegramMessageContent(message) : undefined;
      if (!message || !content || !ctx.chat) return;
      const text = content.text;
      if (text.startsWith("/")) {
        await ctx.reply("Unknown command. You can also just message me normally.");
        return;
      }

      await ctx.replyWithChatAction("typing").catch(() => undefined);
      const typingTimer = setInterval(() => {
        void ctx.replyWithChatAction("typing").catch(() => undefined);
      }, 4_000);

      try {
        const telegramUserId = ctx.from?.id.toString()
          ?? `sender_chat:${ctx.senderChat?.id ?? ctx.chat.id}`;
        const displayName = ctx.from
          ? this.displayName(ctx.from)
          : ctx.senderChat?.title ?? "Channel";
        const replied = message.reply_to_message;
        const repliedText = replied && "text" in replied
          ? replied.text
          : replied && "caption" in replied
            ? replied.caption
            : undefined;
        const repliedMessage = replied && repliedText
          ? {
            author: replied.from
              ? this.displayName(replied.from)
              : replied.sender_chat?.title ?? "Telegram user",
            text: repliedText,
          }
          : undefined;
        const telegramMessageThreadId = message.message_thread_id?.toString();
        const reply = await this.chat.respond({
          telegramUserId,
          telegramChatId: ctx.chat.id.toString(),
          displayName,
          message: text,
          chatType: ctx.chat.type,
          telegramMessageThreadId,
          repliedMessage,
        });
        await this.sendMarkdown(ctx.chat.id, reply, undefined, telegramMessageThreadId);
      } catch (error) {
        console.error("Telegram chat response failed", error);
        await ctx.reply(`I couldn't process that message: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        clearInterval(typingTimer);
      }
    };
    bot.on("message", handleText);
    bot.on("channel_post", handleText);
    bot.on("edited_message", handleText);
    bot.on("edited_channel_post", handleText);

    bot.catch(({ error }) => console.error("Telegram update failed", error));
    this.unsubscribeJobs = this.orchestrator.onFinished((job) => this.notifyFinished(job));
    this.unsubscribeProgress = this.orchestrator.onProgress((update) => this.notifyProgress(update));
    this.unsubscribeApprovals = this.approvals.onRequested((request) => this.notifyApprovalRequested(request));
    void bot
      .start({ onStart: () => console.info(`Telegram bot @${identity.username} started`) })
      .catch((error) => {
        if (bot.isRunning()) console.error("Telegram polling stopped unexpectedly", error);
      });
    return identity;
  }

  async stop() {
    this.unsubscribeJobs?.();
    this.unsubscribeProgress?.();
    this.unsubscribeApprovals?.();
    for (const state of this.progressMessages.values()) {
      if (state.timer) clearTimeout(state.timer);
    }
    this.progressMessages.clear();
    if (this.bot?.isRunning()) await this.bot.stop();
  }

  private async notifyFinished(job: AgentJob) {
    if (!this.bot || !job.telegramChatId) return;
    await this.removeProgress(job.id);
    const body = job.status === "COMPLETED" ? job.result : job.error;
    const deliveryKeyboard =
      job.status === JobStatus.COMPLETED &&
      job.approvalRequestId &&
      job.resultDeliveryStatus === ResultDeliveryStatus.PENDING
        ? new InlineKeyboard()
          .text("📤 Send to requester", `ava:result:send:${job.id}`)
          .text("🚫 Don't send", `ava:result:skip:${job.id}`)
        : undefined;
    await this.sendMarkdown(
      job.telegramChatId,
      `**Job ${job.id}: ${job.status}**\n\n${body ?? "No details."}`,
      deliveryKeyboard,
      job.telegramMessageThreadId ?? undefined,
    );
  }

  private async notifyProgress(update: JobProgressUpdate) {
    if (!this.bot || !update.job.telegramChatId) return;
    let state = this.progressMessages.get(update.job.id);
    if (!state) {
      const source = buildProgressMessage(update.job.id, ["🚀 Starting Codex…"]);
      const message = await this.bot.api.sendMessage(
        update.job.telegramChatId,
        markdownToTelegramHtml(source),
        {
          parse_mode: "HTML",
          ...(update.job.telegramMessageThreadId
            ? { message_thread_id: Number(update.job.telegramMessageThreadId) }
            : {}),
        },
      );
      state = {
        chatId: update.job.telegramChatId,
        messageId: message.message_id,
        lines: ["🚀 Starting Codex…"],
        editing: Promise.resolve(),
      };
      this.progressMessages.set(update.job.id, state);
    }
    if (update.phase !== "event") return;
    const line = formatCodexProgress(update.event);
    if (!line) return;
    state.lines.push(line);
    if (state.lines.length > 80) state.lines.splice(0, state.lines.length - 80);
    this.scheduleProgressEdit(update.job.id, state);
  }

  private scheduleProgressEdit(jobId: string, state: ProgressMessageState) {
    if (state.timer) return;
    state.timer = setTimeout(() => {
      state.timer = undefined;
      void this.editProgress(jobId);
    }, 1_200);
  }

  private async editProgress(jobId: string) {
    const state = this.progressMessages.get(jobId);
    if (!this.bot || !state) return;
    const html = markdownToTelegramHtml(buildProgressMessage(jobId, state.lines));
    state.editing = state.editing
      .then(async () => {
        await this.bot?.api.editMessageText(state.chatId, state.messageId, html, {
          parse_mode: "HTML",
        });
      })
      .catch(() => undefined);
    await state.editing;
  }

  private async removeProgress(jobId: string) {
    const state = this.progressMessages.get(jobId);
    if (!this.bot || !state) return;
    if (state.timer) clearTimeout(state.timer);
    state.timer = undefined;
    await this.editProgress(jobId);
    await this.bot.api.deleteMessage(state.chatId, state.messageId).catch(() => undefined);
    this.progressMessages.delete(jobId);
  }

  private async sendConversationPicker(
    telegramChatId: string,
    telegramMessageThreadId?: string,
  ) {
    if (!this.bot) return;
    const { selectedId, conversations } = await this.conversations.list(
      telegramChatId,
      telegramMessageThreadId,
    );
    if (conversations.length === 0) {
      await this.bot.api.sendMessage(
        telegramChatId,
        "No coding conversations yet. Create one with /conversation new Project name",
        telegramMessageThreadId ? { message_thread_id: Number(telegramMessageThreadId) } : undefined,
      );
      return;
    }
    const keyboard = new InlineKeyboard();
    for (const conversation of conversations) {
      const label = `${conversation.id === selectedId ? "✓ " : ""}${conversation.title}`.slice(0, 48);
      keyboard.text(label, `ava:conversation:${conversation.id}`).row();
    }
    await this.bot.api.sendMessage(
      telegramChatId,
      "Select the coding conversation for future tasks. Create another with /conversation new Project name",
      {
        reply_markup: keyboard,
        ...(telegramMessageThreadId
          ? { message_thread_id: Number(telegramMessageThreadId) }
          : {}),
      },
    );
  }

  private async notifyApprovalRequested(request: ApprovalRequest) {
    if (!this.bot) throw new Error("Telegram bot is not running");
    const keyboard = new InlineKeyboard()
      .text("✅ Approve", `ava:approve:${request.id}`)
      .text("❌ Deny", `ava:deny:${request.id}`);
    const detail = describeApprovalRequest(request).slice(0, 2_800);
    const message = await this.chat.renderSystemMessage([
      "🔐 **Approval required**",
      `From: **${request.requesterDisplayName}** (\`${request.requesterTelegramUserId}\`)`,
      `Request: \`${request.id}\``,
      "",
      detail,
    ].join("\n"));
    const notifications = await Promise.allSettled(
      [...this.config.telegramAllowedUserIds].map((userId) =>
        this.bot!.api.sendMessage(userId, markdownToTelegramHtml(message), {
          parse_mode: "HTML",
          reply_markup: keyboard,
        }),
      ),
    );
    if (!notifications.some((result) => result.status === "fulfilled")) {
      throw new Error("Could not notify a trusted administrator");
    }
  }

  private isTrusted(userId?: number) {
    return userId !== undefined && this.config.telegramAllowedUserIds.has(userId.toString());
  }

  private displayName(user: { first_name: string; last_name?: string; username?: string }) {
    return [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || "User";
  }

  private pendingApprovalMessage(requestId: string, notified: boolean) {
    return notified
      ? `This coding job needs administrator approval. I alerted the administrator and am waiting for approval. Request: ${requestId}`
      : `This coding job needs administrator approval. Request ${requestId} is pending, but I could not deliver the administrator notification.`;
  }

  private async sendMarkdown(
    chatId: string | number,
    markdown: string,
    finalReplyMarkup?: InlineKeyboard,
    telegramMessageThreadId?: string,
  ) {
    if (!this.bot) return;
    const chunks = chunkMarkdown(markdown);
    for (const [index, source] of chunks.entries()) {
      const replyMarkup = index === chunks.length - 1 ? finalReplyMarkup : undefined;
      try {
        await this.bot.api.sendMessage(chatId, markdownToTelegramHtml(source), {
          parse_mode: "HTML",
          ...(telegramMessageThreadId
            ? { message_thread_id: Number(telegramMessageThreadId) }
            : {}),
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        });
      } catch (error) {
        console.warn("Telegram HTML formatting failed; sending plain text", error);
        await this.bot.api.sendMessage(
          chatId,
          source,
          {
            ...(telegramMessageThreadId
              ? { message_thread_id: Number(telegramMessageThreadId) }
              : {}),
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
          },
        );
      }
    }
  }
}
