import * as Lark from "@larksuiteoapi/node-sdk"
import type { SynapseInboundAttachment, SynapseInboundMessage } from "../../src/types/connector"
import type { SynapseConfig, SynapseProjectConfig, SynapseProjectPlatformConnection } from "../../src/types/config"
import type { PermissionGuard, AuditSink } from "../runtime/security"
import type { StructuredLogger } from "../runtime/service-registry"
import { allowListAllows } from "./access-policy-service"
import type { AgentSessionsStoreService } from "./agent-sessions-store-service"
import type { AgentSessionConnectResult } from "./agent-session-connect-service"
import type { ConnectorSecretStoreService } from "./connector-secret-store-service"
import { normalizeInboundMessage } from "./inbound-message-normalizer"
import type { SynapseAgentEvent } from "./session-event-service"

export type FeishuLarkPlatform = "feishu" | "lark"

export type FeishuLarkRuntimeStatus =
  | "stopped"
  | "starting"
  | "connected"
  | "failed"

export type FeishuLarkReplyContext = {
  platform: FeishuLarkPlatform
  projectId: string
  connectionId: string
  chatId: string
  messageId?: string
  sessionKey: string
  replyInThread: boolean
  receiveIdType?: "chat_id" | "open_id"
}

export type FeishuLarkInboundEvent = {
  messageId: string
  chatId: string
  chatType: string
  messageType: string
  content: string
  senderId: string
  senderName?: string
  chatName?: string
  rootId?: string
  threadId?: string
  parentId?: string
  mentions: FeishuLarkMention[]
  createTime?: string
}

export type FeishuLarkMention = {
  key: string
  openId?: string
  userId?: string
  name?: string
}

export type FeishuLarkOutboundText = {
  chatId: string
  content: string
  replyToMessageId?: string
  replyInThread?: boolean
  receiveIdType?: "chat_id" | "open_id"
}

export type FeishuLarkAdapterHandlers = {
  onMessage: (event: unknown) => Promise<void>
  onCardAction: (event: unknown) => Promise<void>
  onBotMenu: (event: unknown) => Promise<void>
}

export type FeishuLarkRuntimeAdapter = {
  start: (handlers: FeishuLarkAdapterHandlers) => Promise<void>
  stop: () => Promise<void>
  sendText: (input: FeishuLarkOutboundText) => Promise<void>
  fetchBotOpenId?: () => Promise<string | null>
}

export type FeishuLarkAdapterContext = {
  platform: FeishuLarkPlatform
  appId: string
  appSecret: string
  domain?: string
  logger: StructuredLogger
}

export type FeishuLarkRuntimeAdapterFactory = (context: FeishuLarkAdapterContext) => FeishuLarkRuntimeAdapter

type ConfigAccess = {
  load: () => Promise<SynapseConfig>
}

type SecretReader = Pick<ConnectorSecretStoreService, "readConnectorSecretValue">
type AgentSessions = Pick<AgentSessionsStoreService, "connectInbound">

export type FeishuLarkRuntimeServiceOptions = {
  config: ConfigAccess
  secretStore: SecretReader
  agentSessions: AgentSessions
  permissionGuard: PermissionGuard
  auditSink: AuditSink
  adapterFactory?: FeishuLarkRuntimeAdapterFactory
  agentEvents?: (input: {
    project: SynapseProjectConfig
    connection: SynapseProjectPlatformConnection
    inbound: SynapseInboundMessage
  }) => SynapseAgentEvent[] | Promise<SynapseAgentEvent[]>
  logger?: StructuredLogger
  now?: () => Date
}

type RuntimeHandle = {
  projectId: string
  connectionId: string
  platform: FeishuLarkPlatform
  adapter: FeishuLarkRuntimeAdapter
  status: FeishuLarkRuntimeStatus
  error: string | null
  connectedAt: string | null
  botOpenId: string | null
}

type RuntimeSnapshot = {
  projectId: string
  connectionId: string
  platform: FeishuLarkPlatform
  status: FeishuLarkRuntimeStatus
  error: string | null
  connectedAt: string | null
}

