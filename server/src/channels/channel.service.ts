import { Injectable, OnDestroy, OnModuleInit, Optional } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { randomUUID } from "node:crypto"
import {
  CHANNEL_OPEN_BASE,
  CHANNEL_WS_CLOSE_CODES,
  channelCreateSchema,
  channelEventNameSchema,
  channelPublishHttpSchema,
  channelTokenCreateSchema,
  channelUpdateSchema,
  type ChannelEventSender,
  type ChannelPresenceMember,
  type ChannelRetainedItem,
  type ChannelRole,
} from "@synapse/shared/channel-contracts"
import type { PinoLogger } from "nestjs-pino"
import {
  CHANNELS_MANAGE_SCOPE,
  CHANNELS_PUBLISH_SCOPE,
  CHANNELS_SUBSCRIBE_SCOPE,
} from "../api-keys/api-key-capabilities"
import { ApiKeyChangeNotifier, type ApiKeyChangeEvent } from "../api-keys/api-key-change-notifier"
import { ApiKeyService } from "../api-keys/api-key.service"
import { OpenApiHttpError } from "../open-api/open-api.types"
import { PrismaService } from "../prisma/prisma.service"
import { ChannelDebugTicketStore, isChannelDebugTicket } from "./channel-debug-ticket"
import { ChannelHub } from "./channel-hub"
import {
  createChannelTokenSecret,
  getChannelTokenPrefix,
  hashChannelTokenSecret,
  isChannelTokenSecret,
} from "./channel-token"

export type ChannelActor =
  | { readonly kind: "console"; readonly userId: string }
  | {
      readonly kind: "api_key"
      readonly userId: string
      readonly apiKeyId: string
      readonly scopes: readonly string[]
      readonly channelAccessMode: "selected" | "all_owned"
      readonly channelIds: readonly string[]
    }
  | {
      readonly kind: "channel_token"
      readonly channelId: string
      readonly ownerId: string
      readonly tokenId: string
      readonly role: ChannelRole
    }

export type ResolvedWsCredential = {
  readonly channelId: string
  readonly ownerId: string
  readonly credentialType: "channel_token" | "api_key" | "console_ticket"
  readonly credentialId: string
  readonly role: ChannelRole
  readonly isObserver: boolean
  readonly seqFloor: number
}

export type ChannelSummaryDto = {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly onlineCount: number
  readonly tokenCount: number
  readonly createdAt: string
  readonly updatedAt: string
}

export type ChannelTokenDto = {
  readonly id: string
  readonly channelId: string
  readonly name: string
  readonly role: ChannelRole
  readonly prefix: string
  readonly lastUsedAt: string | null
  readonly createdAt: string
}

export type ChannelPublishResult = {
  readonly seq: number
  readonly deliveredCount: number
  readonly retained: boolean
  readonly sentAt: string
}

const TOKEN_LAST_USED_THROTTLE_MS = 60_000
const TOKEN_LAST_USED_CACHE_MAX = 5000

function resolveApiKeyWsRole(scopes: readonly string[]): ChannelRole | null {
  const canPub = scopes.includes(CHANNELS_PUBLISH_SCOPE)
  const canSub = scopes.includes(CHANNELS_SUBSCRIBE_SCOPE)
  if (canPub && canSub) return "pubsub"
  if (canPub) return "publish"
  if (canSub) return "subscribe"
  return null
}

function apiKeyCanAccessChannel(
  mode: "selected" | "all_owned",
  channelIds: readonly string[],
  channelId: string,
): boolean {
  return mode === "all_owned" || channelIds.includes(channelId)
}

function parseBody<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } }, input: unknown, message: string): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw new OpenApiHttpError(400, "INVALID_REQUEST", message)
  return parsed.data
}

