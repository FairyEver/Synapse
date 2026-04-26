import {
  Client,
  Domain,
  EventDispatcher,
  LoggerLevel,
  WSClient,
} from "@larksuiteoapi/node-sdk"

import type {
  FeishuCardActionEvent,
  FeishuClientFactory,
  FeishuMessageEvent,
  FeishuReplyContext,
  FeishuRuntimeClient,
  FeishuRuntimeClientHandlers,
} from "./feishu-types"

type FeishuMsgType = "text" | "interactive" | "image" | "file"
type FeishuSdkLogger = {
  warn(message: string, meta?: Record<string, unknown> | unknown): void
  error(message: string, meta?: Record<string, unknown> | unknown): void
}

export const feishuSdkClientFactory: FeishuClientFactory = {
  create(input) {
    return new FeishuSdkRuntimeClient(input.appId, input.appSecret, input.logger)
  },
}

class FeishuSdkRuntimeClient implements FeishuRuntimeClient {
  private readonly client: Client
  private readonly appId: string
  private readonly appSecret: string
  private readonly logger?: FeishuSdkLogger
  private wsClient: WSClient | undefined

  constructor(
    appId: string,
    appSecret: string,
    logger: FeishuSdkLogger | undefined,
  ) {
    this.appId = appId
    this.appSecret = appSecret
    this.logger = logger
    this.client = new Client({
      appId,
      appSecret,
      domain: Domain.Feishu,
      loggerLevel: LoggerLevel.warn,
      source: "synapse",
    })
  }

  async start(handlers: FeishuRuntimeClientHandlers): Promise<void> {
    const dispatcher = new EventDispatcher({
      loggerLevel: LoggerLevel.warn,
    })
    dispatcher.register({
      "im.message.receive_v1": (event: FeishuMessageEvent) => handlers.onMessage(event),
      "card.action.trigger": (event: FeishuCardActionEvent) => handlers.onCardAction(event),
    })
    this.wsClient = new WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
      domain: Domain.Feishu,
      loggerLevel: LoggerLevel.warn,
      onError: (error) => {
        const normalized = error instanceof Error ? error : new Error(String(error))
        this.logger?.error("Feishu WebSocket error.", normalized)
        handlers.onError?.(normalized)
      },
      onReconnecting: () => {
        handlers.onReconnecting?.()
      },
      onReconnected: () => {
        handlers.onReconnected?.()
      },
    })
    await this.wsClient.start({ eventDispatcher: dispatcher })
  }

  async stop(): Promise<void> {
    if (!this.wsClient) return
    await this.wsClient.close({ force: true })
    this.wsClient = undefined
  }

  async fetchBotOpenId(): Promise<string | undefined> {
    const response = await this.client.request<Record<string, unknown>>({
      method: "GET",
      url: "/open-apis/bot/v3/info",
    })
    return stringValue(recordValue(response.bot)?.open_id)
      ?? stringValue(recordValue(recordValue(response.data)?.bot)?.open_id)
      ?? stringValue(recordValue(response.data)?.open_id)
  }

  async replyText(ctx: FeishuReplyContext, content: string): Promise<void> {
    await this.sendMessage(ctx, "text", JSON.stringify({ text: content }), "reply")
  }

  async createText(ctx: FeishuReplyContext, content: string): Promise<void> {
    await this.sendMessage(ctx, "text", JSON.stringify({ text: content }), "create")
  }

  async sendCard(ctx: FeishuReplyContext, card: Record<string, unknown>): Promise<void> {
    await this.sendMessage(ctx, "interactive", JSON.stringify(card), ctx.messageId ? "reply" : "create")
  }

  async sendImage(ctx: FeishuReplyContext, image: Buffer): Promise<void> {
    const uploaded = await this.client.im.image.create({
      data: {
        image_type: "message",
        image,
      },
    })
    const imageKey = uploaded?.image_key
    if (!imageKey) throw new Error("飞书图片上传失败。")
    await this.sendMessage(ctx, "image", JSON.stringify({ image_key: imageKey }), ctx.messageId ? "reply" : "create")
  }

  async sendFile(ctx: FeishuReplyContext, fileName: string, file: Buffer): Promise<void> {
    const uploaded = await this.client.im.file.create({
      data: {
        file_type: "stream",
        file_name: fileName,
        file,
      },
    })
    const fileKey = uploaded?.file_key
    if (!fileKey) throw new Error("飞书文件上传失败。")
    await this.sendMessage(ctx, "file", JSON.stringify({ file_key: fileKey }), ctx.messageId ? "reply" : "create")
  }

  async addReaction(messageId: string, emojiType: string): Promise<string | undefined> {
    const response = await this.client.im.v1.messageReaction.create({
      path: { message_id: messageId },
      data: { reaction_type: { emoji_type: emojiType } },
    })
    return stringValue(response.data?.reaction_id)
  }

  async removeReaction(messageId: string, reactionId: string): Promise<void> {
    await this.client.im.v1.messageReaction.delete({
      path: { message_id: messageId, reaction_id: reactionId },
    })
  }

  private async sendMessage(
    ctx: FeishuReplyContext,
    msgType: FeishuMsgType,
    content: string,
    mode: "reply" | "create",
  ): Promise<string | undefined> {
    if (mode === "reply" && ctx.messageId) {
      const response = await this.client.im.message.reply({
        path: { message_id: ctx.messageId },
        data: {
          msg_type: msgType,
          content,
          reply_in_thread: ctx.replyInThread,
        },
      })
      return stringValue(response.data?.message_id)
    }

    const receiveByUser = ctx.chatType === "direct" && ctx.userId
    const response = await this.client.im.message.create({
      params: {
        receive_id_type: receiveByUser ? "open_id" : "chat_id",
      },
      data: {
        receive_id: receiveByUser ? ctx.userId as string : ctx.chatId,
        msg_type: msgType,
        content,
      },
    })
    return stringValue(response.data?.message_id)
  }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}