type LarkSdkLogger = {
  error: (...msg: unknown[]) => void | Promise<void>
  warn: (...msg: unknown[]) => void | Promise<void>
  info: (...msg: unknown[]) => void | Promise<void>
  debug: (...msg: unknown[]) => void | Promise<void>
  trace: (...msg: unknown[]) => void | Promise<void>
}

const FEISHU_OPEN_BASE_URL = "https://open.feishu.cn"
const LARK_OPEN_BASE_URL = "https://open.larksuite.com"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function readBoolean(value: unknown): boolean {
  return value === true
}

function readOptionString(
  connection: SynapseProjectPlatformConnection,
  name: string,
): string | undefined {
  return readString(connection.options?.[name])
}

function readOptionBoolean(
  connection: SynapseProjectPlatformConnection,
  name: string,
): boolean {
  return readBoolean(connection.options?.[name])
}

function isFeishuLarkPlatform(value: string): value is FeishuLarkPlatform {
  return value === "feishu" || value === "lark"
}

function connectionKey(projectId: string, connectionId: string): string {
  return `${projectId}:${connectionId}`
}

function platformOpenBaseUrl(platform: FeishuLarkPlatform): string {
  return platform === "lark" ? LARK_OPEN_BASE_URL : FEISHU_OPEN_BASE_URL
}

function networkResource(platform: FeishuLarkPlatform, domain: string | undefined): string {
  const raw = domain ?? platformOpenBaseUrl(platform)
  try {
    return new URL(raw).origin
  } catch {
    return platformOpenBaseUrl(platform)
  }
}

function sdkDomain(platform: FeishuLarkPlatform, domain: string | undefined): string | Lark.Domain {
  return domain ?? (platform === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu)
}

function stableMessageText(content: string): string {
  const trimmed = content.trim()
  return trimmed || "处理完成。"
}

function parseJsonRecord(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content) as unknown
    return readRecord(parsed)
  } catch {
    return {}
  }
}

function flattenPostContent(value: unknown): {
  text: string
  attachments: SynapseInboundAttachment[]
} {
  const record = readRecord(value)
  const content = Array.isArray(record.content) ? record.content : []
  const lines: string[] = []
  const attachments: SynapseInboundAttachment[] = []

  for (const row of content) {
    const rowItems = Array.isArray(row) ? row : []
    const parts: string[] = []
    for (const item of rowItems) {
      const itemRecord = readRecord(item)
      const tag = readString(itemRecord.tag)
      if (tag === "text") {
        const text = readString(itemRecord.text)
        if (text) {
          parts.push(text)
        }
      } else if (tag === "a") {
        const text = readString(itemRecord.text)
        const href = readString(itemRecord.href)
        if (text && href) {
          parts.push(`${text} ${href}`)
        } else if (text) {
          parts.push(text)
        } else if (href) {
          parts.push(href)
        }
      } else if (tag === "img") {
        const ref = readString(itemRecord.image_key)
        attachments.push({
          kind: "image",
          ...(ref ? { ref } : undefined),
        })
      }
    }
    const line = parts.join("").trim()
    if (line) {
      lines.push(line)
    }
  }

  return {
    text: lines.join("\n"),
    attachments,
  }
}

function contentFromMessage(event: FeishuLarkInboundEvent): {
  text: string
  attachments: SynapseInboundAttachment[]
} {
  const body = parseJsonRecord(event.content)

  switch (event.messageType) {
    case "text":
      return { text: readString(body.text) ?? "", attachments: [] }
    case "post":
      return flattenPostContent(body)
    case "image": {
      const ref = readString(body.image_key)
      return {
        text: "",
        attachments: [{
          kind: "image",
          ...(ref ? { ref } : undefined),
        }],
      }
    }
    case "audio": {
      const ref = readString(body.file_key)
      return {
        text: "",
        attachments: [{
          kind: "audio",
          ...(ref ? { ref } : undefined),
        }],
      }
    }
    case "file": {
      const ref = readString(body.file_key)
      const name = readString(body.file_name)
      return {
        text: "",
        attachments: [{
          kind: "file",
          ...(ref ? { ref } : undefined),
          ...(name ? { name } : undefined),
        }],
      }
    }
    case "merge_forward":
      return { text: "[merge_forward]", attachments: [] }
    default:
      return { text: "", attachments: [] }
  }
}