@Injectable()
export class ChannelService implements OnModuleInit, OnDestroy {
  private unsubscribeNotifier: (() => void) | null = null
  private readonly tokenLastUsedCache = new Map<string, number>()
  private readonly retainLocks = new Map<string, Promise<unknown>>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly apiKeys: ApiKeyService,
    private readonly apiKeyNotifier: ApiKeyChangeNotifier,
    readonly hub: ChannelHub,
    private readonly debugTickets: ChannelDebugTicketStore,
    @Optional() private readonly logger?: PinoLogger,
  ) {}

  onModuleInit(): void {
    this.unsubscribeNotifier = this.apiKeyNotifier.onChange((event) => this.handleApiKeyChange(event))
  }

  onModuleDestroy(): void {
    this.unsubscribeNotifier?.()
    this.unsubscribeNotifier = null
  }

  async authenticateOpenBearer(secret: string, targetChannelId: string | null): Promise<ChannelActor | null> {
    if (isChannelTokenSecret(secret)) {
      const tokenRow = await this.prisma.channelToken.findUnique({
        where: { tokenHash: hashChannelTokenSecret(secret) },
        include: { channel: { include: { owner: { select: { status: true } } } } },
      })
      if (!tokenRow || tokenRow.revokedAt || tokenRow.channel.owner.status !== "active") {
        return null
      }
      if (targetChannelId && tokenRow.channelId !== targetChannelId) {
        return null
      }
      this.touchChannelTokenLastUsed(tokenRow.id)
      return {
        kind: "channel_token",
        channelId: tokenRow.channelId,
        ownerId: tokenRow.channel.ownerId,
        tokenId: tokenRow.id,
        role: tokenRow.role as ChannelRole,
      }
    }

    const principal = await this.apiKeys.verifyOpenApiSecret(secret)
    if (!principal) return null
    void this.apiKeys.touchLastUsed(principal.apiKeyId)
    return {
      kind: "api_key",
      userId: principal.userId,
      apiKeyId: principal.apiKeyId,
      scopes: principal.scopes,
      channelAccessMode: principal.channelAccessMode,
      channelIds: principal.channelIds,
    }
  }

  async authenticateWsCredential(token: string, channelId: string): Promise<ResolvedWsCredential | null> {
    if (isChannelDebugTicket(token)) {
      const consumed = this.debugTickets.consume(token, channelId)
      if (!consumed) return null
      const channel = await this.prisma.channel.findUnique({
        where: { id: channelId },
        include: { owner: { select: { status: true } } },
      })
      if (!channel || channel.ownerId !== consumed.ownerId || channel.owner.status !== "active") return null
      const seqFloor = await this.resolveSeqFloor(channelId, channel.seqEpoch)
      return {
        channelId,
        ownerId: channel.ownerId,
        credentialType: "console_ticket",
        credentialId: `dbg_${randomUUID().replaceAll("-", "")}`,
        role: "pubsub",
        isObserver: true,
        seqFloor,
      }
    }

    const actor = await this.authenticateOpenBearer(token, channelId)
    if (!actor) return null

    if (actor.kind === "channel_token") {
      if (actor.channelId !== channelId) return null
      const channel = await this.prisma.channel.findUnique({
        where: { id: channelId },
        select: { id: true, ownerId: true, seqEpoch: true },
      })
      if (!channel) return null
      const seqFloor = await this.resolveSeqFloor(channelId, channel.seqEpoch)
      return {
        channelId,
        ownerId: channel.ownerId,
        credentialType: "channel_token",
        credentialId: actor.tokenId,
        role: actor.role,
        isObserver: false,
        seqFloor,
      }
    }

    if (actor.kind === "api_key") {
      const role = resolveApiKeyWsRole(actor.scopes)
      if (!role || !apiKeyCanAccessChannel(actor.channelAccessMode, actor.channelIds, channelId)) {
        return null
      }
      const channel = await this.prisma.channel.findUnique({
        where: { id: channelId },
        include: { owner: { select: { status: true } } },
      })
      if (!channel || channel.ownerId !== actor.userId || channel.owner.status !== "active") return null
      const seqFloor = await this.resolveSeqFloor(channelId, channel.seqEpoch)
      return {
        channelId,
        ownerId: channel.ownerId,
        credentialType: "api_key",
        credentialId: actor.apiKeyId,
        role,
        isObserver: false,
        seqFloor,
      }
    }

    return null
  }

  getPublishPreflight(actor: ChannelActor) {
    if (actor.kind !== "console") {
      throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "仅登录控制台或桌面 MCP 可读取发布前检查。")
    }
    const configured = (process.env.APP_PUBLIC_URL || "http://localhost:3000").replace(/\/+$/u, "")
    const wsBaseUrl = configured.replace(/^https:\/\//iu, "wss://").replace(/^http:\/\//iu, "ws://") + CHANNEL_OPEN_BASE
    const isLocal = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/iu.test(configured)
    return {
      accountId: actor.userId,
      publicAppUrl: configured,
      httpBaseUrl: `${configured}${CHANNEL_OPEN_BASE}`,
      wsBaseUrl,
      audience: isLocal ? "local_only" : "public",
      capabilities: {
        channels: true,
        websocket: true,
        presence: true,
        retain: true,
      },
    }
  }

  async listChannels(actor: ChannelActor): Promise<{ readonly data: ChannelSummaryDto[] }> {
    if (actor.kind === "channel_token") {
      throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "频道专属凭证不能列出频道目录。")
    }
    let idFilter: { in: string[] } | undefined
    if (actor.kind === "api_key") {
      const hasAnyChannelScope = actor.scopes.some((s) =>
        s === CHANNELS_MANAGE_SCOPE || s === CHANNELS_PUBLISH_SCOPE || s === CHANNELS_SUBSCRIBE_SCOPE,
      )
      if (!hasAnyChannelScope) {
        throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "API 密钥缺少频道相关权限。")
      }
      if (actor.channelAccessMode !== "all_owned") {
        if (actor.channelIds.length === 0) return { data: [] }
        idFilter = { in: [...actor.channelIds] }
      }
    }

    const rows = await this.prisma.channel.findMany({
      where: {
        ownerId: actor.userId,
        ...(idFilter ? { id: idFilter } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { tokens: { where: { revokedAt: null } } } } },
      take: 200,
    })

    return {
      data: rows.map((row) => this.toChannelSummary(row, row._count.tokens)),
    }
  }

  async createChannel(actor: ChannelActor, body: unknown): Promise<ChannelSummaryDto> {
    if (actor.kind === "channel_token") {
      throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "频道专属凭证不能创建频道。")
    }
    if (actor.kind === "api_key") {
      if (!actor.scopes.includes(CHANNELS_MANAGE_SCOPE) || actor.channelAccessMode !== "all_owned") {
        throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "仅具备 channels.manage 且范围为“全部自有频道”的密钥可创建频道。")
      }
    }
    const parsed = parseBody(channelCreateSchema, body, "频道创建参数无效。")
    const created = await this.prisma.channel.create({
      data: {
        id: `ch_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
        ownerId: actor.userId,
        name: parsed.name,
        description: parsed.description,
      },
    })
    return this.toChannelSummary(created, 0)
  }

  async getChannel(actor: ChannelActor, channelId: string): Promise<ChannelSummaryDto> {
    const channel = await this.requireOwnedChannel(actor, channelId, "read_meta")
    return this.toChannelSummary(channel, channel._count.tokens)
  }

  async updateChannel(actor: ChannelActor, channelId: string, body: unknown): Promise<ChannelSummaryDto> {
    await this.requireOwnedChannel(actor, channelId, "manage")
    const parsed = parseBody(channelUpdateSchema, body, "频道更新参数无效。")
    const updated = await this.prisma.channel.update({
      where: { id: channelId },
      data: {
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.description !== undefined ? { description: parsed.description } : {}),
      },
      include: { _count: { select: { tokens: { where: { revokedAt: null } } } } },
    })
    return this.toChannelSummary(updated, updated._count.tokens)
  }

  async deleteChannel(actor: ChannelActor, channelId: string): Promise<{ readonly deleted: true }> {
    await this.requireOwnedChannel(actor, channelId, "manage")
    const result = await this.prisma.channel.deleteMany({ where: { id: channelId } })
    if (result.count === 0) throw new OpenApiHttpError(404, "CHANNEL_NOT_FOUND", "频道不存在。")
    this.hub.disconnectByChannel(channelId, CHANNEL_WS_CLOSE_CODES.REVOKED, "Channel deleted")
    return { deleted: true }
  }

  async listTokens(actor: ChannelActor, channelId: string): Promise<{ readonly data: ChannelTokenDto[] }> {
    await this.requireOwnedChannel(actor, channelId, "manage")
    const rows = await this.prisma.channelToken.findMany({
      where: { channelId, revokedAt: null },
      orderBy: { createdAt: "desc" },
    })
    return { data: rows.map(toChannelTokenDto) }
  }

  async createToken(actor: ChannelActor, channelId: string, body: unknown): Promise<{ readonly token: ChannelTokenDto; readonly secret: string }> {
    await this.requireOwnedChannel(actor, channelId, "manage")
    const parsed = parseBody(channelTokenCreateSchema, body, "频道凭证参数无效。")
    const limits = this.hub.getLimits()
    const secret = createChannelTokenSecret()

    const created = await this.prisma.$transaction(async (tx) => {
      const activeCount = await tx.channelToken.count({ where: { channelId, revokedAt: null } })
      if (activeCount >= limits.maxTokensPerChannel) {
        throw new OpenApiHttpError(422, "TOKEN_LIMIT_EXCEEDED", `单频道最多保留 ${limits.maxTokensPerChannel} 个有效凭证。`)
      }
      return tx.channelToken.create({
        data: {
          id: `cht_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
          channelId,
          name: parsed.name,
          role: parsed.role,
          tokenHash: hashChannelTokenSecret(secret),
          tokenPrefix: getChannelTokenPrefix(secret),
        },
      })
    })
    return { token: toChannelTokenDto(created), secret }
  }

  async revokeToken(actor: ChannelActor, channelId: string, tokenId: string): Promise<{ readonly revoked: true }> {
    await this.requireOwnedChannel(actor, channelId, "manage")
    const result = await this.prisma.channelToken.updateMany({
      where: { id: tokenId, channelId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    if (result.count === 0) {
      throw new OpenApiHttpError(404, "TOKEN_NOT_FOUND", "凭证不存在或已撤销。")
    }
    this.hub.disconnectByCredential("channel_token", tokenId, CHANNEL_WS_CLOSE_CODES.REVOKED, "Channel token revoked")
    return { revoked: true }
  }

  async issueDebugTicket(actor: ChannelActor, channelId: string): Promise<{ readonly ticket: string; readonly expiresAt: string }> {
    if (actor.kind !== "console") {
      throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "仅控制台登录态可签发调试票据。")
    }
    await this.requireOwnedChannel(actor, channelId, "manage")
    return this.debugTickets.issue(channelId, actor.userId)
  }

  async publishEvent(
    actor: ChannelActor,
    channelId: string,
    body: unknown,
    options: { readonly enforceHttpRateLimit?: boolean; readonly onRateLimited?: (retryAfterSec: number) => void } = {},
  ): Promise<ChannelPublishResult> {
    const channel = await this.requireRuntimeChannel(actor, channelId, "publish")
    const parsed = parseBody(channelPublishHttpSchema, body, "事件发布参数无效。")

    if (options.enforceHttpRateLimit) {
      const rate = this.hub.consumeHttpPublishRate(channelId)
      if (!rate.allowed) {
        options.onRateLimited?.(rate.retryAfterSec)
        throw new OpenApiHttpError(429, "RATE_LIMITED", "频道发布过于频繁，请稍后重试。")
      }
    }

    const sender: ChannelEventSender = {
      connectionId: null,
      clientId: parsed.senderClientId ?? (actor.kind === "console" ? "console" : null),
      clientName: parsed.senderName ?? (actor.kind === "console" ? "Console" : null),
    }
    return this.publishResolved({
      channelId,
      seqEpoch: channel.seqEpoch,
      event: parsed.event,
      payload: parsed.payload,
      retain: parsed.retain,
      echo: true,
      targetClientId: parsed.targetClientId,
      sender,
    })
  }

  async publishFromWs(input: {
    readonly channelId: string
    readonly event: string
    readonly payload: unknown
    readonly retain: boolean
    readonly echo: boolean
    readonly targetClientId?: string
    readonly sender: ChannelEventSender
  }): Promise<ChannelPublishResult> {
    return this.publishResolved({
      ...input,
      seqEpoch: BigInt(0),
    })
  }

  async getPresence(actor: ChannelActor, channelId: string): Promise<{ readonly channelId: string; readonly count: number; readonly members: ChannelPresenceMember[] }> {
    await this.requireRuntimeChannel(actor, channelId, "presence")
    const members = this.hub.getPresence(channelId)
    return { channelId, count: members.length, members }
  }

  async listRetained(actor: ChannelActor, channelId: string): Promise<{ readonly channelId: string; readonly items: ChannelRetainedItem[] }> {
    await this.requireRuntimeChannel(actor, channelId, "subscribe")
    const items = await this.loadRetainedItems(channelId)
    return { channelId, items }
  }

  async getConsoleState(actor: ChannelActor, channelId: string): Promise<{
    readonly channelId: string
    readonly latestSeq: number
    readonly presence: ChannelPresenceMember[]
    readonly retained: ChannelRetainedItem[]
  }> {
    if (actor.kind !== "console") {
      throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "仅控制台或桌面 MCP 可调用状态聚合接口。")
    }
    const channel = await this.requireOwnedChannel(actor, channelId, "manage")
    const retained = await this.loadRetainedItems(channelId)
    const latestSeq = await this.resolveSeqFloor(channelId, channel.seqEpoch)
    return {
      channelId,
      latestSeq,
      presence: this.hub.getPresence(channelId),
      retained,
    }
  }

  async clearRetained(actor: ChannelActor, channelId: string, event: string): Promise<{ readonly deleted: boolean }> {
    await this.requireRuntimeChannel(actor, channelId, "publish")
    return this.clearRetainedDirect(channelId, event)
  }

  async clearRetainedDirect(channelId: string, event: string): Promise<{ readonly deleted: boolean }> {
    const parsedEvent = parseBody(channelEventNameSchema, event, "事件名无效。")
    const result = await this.prisma.channelRetainedEvent.deleteMany({
      where: { channelId, event: parsedEvent },
    })
    return { deleted: result.count > 0 }
  }

  async loadRetainedItems(channelId: string): Promise<ChannelRetainedItem[]> {
    const rows = await this.prisma.channelRetainedEvent.findMany({
      where: { channelId },
      orderBy: { updatedAt: "desc" },
    })
    return rows.map((row) => ({
      event: row.event,
      payload: row.payload as ChannelRetainedItem["payload"],
      seq: Number(row.seq),
      senderClientId: row.senderClientId,
      senderName: row.senderName,
      updatedAt: row.updatedAt.toISOString(),
    }))
  }

  private async publishResolved(input: {
    readonly channelId: string
    readonly seqEpoch: bigint
    readonly event: string
    readonly payload: unknown
    readonly retain: boolean
    readonly echo: boolean
    readonly targetClientId?: string
    readonly sender: ChannelEventSender
  }): Promise<ChannelPublishResult> {
    if (!input.retain) {
      const seqFloor = await this.resolveSeqFloor(input.channelId, input.seqEpoch)
      const published = this.hub.publishEvent({
        channelId: input.channelId,
        event: input.event,
        payload: input.payload,
        retain: false,
        echo: input.echo,
        targetClientId: input.targetClientId,
        sender: input.sender,
        seqFloor,
      })
      return {
        seq: published.seq,
        deliveredCount: published.deliveredCount,
        retained: false,
        sentAt: published.sentAt,
      }
    }

    // Serialize retain writes per channel and persist BEFORE live fan-out so DB errors
    // or the 20-key cap never emit phantom retain broadcasts, and newer seqs never lose to older ones.
    return this.withChannelRetainLock(input.channelId, async () => {
      const seqFloor = await this.resolveSeqFloor(input.channelId, input.seqEpoch)
      const nextSeq = this.hub.allocateNextSeq(input.channelId, seqFloor)
      await this.persistRetainedEvent({
        channelId: input.channelId,
        event: input.event,
        payload: input.payload,
        seq: nextSeq,
        sender: input.sender,
      })
      const published = this.hub.publishEvent({
        channelId: input.channelId,
        event: input.event,
        payload: input.payload,
        retain: true,
        echo: input.echo,
        targetClientId: input.targetClientId,
        sender: input.sender,
        preallocatedSeq: nextSeq,
      })
      return {
        seq: published.seq,
        deliveredCount: published.deliveredCount,
        retained: true,
        sentAt: published.sentAt,
      }
    })
  }

  private async withChannelRetainLock<T>(channelId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.retainLocks.get(channelId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.catch(() => undefined).then(() => current)
    this.retainLocks.set(channelId, tail)
    await previous.catch(() => undefined)
    try {
      return await work()
    } finally {
      release()
      if (this.retainLocks.get(channelId) === tail) {
        this.retainLocks.delete(channelId)
      }
    }
  }

  private async persistRetainedEvent(input: {
    readonly channelId: string
    readonly event: string
    readonly payload: unknown
    readonly seq: number
    readonly sender: ChannelEventSender
  }): Promise<void> {
    const max = this.hub.getLimits().maxRetainedPerChannel
    const prismaPayload = input.payload === null
      ? Prisma.JsonNull
      : (input.payload as Prisma.InputJsonValue)
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.channelRetainedEvent.findUnique({
        where: { channelId_event: { channelId: input.channelId, event: input.event } },
        select: { event: true },
      })
      if (!existing) {
        const count = await tx.channelRetainedEvent.count({ where: { channelId: input.channelId } })
        if (count >= max) {
          throw new OpenApiHttpError(422, "RETAIN_LIMIT_EXCEEDED", `单频道最多保留 ${max} 个不同事件名的状态快照。`)
        }
      }
      await tx.channelRetainedEvent.upsert({
        where: { channelId_event: { channelId: input.channelId, event: input.event } },
        create: {
          channelId: input.channelId,
          event: input.event,
          payload: prismaPayload,
          seq: BigInt(input.seq),
          senderClientId: input.sender.clientId,
          senderName: input.sender.clientName,
        },
        update: {
          payload: prismaPayload,
          seq: BigInt(input.seq),
          senderClientId: input.sender.clientId,
          senderName: input.sender.clientName,
        },
      })
    })
  }

  private async resolveSeqFloor(channelId: string, seqEpoch: bigint): Promise<number> {
    const current = this.hub.getLatestSeq(channelId)
    if (current > 0) return current
    const agg = await this.prisma.channelRetainedEvent.aggregate({
      where: { channelId },
      _max: { seq: true },
    })
    const retainedMax = agg._max.seq ? Number(agg._max.seq) : 0
    return Math.max(Number(seqEpoch), retainedMax)
  }

  private async requireOwnedChannel(actor: ChannelActor, channelId: string, mode: "manage" | "read_meta") {
    if (actor.kind === "channel_token") {
      throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "频道专属凭证不能执行管理操作。")
    }
    if (actor.kind === "api_key") {
      if (mode === "manage" && !actor.scopes.includes(CHANNELS_MANAGE_SCOPE)) {
        throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "API 密钥缺少 channels.manage 权限。")
      }
      if (mode === "read_meta" && !actor.scopes.some((s) =>
        s === CHANNELS_MANAGE_SCOPE || s === CHANNELS_PUBLISH_SCOPE || s === CHANNELS_SUBSCRIBE_SCOPE,
      )) {
        throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "API 密钥缺少频道权限。")
      }
      if (!apiKeyCanAccessChannel(actor.channelAccessMode, actor.channelIds, channelId)) {
        throw new OpenApiHttpError(403, "CHANNEL_ACCESS_DENIED", "API 密钥未授权访问此频道。")
      }
    }

    const channel = await this.prisma.channel.findFirst({
      where: { id: channelId, ownerId: actor.userId },
      include: { _count: { select: { tokens: { where: { revokedAt: null } } } } },
    })
    if (!channel) throw new OpenApiHttpError(404, "CHANNEL_NOT_FOUND", "频道不存在。")
    return channel
  }

  private async requireRuntimeChannel(actor: ChannelActor, channelId: string, action: "publish" | "subscribe" | "presence") {
    if (actor.kind === "console") {
      return this.requireOwnedChannel(actor, channelId, "manage")
    }

    if (actor.kind === "channel_token") {
      if (actor.channelId !== channelId) {
        throw new OpenApiHttpError(403, "CHANNEL_ACCESS_DENIED", "凭证不属于此频道。")
      }
      if (action === "publish" && actor.role === "subscribe") {
        throw new OpenApiHttpError(403, "FORBIDDEN_ROLE", "当前凭证仅允许订阅，不能发布事件或清除状态。")
      }
      if (action === "subscribe" && actor.role === "publish") {
        throw new OpenApiHttpError(403, "FORBIDDEN_ROLE", "当前凭证仅允许发布，不能读取订阅状态。")
      }
      const channel = await this.prisma.channel.findUnique({ where: { id: channelId } })
      if (!channel) throw new OpenApiHttpError(404, "CHANNEL_NOT_FOUND", "频道不存在。")
      return channel
    }

    // api_key
    if (!apiKeyCanAccessChannel(actor.channelAccessMode, actor.channelIds, channelId)) {
      throw new OpenApiHttpError(403, "CHANNEL_ACCESS_DENIED", "API 密钥未授权访问此频道。")
    }
    if (action === "publish" && !actor.scopes.includes(CHANNELS_PUBLISH_SCOPE)) {
      throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "API 密钥缺少 channels.publish 权限。")
    }
    if (action === "subscribe" && !actor.scopes.includes(CHANNELS_SUBSCRIBE_SCOPE)) {
      throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "API 密钥缺少 channels.subscribe 权限。")
    }
    if (action === "presence" && !actor.scopes.includes(CHANNELS_PUBLISH_SCOPE) && !actor.scopes.includes(CHANNELS_SUBSCRIBE_SCOPE)) {
      throw new OpenApiHttpError(403, "INSUFFICIENT_SCOPE", "API 密钥缺少频道运行态权限。")
    }

    const channel = await this.prisma.channel.findFirst({ where: { id: channelId, ownerId: actor.userId } })
    if (!channel) throw new OpenApiHttpError(404, "CHANNEL_NOT_FOUND", "频道不存在。")
    return channel
  }

  private handleApiKeyChange(event: ApiKeyChangeEvent): void {
    if (event.kind === "revoked") {
      this.hub.disconnectByCredential("api_key", event.apiKeyId, CHANNEL_WS_CLOSE_CODES.REVOKED, "API key revoked")
      return
    }
    if (event.kind === "user_disabled") {
      this.hub.disconnectByOwner(event.userId, CHANNEL_WS_CLOSE_CODES.REVOKED, "Account disabled")
      return
    }

    const nextRole = resolveApiKeyWsRole(event.scopes)
    // 1. Connections that lost channel access or lost all WS scopes -> 4003 (stop reconnecting)
    this.hub.disconnectByCredential(
      "api_key",
      event.apiKeyId,
      CHANNEL_WS_CLOSE_CODES.REVOKED,
      "API key channel access revoked",
      (conn) => !nextRole || !apiKeyCanAccessChannel(event.channelAccessMode, event.channelIds, conn.channelId),
    )

    // 2. Remaining connections whose role changed (e.g., pubsub -> subscribe) -> 4004 (reconnect to renegotiate role)
    if (nextRole) {
      this.hub.disconnectByCredential(
        "api_key",
        event.apiKeyId,
        CHANNEL_WS_CLOSE_CODES.ROLE_CHANGED,
        "API key channel role changed",
        (conn) => conn.role !== nextRole,
      )
    }
  }

  private touchChannelTokenLastUsed(tokenId: string): void {
    const now = Date.now()
    const prev = this.tokenLastUsedCache.get(tokenId) ?? 0
    if (now - prev < TOKEN_LAST_USED_THROTTLE_MS) return
    if (this.tokenLastUsedCache.size >= TOKEN_LAST_USED_CACHE_MAX) {
      const oldestKey = this.tokenLastUsedCache.keys().next().value
      if (oldestKey) this.tokenLastUsedCache.delete(oldestKey)
    }
    this.tokenLastUsedCache.set(tokenId, now)
    void this.prisma.channelToken.updateMany({
      where: { id: tokenId, revokedAt: null },
      data: { lastUsedAt: new Date(now) },
    }).catch((error: unknown) => {
      this.logger?.warn({
        tokenId,
        errorName: error instanceof Error ? error.name : typeof error,
      }, "Channel token last-used update failed")
    })
  }

  private toChannelSummary(
    row: { readonly id: string; readonly name: string; readonly description: string; readonly createdAt: Date; readonly updatedAt: Date },
    tokenCount: number,
  ): ChannelSummaryDto {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      onlineCount: this.hub.getOnlineCount(row.id),
      tokenCount,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }
}

function toChannelTokenDto(row: {
  readonly id: string
  readonly channelId: string
  readonly name: string
  readonly role: string
  readonly tokenPrefix: string
  readonly lastUsedAt: Date | null
  readonly createdAt: Date
}): ChannelTokenDto {
  return {
    id: row.id,
    channelId: row.channelId,
    name: row.name,
    role: row.role as ChannelRole,
    prefix: row.tokenPrefix,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}