function stripMentions(text: string, mentions: readonly FeishuLarkMention[], botOpenId: string | undefined): string {
  let next = text
  for (const mention of mentions) {
    if (!mention.key) {
      continue
    }
    if (botOpenId && mention.openId === botOpenId) {
      next = next.replaceAll(mention.key, "")
    } else if (mention.name) {
      next = next.replaceAll(mention.key, `@${mention.name}`)
    } else {
      next = next.replaceAll(mention.key, "")
    }
  }
  return next.trim()
}

function botMentioned(mentions: readonly FeishuLarkMention[], botOpenId: string | undefined): boolean {
  return Boolean(botOpenId) && mentions.some((mention) => mention.openId === botOpenId)
}

function sessionKeyFor(input: {
  platform: FeishuLarkPlatform
  connection: SynapseProjectPlatformConnection
  chatId: string
  userId: string
  chatType?: string
  rootId?: string
  messageId?: string
}): string {
  const threadIsolation = readOptionBoolean(input.connection, "thread_isolation")
  if (threadIsolation && input.chatType === "group") {
    const rootId = input.rootId || input.messageId
    if (rootId) {
      return `${input.platform}:${input.chatId}:root:${rootId}`
    }
  }

  if (input.connection.shareSessionInChannel || readOptionBoolean(input.connection, "share_session_in_channel")) {
    return `${input.platform}:${input.chatId}`
  }

  return `${input.platform}:${input.chatId}:${input.userId}`
}

function replyInThread(sessionKey: string, connection: SynapseProjectPlatformConnection): boolean {
  return readOptionBoolean(connection, "thread_isolation") && /:root:/u.test(sessionKey)
}

function mentionsFrom(raw: unknown): FeishuLarkMention[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.map((item) => {
    const record = readRecord(item)
    const id = readRecord(record.id)
    return {
      key: readString(record.key) ?? "",
      openId: readString(id.open_id),
      userId: readString(id.user_id),
      name: readString(record.name),
    }
  }).filter((item) => item.key)
}

export function parseFeishuLarkMessageEvent(raw: unknown): FeishuLarkInboundEvent | null {
  const record = readRecord(raw)
  const message = readRecord(record.message)
  const sender = readRecord(record.sender)
  const senderId = readRecord(sender.sender_id)
  const userId = readString(senderId.open_id) ?? readString(senderId.user_id) ?? readString(senderId.union_id)
  const chatId = readString(message.chat_id)
  const messageId = readString(message.message_id)

  if (!userId || !chatId || !messageId) {
    return null
  }

  return {
    messageId,
    chatId,
    chatType: readString(message.chat_type) ?? "",
    messageType: readString(message.message_type) ?? "",
    content: readString(message.content) ?? "",
    senderId: userId,
    rootId: readString(message.root_id),
    threadId: readString(message.thread_id),
    parentId: readString(message.parent_id),
    mentions: mentionsFrom(message.mentions),
    createTime: readString(message.create_time),
  }
}

function actionValue(raw: unknown): string {
  const record = readRecord(raw)
  const action = readRecord(record.action)
  const value = readRecord(action.value)
  const explicit = readString(value.action)
  if (explicit) {
    return explicit
  }

  const option = readString(action.option)
  if (option) {
    return option
  }

  switch (readString(action.name)) {
    case "delete_mode_submit":
      return "act:/delete-mode form-submit"
    case "delete_mode_cancel":
      return "act:/delete-mode cancel"
    default:
      return ""
  }
}

function cardSessionKey(input: {
  platform: FeishuLarkPlatform
  connection: SynapseProjectPlatformConnection
  chatId: string
  userId: string
  value: Record<string, unknown>
}): string {
  const explicit = readString(input.value.session_key)
  if (explicit) {
    return explicit
  }

  if (input.connection.shareSessionInChannel || readOptionBoolean(input.connection, "share_session_in_channel")) {
    return `${input.platform}:${input.chatId}`
  }
  return `${input.platform}:${input.chatId}:${input.userId}`
}

function isSdkResponseOk(response: { code?: number; msg?: string } | undefined): boolean {
  return response?.code === undefined || response.code === 0
}

class OfficialFeishuLarkAdapter implements FeishuLarkRuntimeAdapter {
  private readonly platform: FeishuLarkPlatform
  private readonly domain: string | Lark.Domain
  private readonly logger: StructuredLogger
  private readonly client: InstanceType<typeof Lark.Client>
  private readonly wsClient: InstanceType<typeof Lark.WSClient>

  constructor(context: FeishuLarkAdapterContext) {
    const logger = createSdkLogger(context.logger)
    this.platform = context.platform
    this.domain = sdkDomain(context.platform, context.domain)
    this.logger = context.logger
    this.client = new Lark.Client({
      appId: context.appId,
      appSecret: context.appSecret,
      domain: this.domain,
      logger,
      loggerLevel: Lark.LoggerLevel.warn,
      source: "synapse",
    })
    this.wsClient = new Lark.WSClient({
      appId: context.appId,
      appSecret: context.appSecret,
      domain: this.domain,
      logger,
      loggerLevel: Lark.LoggerLevel.info,
      source: "synapse",
    })
  }

  async start(handlers: FeishuLarkAdapterHandlers): Promise<void> {
    const dispatcher = new Lark.EventDispatcher({
      logger: createSdkLogger(this.logger.child("events")),
      loggerLevel: Lark.LoggerLevel.warn,
    }).register({
      "im.message.receive_v1": (event: unknown) => handlers.onMessage(event),
      "im.message.message_read_v1": () => undefined,
      "im.message.reaction.created_v1": () => undefined,
      "im.message.reaction.deleted_v1": () => undefined,
      "card.action.trigger": (event: unknown) => handlers.onCardAction(event),
      "application.bot.menu_v6": (event: unknown) => handlers.onBotMenu(event),
    })

    await this.wsClient.start({ eventDispatcher: dispatcher })
  }

  async stop(): Promise<void> {
    this.wsClient.close({ force: true })
  }

  async sendText(input: FeishuLarkOutboundText): Promise<void> {
    const payload = {
      msg_type: "text",
      content: JSON.stringify({ text: stableMessageText(input.content) }),
    }

    if (input.replyToMessageId) {
      const response = await this.client.im.v1.message.reply({
        path: { message_id: input.replyToMessageId },
        data: {
          ...payload,
          ...(input.replyInThread ? { reply_in_thread: true } : undefined),
        },
      })
      if (!isSdkResponseOk(response)) {
        throw new Error(`reply failed: ${response?.code ?? "unknown"} ${response?.msg ?? ""}`.trim())
      }
      return
    }

    const response = await this.client.im.v1.message.create({
      params: {
        receive_id_type: input.receiveIdType ?? "chat_id",
      },
      data: {
        receive_id: input.chatId,
        ...payload,
      },
    })
    if (!isSdkResponseOk(response)) {
      throw new Error(`send failed: ${response?.code ?? "unknown"} ${response?.msg ?? ""}`.trim())
    }
  }

  async fetchBotOpenId(): Promise<string | null> {
    const response = await this.client.request<{ bot?: { open_id?: string } }>({
      url: "/open-apis/bot/v3/info",
      method: "GET",
    })
    return readString(response.bot?.open_id) ?? null
  }
}

function createSdkLogger(logger: StructuredLogger): LarkSdkLogger {
  const sanitize = (value: unknown): unknown => {
    if (typeof value !== "string") {
      return value
    }
    return value.replace(/(secret|token|ticket|key)=([^&\s]+)/giu, "$1=***")
  }

  return {
    error: (...msg: unknown[]) => logger.error("Feishu/Lark SDK error", { msg: msg.map(sanitize) }),
    warn: (...msg: unknown[]) => logger.warn("Feishu/Lark SDK warn", { msg: msg.map(sanitize) }),
    info: (...msg: unknown[]) => logger.info("Feishu/Lark SDK info", { msg: msg.map(sanitize) }),
    debug: (...msg: unknown[]) => logger.debug("Feishu/Lark SDK debug", { msg: msg.map(sanitize) }),
    trace: (...msg: unknown[]) => logger.trace("Feishu/Lark SDK trace", { msg: msg.map(sanitize) }),
  }
}

function createNullStructuredLogger(): StructuredLogger {
  const noop = () => undefined
  const logger: StructuredLogger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => logger,
  }
  return logger
}

export class FeishuLarkRuntimeService {
  private readonly config: ConfigAccess
  private readonly secretStore: SecretReader
  private readonly agentSessions: AgentSessions
  private readonly permissionGuard: PermissionGuard
  private readonly auditSink: AuditSink
  private readonly adapterFactory: FeishuLarkRuntimeAdapterFactory
  private readonly agentEvents?: FeishuLarkRuntimeServiceOptions["agentEvents"]
  private readonly logger: StructuredLogger
  private readonly now: () => Date
  private readonly handles = new Map<string, RuntimeHandle>()

  constructor(options: FeishuLarkRuntimeServiceOptions) {
    this.config = options.config
    this.secretStore = options.secretStore
    this.agentSessions = options.agentSessions
    this.permissionGuard = options.permissionGuard
    this.auditSink = options.auditSink
    this.adapterFactory = options.adapterFactory ?? ((context) => new OfficialFeishuLarkAdapter(context))
    this.agentEvents = options.agentEvents
    this.logger = options.logger ?? createNullStructuredLogger()
    this.now = options.now ?? (() => new Date())
  }

  listSnapshots(): RuntimeSnapshot[] {
    return Array.from(this.handles.values()).map((handle) => ({
      projectId: handle.projectId,
      connectionId: handle.connectionId,
      platform: handle.platform,
      status: handle.status,
      error: handle.error,
      connectedAt: handle.connectedAt,
    }))
  }

  async startAllFromConfig(): Promise<void> {
    const config = await this.config.load()
    const activeKeys = new Set<string>()
    for (const project of config.global.projects) {
      for (const connection of project.platformConnections ?? []) {
        if (!isFeishuLarkPlatform(connection.type) || !connection.enabled || connection.status !== "configured") {
          continue
        }
        activeKeys.add(connectionKey(project.id, connection.id))
        await this.startConnection(config, project, connection)
      }
    }

    await Promise.all(Array.from(this.handles.keys())
      .filter((key) => !activeKeys.has(key))
      .map((key) => this.stopByKey(key)))
  }

  async startOrReloadProjectConnection(projectId: string, connectionId: string): Promise<void> {
    const config = await this.config.load()
    const project = config.global.projects.find((item) => item.id === projectId)
    const connection = project?.platformConnections?.find((item) => item.id === connectionId)
    if (!project || !connection) {
      throw new Error("平台连接不存在。")
    }

    await this.stopByKey(connectionKey(projectId, connectionId))
    if (!isFeishuLarkPlatform(connection.type) || !connection.enabled || connection.status !== "configured") {
      return
    }

    await this.startConnection(config, project, connection)
  }

  async stopAll(): Promise<void> {
    await Promise.all(Array.from(this.handles.keys()).map((key) => this.stopByKey(key)))
  }

  async handleMessageEvent(
    project: SynapseProjectConfig,
    connection: SynapseProjectPlatformConnection,
    raw: unknown,
    runtimeBotOpenId?: string | null,
  ): Promise<void> {
    if (!isFeishuLarkPlatform(connection.type)) {
      return
    }

    const event = parseFeishuLarkMessageEvent(raw)
    if (!event) {
      this.logger.warn("Dropped malformed Feishu/Lark message event.", {
        projectId: project.id,
        connectionId: connection.id,
      })
      return
    }

    const botOpenId = runtimeBotOpenId ?? readOptionString(connection, "bot_open_id")
    if (event.chatType === "group" && !connection.groupReplyAll && !readOptionBoolean(connection, "group_reply_all") && botOpenId) {
      if (!botMentioned(event.mentions, botOpenId)) {
        return
      }
    }

    if (!allowListAllows(connection.allowFrom ?? readOptionString(connection, "allow_from"), event.senderId)) {
      return
    }

    const parsed = contentFromMessage(event)
    const text = stripMentions(parsed.text, event.mentions, botOpenId)
    const sessionKey = sessionKeyFor({
      platform: connection.type,
      connection,
      chatId: event.chatId,
      userId: event.senderId,
      chatType: event.chatType,
      rootId: event.rootId,
      messageId: event.messageId,
    })

    await this.dispatchInbound(project, connection, {
      Platform: connection.type,
      SessionKey: sessionKey,
      ChannelID: event.chatId,
      ChatID: event.chatId,
      MessageID: event.messageId,
      UserID: event.senderId,
      UserName: event.senderName,
      ChatName: event.chatName,
      Content: text,
      Images: parsed.attachments.filter((attachment) => attachment.kind === "image"),
      Files: parsed.attachments.filter((attachment) => attachment.kind === "file"),
      Audio: parsed.attachments.filter((attachment) => attachment.kind === "audio"),
      ReplyCtx: {
        platform: connection.type,
        projectId: project.id,
        connectionId: connection.id,
        chatId: event.chatId,
        messageId: event.messageId,
        sessionKey,
        replyInThread: replyInThread(sessionKey, connection),
      } satisfies FeishuLarkReplyContext,
    })
  }

  async handleCardActionEvent(
    project: SynapseProjectConfig,
    connection: SynapseProjectPlatformConnection,
    raw: unknown,
  ): Promise<void> {
    if (!isFeishuLarkPlatform(connection.type)) {
      return
    }

    const record = readRecord(raw)
    const action = actionValue(record)
    if (!action || action.startsWith("nav:") || action.startsWith("act:")) {
      return
    }

    const operator = readRecord(record.operator)
    const userId = readString(operator.open_id) ?? readString(operator.user_id)
    if (!userId || !allowListAllows(connection.allowFrom ?? readOptionString(connection, "allow_from"), userId)) {
      return
    }

    const context = readRecord(record.context)
    const chatId = readString(context.open_chat_id) ?? readString(record.open_chat_id) ?? userId
    const messageId = readString(context.open_message_id) ?? readString(record.open_message_id)
    const value = readRecord(readRecord(record.action).value)
    const sessionKey = cardSessionKey({
      platform: connection.type,
      connection,
      chatId,
      userId,
      value,
    })
    const content = action.startsWith("cmd:")
      ? action.slice("cmd:".length).trim()
      : action === "perm:allow"
        ? "allow"
        : action === "perm:deny"
          ? "deny"
          : action === "perm:allow_all"
            ? "allow all"
            : action.startsWith("askq:")
              ? action
              : ""

    if (!content) {
      return
    }

    await this.dispatchInbound(project, connection, {
      Platform: connection.type,
      SessionKey: sessionKey,
      ChannelID: chatId,
      ChatID: chatId,
      MessageID: messageId,
      UserID: userId,
      Content: content,
      ReplyCtx: {
        platform: connection.type,
        projectId: project.id,
        connectionId: connection.id,
        chatId,
        ...(messageId ? { messageId } : undefined),
        sessionKey,
        replyInThread: replyInThread(sessionKey, connection),
      } satisfies FeishuLarkReplyContext,
    })
  }

  async handleBotMenuEvent(
    project: SynapseProjectConfig,
    connection: SynapseProjectPlatformConnection,
    raw: unknown,
  ): Promise<void> {
    if (!isFeishuLarkPlatform(connection.type)) {
      return
    }

    const record = readRecord(raw)
    const eventKey = readString(record.event_key)
    const operator = readRecord(record.operator)
    const operatorId = readRecord(operator.operator_id)
    const userId = readString(operatorId.open_id) ?? readString(operatorId.user_id)
    if (!eventKey || !userId || !allowListAllows(connection.allowFrom ?? readOptionString(connection, "allow_from"), userId)) {
      return
    }

    const content = eventKey.startsWith("/") ? eventKey : `/${eventKey}`
    const sessionKey = `${connection.type}:${userId}:${userId}`
    await this.dispatchInbound(project, connection, {
      Platform: connection.type,
      SessionKey: sessionKey,
      ChannelID: userId,
      UserID: userId,
      Content: content,
      ReplyCtx: {
        platform: connection.type,
        projectId: project.id,
        connectionId: connection.id,
        chatId: userId,
        sessionKey,
        replyInThread: false,
        receiveIdType: "open_id",
      } satisfies FeishuLarkReplyContext,
    })
  }

  private async startConnection(
    config: SynapseConfig,
    project: SynapseProjectConfig,
    connection: SynapseProjectPlatformConnection,
  ): Promise<void> {
    if (!isFeishuLarkPlatform(connection.type)) {
      return
    }

    const appId = readOptionString(connection, "app_id")
    const secretRef = connection.secretRefs?.app_secret
    if (!appId || !secretRef) {
      this.setFailed(project.id, connection, "app_id or app_secret is missing")
      return
    }

    const appSecret = await this.secretStore.readConnectorSecretValue(secretRef)
    if (!appSecret) {
      this.setFailed(project.id, connection, "app_secret is missing")
      return
    }

    const domain = readOptionString(connection, "domain")
    await this.checkNetworkPermission(connection.type, domain)

    const adapter = this.adapterFactory({
      platform: connection.type,
      appId,
      appSecret,
      ...(domain ? { domain } : undefined),
      logger: this.logger.child(`connector:${connection.type}`, {
        projectId: project.id,
        connectionId: connection.id,
      }),
    })

    const key = connectionKey(project.id, connection.id)
    const handle: RuntimeHandle = {
      projectId: project.id,
      connectionId: connection.id,
      platform: connection.type,
      adapter,
      status: "starting",
      error: null,
      connectedAt: null,
      botOpenId: null,
    }
    this.handles.set(key, handle)

    try {
      handle.botOpenId = await this.fetchBotOpenId(adapter, project.id, connection.id)
      await adapter.start({
        onMessage: (event) => this.handleMessageEvent(project, connection, event, handle.botOpenId),
        onCardAction: (event) => this.handleCardActionEvent(project, connection, event),
        onBotMenu: (event) => this.handleBotMenuEvent(project, connection, event),
      })
      handle.status = "connected"
      handle.connectedAt = this.now().toISOString()
      this.auditSink.record({
        action: "network.connect",
        actor: { kind: "user" },
        resource: networkResource(connection.type, domain),
        outcome: "allowed",
        metadata: {
          source: "connectors.runtime",
          platform: connection.type,
          projectId: project.id,
          connectionId: connection.id,
          projectCount: config.global.projects.length,
        },
      })
    } catch (error) {
      handle.status = "failed"
      handle.error = error instanceof Error ? error.message : String(error)
      this.auditSink.record({
        action: "network.connect",
        actor: { kind: "user" },
        resource: networkResource(connection.type, domain),
        outcome: "failed",
        metadata: {
          source: "connectors.runtime",
          platform: connection.type,
          projectId: project.id,
          connectionId: connection.id,
          error: handle.error,
        },
      })
      throw error
    }
  }

  private async dispatchInbound(
    project: SynapseProjectConfig,
    connection: SynapseProjectPlatformConnection,
    raw: Record<string, unknown>,
  ): Promise<AgentSessionConnectResult | null> {
    const normalized = normalizeInboundMessage(raw, {
      connectorId: connection.id,
      platform: connection.type,
      allowFrom: connection.allowFrom ?? readOptionString(connection, "allow_from"),
      shareSessionInChannel: connection.shareSessionInChannel ?? readOptionBoolean(connection, "share_session_in_channel"),
      threadIsolation: readOptionBoolean(connection, "thread_isolation"),
      now: this.now,
    })

    if (!normalized.ok) {
      this.logger.warn("Dropped Feishu/Lark inbound message.", {
        projectId: project.id,
        connectionId: connection.id,
        code: normalized.code,
      })
      return null
    }

    const config = await this.config.load()
    const events = this.agentEvents
      ? await this.agentEvents({ project, connection, inbound: normalized.message })
      : undefined
    const result = await this.agentSessions.connectInbound(
      config.global.projects,
      project.id,
      normalized.message,
      events ? { events } : undefined,
    )
    await this.sendOutbound(result)
    return result
  }

  private async sendOutbound(result: AgentSessionConnectResult): Promise<void> {
    const outbound = result.outbound
    if (outbound.kind === "pending") {
      return
    }

    const replyContext = outbound.replyContext
    if (!isRecord(replyContext)) {
      return
    }

    const projectId = readString(replyContext.projectId)
    const connectionId = readString(replyContext.connectionId)
    const platform = readString(replyContext.platform)
    const chatId = readString(replyContext.chatId)
    if (!projectId || !connectionId || !platform || !isFeishuLarkPlatform(platform) || !chatId) {
      return
    }

    const handle = this.handles.get(connectionKey(projectId, connectionId))
    if (!handle) {
      return
    }

    await handle.adapter.sendText({
      chatId,
      content: outbound.content,
      replyToMessageId: readString(replyContext.messageId),
      replyInThread: replyContext.replyInThread === true,
      receiveIdType: readString(replyContext.receiveIdType) === "open_id" ? "open_id" : "chat_id",
    })
  }

  private async stopByKey(key: string): Promise<void> {
    const handle = this.handles.get(key)
    if (!handle) {
      return
    }
    this.handles.delete(key)
    try {
      await handle.adapter.stop()
    } catch (error) {
      this.logger.warn("Failed to stop Feishu/Lark runtime.", {
        projectId: handle.projectId,
        connectionId: handle.connectionId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private setFailed(
    projectId: string,
    connection: SynapseProjectPlatformConnection,
    error: string,
  ): void {
    this.handles.set(connectionKey(projectId, connection.id), {
      projectId,
      connectionId: connection.id,
      platform: isFeishuLarkPlatform(connection.type) ? connection.type : "feishu",
      adapter: {
        start: async () => undefined,
        stop: async () => undefined,
        sendText: async () => undefined,
      },
      status: "failed",
      error,
      connectedAt: null,
      botOpenId: null,
    })
  }

  private async fetchBotOpenId(
    adapter: FeishuLarkRuntimeAdapter,
    projectId: string,
    connectionId: string,
  ): Promise<string | null> {
    if (!adapter.fetchBotOpenId) {
      return null
    }

    try {
      return await adapter.fetchBotOpenId()
    } catch (error) {
      this.logger.warn("Failed to resolve Feishu/Lark bot open_id.", {
        projectId,
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  private async checkNetworkPermission(platform: FeishuLarkPlatform, domain: string | undefined): Promise<void> {
    const resource = networkResource(platform, domain)
    const result = await this.permissionGuard.check({
      action: "network.connect",
      actor: { kind: "user" },
      resource,
      context: {
        source: "connectors.runtime",
        platform,
      },
    })

    if (!result.allowed) {
      this.auditSink.record({
        action: "network.connect",
        actor: { kind: "user" },
        resource,
        outcome: "denied",
        metadata: {
          source: "connectors.runtime",
          platform,
          reason: result.reason,
        },
      })
      throw new Error("外部平台连接未授权。")
    }
  }
}
