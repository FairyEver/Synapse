import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleInit, Optional, PayloadTooLargeException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import {
  LIVE_MESSAGE_TYPES,
  WEBHOOK_DELIVERY_CLIENT_RECEIPT_STATUS,
  WEBHOOK_DELIVERY_STATUS,
  createLiveEnvelope,
  type DashboardWebhookDto,
  type DashboardWebhookSecretResult,
  type WebhookDeliveryHistoryDto,
  type LiveDesktopServerMessage,
  type WebhookDeliveryDto,
  type WebhookDeliveryReceivedPayload,
  type WebhookDeliveryStatus,
  type WebhookDeliveryClientReceiptDto,
} from "@synapse/shared"
import { AuditLogService } from "../common/audit-log.service"
import { toPrismaArgs, type PaginatedResponse, type PaginationQuery } from "../common/pagination"
import { LiveDesktopGateway } from "../live/live-desktop.gateway"
import { PrismaService } from "../prisma/prisma.service"
import { sanitizeWebhookHeaders, sanitizeWebhookQuery, summarizeWebhookBody } from "./webhook-sanitize"
import {
  buildWebhookUrl,
  createWebhookPublicId,
  createWebhookSecret,
  hashWebhookSecret,
  maskWebhookUrl,
  verifyWebhookSecret,
} from "./webhook-token"

type WebhookTokenFactory = {
  readonly createPublicId?: () => string
  readonly createSecret?: () => string
}

export const webhookTokenFactoryToken = Symbol("webhookTokenFactory")

type DeliverySummaryRecord = {
  readonly receivedAt: Date
  readonly status: string
}

type WebhookRecord = {
  readonly id: string
  readonly publicId: string
  readonly secret?: string | null
  readonly name: string
  readonly enabled: boolean
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly deliveries?: readonly DeliverySummaryRecord[]
}

type PublicWebhookRecord = Pick<WebhookRecord, "id" | "publicId" | "name" | "enabled"> & {
  readonly userId: string
  readonly secretHash: string
  readonly deletedAt: Date | null
}

type DeliveryReceiptRecord = {
  readonly id: string
  readonly clientInstanceId: string
  readonly deviceName: string
  readonly platform: string
  readonly appVersion: string
  readonly sentAt: Date
  readonly acknowledgedAt: Date | null
  readonly status: string
}

type DeliveryRecord = {
  readonly id: string
  readonly webhookId: string
  readonly userId?: string
  readonly webhookPublicId?: string
  readonly webhookName?: string
  readonly method: string
  readonly path: string
  readonly query: unknown
  readonly headers: unknown
  readonly bodyKind: string
  readonly bodySize: number
  readonly bodyPreview: string | null
  readonly receivedAt: Date
  readonly onlineClientCount: number
  readonly sentClientCount: number
  readonly failedClientCount: number
  readonly receipts?: readonly DeliveryReceiptRecord[]
  readonly status: string
  readonly error: string | null
}

type WebhookDeliveryHistoryFilters = {
  readonly webhookId?: string
  readonly status?: string
  readonly from?: string
  readonly to?: string
  readonly userId?: string
  readonly user?: string
}

type WebhookDeliveryHistoryOptions = {
  readonly pagination: PaginationQuery
  readonly filters?: WebhookDeliveryHistoryFilters
}

type WebhookListOptions = {
  readonly pagination: PaginationQuery
  readonly publicAppUrl?: string
}

const webhookWithLatestDelivery = {
  deliveries: {
    orderBy: { receivedAt: "desc" as const },
    take: 1,
    select: {
      receivedAt: true,
      status: true,
    },
  },
}

const webhookStatusValues = new Set<string>(Object.values(WEBHOOK_DELIVERY_STATUS))
const maxWebhookBodyBytes = 256 * 1024
const supportedWebhookMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"])

@Injectable()
export class WebhookService implements OnModuleInit {
  private readonly logger = new Logger(WebhookService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(webhookTokenFactoryToken) private readonly tokens: WebhookTokenFactory = {},
    @Optional() private readonly auditLog?: AuditLogService,
    @Optional() private readonly liveDesktopGateway?: LiveDesktopGateway,
  ) {}

  onModuleInit(): void {
    this.liveDesktopGateway?.setWebhookDeliveryAckHandler({
      recordDeliveryAck: (input) => this.recordDeliveryAck(input),
    })
  }

  async listForUser(userId: string, options: WebhookListOptions): Promise<PaginatedResponse<DashboardWebhookDto>> {
    const where = { userId, deletedAt: null }
    const [webhooks, total] = await this.prisma.$transaction([
      this.prisma.userWebhook.findMany({
        where,
        ...toPrismaArgs(options.pagination),
        include: webhookWithLatestDelivery,
      }),
      this.prisma.userWebhook.count({ where }),
    ])
    return {
      data: webhooks.map((webhook) => this.toDashboardWebhookDto(webhook, options.publicAppUrl ?? "")),
      total,
      page: options.pagination.page,
      pageSize: options.pagination.pageSize,
    }
  }

  async getForUser(userId: string, id: string, publicAppUrl = ""): Promise<DashboardWebhookDto> {
    const webhook = await this.prisma.userWebhook.findFirst({
      where: { id, userId, deletedAt: null },
      include: webhookWithLatestDelivery,
    })
    if (!webhook) throw new NotFoundException("Webhook not found")
    return this.toDashboardWebhookDto(webhook, publicAppUrl)
  }

  async createForUser(
    userId: string,
    input: { readonly name: string },
    publicAppUrl: string,
    ipAddress = "system",
  ): Promise<DashboardWebhookSecretResult> {
    const name = normalizeWebhookName(input.name)
    const publicId = this.tokens.createPublicId?.() ?? createWebhookPublicId()
    const secret = this.tokens.createSecret?.() ?? createWebhookSecret()
    const actorEmail = await this.getAuditActorEmail(userId)
    const webhook = await this.prisma.$transaction(async (tx) => {
      const webhook = await tx.userWebhook.create({
        data: {
          userId,
          publicId,
          secretHash: hashWebhookSecret(secret),
          secret,
          name,
        },
        include: webhookWithLatestDelivery,
      })
      await this.createWebhookAudit(tx, {
        actorEmail,
        action: "webhook.create",
        webhook,
        detail: { publicId: webhook.publicId, name: webhook.name, enabled: webhook.enabled },
        ipAddress,
      })
      return webhook
    })
    return {
      webhook: this.toDashboardWebhookDto(webhook, publicAppUrl),
      url: buildWebhookUrl(publicAppUrl, publicId, secret),
    }
  }

  async updateForUser(
    userId: string,
    id: string,
    input: { readonly name?: string; readonly enabled?: boolean },
    publicAppUrl = "",
    ipAddress = "system",
  ): Promise<DashboardWebhookDto> {
    const changedFields = readChangedFields(input)
    if (changedFields.length === 0) {
      throw new BadRequestException("Webhook update must include at least one field.")
    }
    const data: { name?: string; enabled?: boolean } = {}
    if (input.name !== undefined) data.name = normalizeWebhookName(input.name)
    if (input.enabled !== undefined) data.enabled = input.enabled

    const actorEmail = await this.getAuditActorEmail(userId)
    const webhook = await this.prisma.$transaction(async (tx) => {
      const result = await tx.userWebhook.updateMany({
        where: { id, userId, deletedAt: null },
        data,
      })
      if (result.count === 0) throw new NotFoundException("Webhook not found")
      const updated = await tx.userWebhook.findFirst({
        where: { id, userId, deletedAt: null },
        include: webhookWithLatestDelivery,
      })
      if (!updated) throw new NotFoundException("Webhook not found")
      await this.createWebhookAudit(tx, {
        actorEmail,
        action: "webhook.update",
        webhook: updated,
        detail: {
          publicId: updated.publicId,
          name: updated.name,
          enabled: updated.enabled,
          changedFields,
        },
        ipAddress,
      })
      return updated
    })
    return this.toDashboardWebhookDto(webhook, publicAppUrl)
  }

  async deleteForUser(userId: string, id: string, ipAddress = "system"): Promise<{ readonly ok: true }> {
    const actorEmail = await this.getAuditActorEmail(userId)
    const deletedAt = new Date()
    await this.prisma.$transaction(async (tx) => {
      const webhook = await tx.userWebhook.findFirst({
        where: { id, userId, deletedAt: null },
        select: { id: true, publicId: true, name: true, enabled: true },
      })
      if (!webhook) throw new NotFoundException("Webhook not found")
      const result = await tx.userWebhook.updateMany({
        where: { id, userId, deletedAt: null },
        data: { deletedAt, enabled: false, secret: null },
      })
      if (result.count === 0) throw new NotFoundException("Webhook not found")
      await this.createWebhookAudit(tx, {
        actorEmail,
        action: "webhook.delete",
        webhook,
        detail: { publicId: webhook.publicId, name: webhook.name, enabled: webhook.enabled },
        ipAddress,
      })
    })
    return { ok: true }
  }

  async resetSecret(userId: string, id: string, publicAppUrl: string, ipAddress = "system"): Promise<DashboardWebhookSecretResult> {
    const secret = this.tokens.createSecret?.() ?? createWebhookSecret()
    const actorEmail = await this.getAuditActorEmail(userId)
    const webhook = await this.prisma.$transaction(async (tx) => {
      const result = await tx.userWebhook.updateMany({
        where: { id, userId, deletedAt: null },
        data: { secretHash: hashWebhookSecret(secret), secret },
      })
      if (result.count === 0) throw new NotFoundException("Webhook not found")
      const updated = await tx.userWebhook.findFirst({
        where: { id, userId, deletedAt: null },
        include: webhookWithLatestDelivery,
      })
      if (!updated) throw new NotFoundException("Webhook not found")
      await this.createWebhookAudit(tx, {
        actorEmail,
        action: "webhook.reset_secret",
        webhook: updated,
        detail: { publicId: updated.publicId, name: updated.name, enabled: updated.enabled },
        ipAddress,
      })
      return updated
    })
    return {
      webhook: this.toDashboardWebhookDto(webhook, publicAppUrl),
      url: buildWebhookUrl(publicAppUrl, webhook.publicId, secret),
    }
  }

  async listDeliveriesForUser(userId: string, webhookId: string): Promise<WebhookDeliveryDto[]> {
    await this.requireOwnedWebhook(userId, webhookId)
    const deliveries = await this.prisma.webhookDelivery.findMany({
      where: { webhookId, userId },
      include: { receipts: { orderBy: { sentAt: "asc" } } },
      orderBy: { receivedAt: "desc" },
      take: 100,
    })
    return deliveries.map(toWebhookDeliveryDto)
  }

  async listDeliveryHistoryForUser(
    userId: string,
    options: WebhookDeliveryHistoryOptions,
  ): Promise<PaginatedResponse<WebhookDeliveryHistoryDto>> {
    const where = buildDeliveryHistoryWhere(userId, options.filters)
    const [deliveries, total] = await this.prisma.$transaction([
      this.prisma.webhookDelivery.findMany({
        where,
        ...toPrismaArgs(options.pagination),
        include: deliveryHistoryInclude(),
      }),
      this.prisma.webhookDelivery.count({ where }),
    ])
    return {
      data: deliveries.map((delivery) => toWebhookDeliveryHistoryDto(delivery, new Map())),
      total,
      page: options.pagination.page,
      pageSize: options.pagination.pageSize,
    }
  }

  async listDeliveryHistoryForAdmin(
    options: WebhookDeliveryHistoryOptions,
  ): Promise<PaginatedResponse<WebhookDeliveryHistoryDto>> {
    const where = buildDeliveryHistoryWhere(null, options.filters)
    const [deliveries, total] = await this.prisma.$transaction([
      this.prisma.webhookDelivery.findMany({
        where,
        ...toPrismaArgs(options.pagination),
        include: deliveryHistoryInclude(),
      }),
      this.prisma.webhookDelivery.count({ where }),
    ])
    const users = await this.loadHistoryUsers(deliveries)
    return {
      data: deliveries.map((delivery) => toWebhookDeliveryHistoryDto(delivery, users)),
      total,
      page: options.pagination.page,
      pageSize: options.pagination.pageSize,
    }
  }

  private async loadHistoryUsers(
    deliveries: ReadonlyArray<{ readonly userId?: string | null }>,
  ): Promise<Map<string, { readonly id: string; readonly email: string; readonly displayName: string | null }>> {
    const userIds = [...new Set(deliveries.map((delivery) => delivery.userId).filter((id): id is string => Boolean(id)))]
    if (userIds.length === 0) return new Map()
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, displayName: true },
    })
    return new Map(users.map((user) => [user.id, user]))
  }

  async recordDeliveryAck(input: {
    readonly userId: string
    readonly deliveryId: string
    readonly clientInstanceId: string
    readonly deviceName: string
    readonly platform: string
    readonly appVersion: string
    readonly acknowledgedAt: Date
  }): Promise<void> {
    const result = await this.prisma.webhookDeliveryReceipt.updateMany({
      where: {
        deliveryId: input.deliveryId,
        clientInstanceId: input.clientInstanceId,
        status: WEBHOOK_DELIVERY_CLIENT_RECEIPT_STATUS.sent,
        delivery: { userId: input.userId },
      },
      data: {
        acknowledgedAt: input.acknowledgedAt,
        status: WEBHOOK_DELIVERY_CLIENT_RECEIPT_STATUS.acknowledged,
      },
    })
    if (result.count === 0) {
      return
    }
    await this.prisma.webhookDelivery.updateMany({
      where: { id: input.deliveryId, userId: input.userId },
      data: {
        status: WEBHOOK_DELIVERY_STATUS.delivered,
        error: null,
      },
    })
  }

  async receivePublicWebhook(input: {
    readonly publicId: string
    readonly secret: string
    readonly method: string
    readonly path: string
    readonly query: Record<string, string | readonly string[]>
    readonly headers: Record<string, unknown>
    readonly body: Buffer
    readonly contentType?: string | readonly string[]
    readonly remoteAddress?: string
    readonly publicAppUrl: string
  }): Promise<{ readonly response: { readonly ok: true; readonly deliveryId: string; readonly acceptedAt: string } }> {
    const method = normalizeWebhookMethod(input.method)
    if (!supportedWebhookMethods.has(method)) {
      throw new NotFoundException("Webhook not found")
    }

    if (input.body.byteLength > maxWebhookBodyBytes) {
      throw new PayloadTooLargeException("Webhook body is too large")
    }

    const webhook = await this.findEnabledPublicWebhook(input.publicId, input.secret)
    const contentType = firstHeader(input.contentType)
    const sanitizedHeaders = sanitizeWebhookHeaders(input.headers)
    const sanitizedQuery = sanitizeWebhookQuery(input.query)
    const bodySummary = summarizeWebhookBody(input.body, contentType)
    const receivedAt = new Date()
    const receivedAtIso = receivedAt.toISOString()
    const maskedPath = maskWebhookUrl(input.path)
    const maskedUrl = maskWebhookUrl(buildWebhookUrl(input.publicAppUrl, webhook.publicId, input.secret))

    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        webhookId: webhook.id,
        userId: webhook.userId,
        webhookPublicId: webhook.publicId,
        webhookName: webhook.name,
        method,
        path: maskedPath,
        query: sanitizedQuery,
        headers: sanitizedHeaders,
        bodyKind: bodySummary.bodyKind,
        bodySize: bodySummary.bodySize,
        bodyPreview: bodySummary.bodyPreview,
        receivedAt,
        onlineClientCount: 0,
        sentClientCount: 0,
        failedClientCount: 0,
        status: WEBHOOK_DELIVERY_STATUS.received,
        error: null,
      },
    })

    const message = createLiveEnvelope(LIVE_MESSAGE_TYPES.webhookDeliveryReceived, {
      deliveryId: delivery.id,
      webhook: {
        id: webhook.id,
        publicId: webhook.publicId,
        name: webhook.name,
      },
      request: {
        method,
        url: maskedUrl,
        query: sanitizedQuery,
        headers: sanitizedHeaders,
        body: bodySummary.body,
        ...(bodySummary.bodyText !== undefined ? { bodyText: bodySummary.bodyText } : {}),
        ...(contentType ? { contentType } : {}),
        receivedAt: receivedAtIso,
        ...(input.remoteAddress ? { remoteAddress: input.remoteAddress } : {}),
      },
    } satisfies WebhookDeliveryReceivedPayload, {
      id: delivery.id,
      sentAt: receivedAtIso,
    }) satisfies LiveDesktopServerMessage

    const broadcastResult = this.broadcastDelivery(webhook.userId, delivery.id, webhook.publicId, message)
    const status = resolveBroadcastDeliveryStatus(broadcastResult)

    await this.createDeliveryReceipts(delivery.id, broadcastResult.clientResults)
    await this.updateDeliveryBroadcastStatus({
      deliveryId: delivery.id,
      webhookId: webhook.id,
      webhookPublicId: webhook.publicId,
      broadcastResult,
      status,
    })

    return {
      response: {
        ok: true,
        deliveryId: delivery.id,
        acceptedAt: receivedAtIso,
      },
    }
  }

  private broadcastDelivery(
    userId: string,
    deliveryId: string,
    webhookPublicId: string,
    message: LiveDesktopServerMessage,
  ): {
    readonly onlineClientCount: number
    readonly sentClientCount: number
    readonly failedClientCount: number
    readonly clientResults: readonly {
      readonly clientInstanceId: string
      readonly deviceName: string
      readonly platform: string
      readonly appVersion: string
      readonly sentAt: string
      readonly status: "sent" | "send_failed"
    }[]
    readonly error?: string
  } {
    try {
      return this.liveDesktopGateway?.broadcastToUser(userId, message) ?? {
        onlineClientCount: 0,
        sentClientCount: 0,
        failedClientCount: 0,
        clientResults: [],
      }
    } catch (error) {
      this.logger.warn({
        deliveryId,
        errorName: error instanceof Error ? error.name : typeof error,
        webhookPublicId,
      }, "Webhook delivery broadcast failed")
      return {
        onlineClientCount: 0,
        sentClientCount: 0,
        failedClientCount: 0,
        clientResults: [],
        error: "broadcast_failed",
      }
    }
  }

  private async createDeliveryReceipts(
    deliveryId: string,
    clientResults: readonly {
      readonly clientInstanceId: string
      readonly deviceName: string
      readonly platform: string
      readonly appVersion: string
      readonly sentAt: string
      readonly status: "sent" | "send_failed"
    }[] | undefined,
  ): Promise<void> {
    if (!clientResults?.length) return
    try {
      await this.prisma.webhookDeliveryReceipt.createMany({
        data: clientResults.map((client) => ({
          deliveryId,
          clientInstanceId: client.clientInstanceId,
          deviceName: client.deviceName,
          platform: client.platform,
          appVersion: client.appVersion,
          sentAt: new Date(client.sentAt),
          acknowledgedAt: null,
          status: client.status,
        })),
        skipDuplicates: true,
      })
    } catch (error) {
      this.logger.warn({
        deliveryId,
        errorName: error instanceof Error ? error.name : typeof error,
      }, "Webhook delivery receipt insert failed")
    }
  }

  private async updateDeliveryBroadcastStatus(input: {
    readonly deliveryId: string
    readonly webhookId: string
    readonly webhookPublicId: string
    readonly broadcastResult: {
      readonly onlineClientCount: number
      readonly sentClientCount: number
      readonly failedClientCount: number
      readonly error?: string
    }
    readonly status: WebhookDeliveryStatus
  }): Promise<void> {
    const deliveryStatusData = {
      onlineClientCount: input.broadcastResult.onlineClientCount,
      sentClientCount: input.broadcastResult.sentClientCount,
      failedClientCount: input.broadcastResult.failedClientCount,
      status: input.status,
      error: input.status === WEBHOOK_DELIVERY_STATUS.broadcastFailed
        ? input.broadcastResult.error ?? "broadcast_failed"
        : null,
    }

    try {
      await this.prisma.webhookDelivery.update({
        where: { id: input.deliveryId },
        data: deliveryStatusData,
      })
      await this.promoteDeliveryIfAcknowledged(input)
      return
    } catch (error) {
      this.logger.warn({
        deliveryId: input.deliveryId,
        errorName: error instanceof Error ? error.name : typeof error,
        webhookId: input.webhookId,
        webhookPublicId: input.webhookPublicId,
      }, "Webhook delivery broadcast status update failed")
    }

    try {
      await this.prisma.webhookDelivery.update({
        where: { id: input.deliveryId },
        data: deliveryStatusData,
      })
      await this.promoteDeliveryIfAcknowledged(input)
    } catch (error) {
      this.logger.warn({
        deliveryId: input.deliveryId,
        errorName: error instanceof Error ? error.name : typeof error,
        webhookId: input.webhookId,
        webhookPublicId: input.webhookPublicId,
      }, "Webhook delivery failed-status fallback update failed")
    }
  }

  private async promoteDeliveryIfAcknowledged(input: {
    readonly deliveryId: string
    readonly webhookId: string
    readonly webhookPublicId: string
    readonly status: WebhookDeliveryStatus
  }): Promise<void> {
    if (input.status !== WEBHOOK_DELIVERY_STATUS.sent) return
    try {
      const acknowledgedReceipt = await this.prisma.webhookDeliveryReceipt.findFirst({
        where: {
          deliveryId: input.deliveryId,
          status: WEBHOOK_DELIVERY_CLIENT_RECEIPT_STATUS.acknowledged,
        },
        select: { id: true },
      })
      if (!acknowledgedReceipt) return
      await this.prisma.webhookDelivery.update({
        where: { id: input.deliveryId },
        data: {
          status: WEBHOOK_DELIVERY_STATUS.delivered,
          error: null,
        },
      })
    } catch (error) {
      this.logger.warn({
        deliveryId: input.deliveryId,
        errorName: error instanceof Error ? error.name : typeof error,
        webhookId: input.webhookId,
        webhookPublicId: input.webhookPublicId,
      }, "Webhook delivery acknowledged-status promotion failed")
    }
  }

  private async findEnabledPublicWebhook(publicId: string, secret: string): Promise<PublicWebhookRecord> {
    const webhook = await this.prisma.userWebhook.findFirst({
      where: { publicId, deletedAt: null },
      select: {
        id: true,
        userId: true,
        publicId: true,
        name: true,
        enabled: true,
        deletedAt: true,
        secretHash: true,
      },
    })
    if (!webhook || webhook.deletedAt || !webhook.enabled || !verifyWebhookSecret(secret, webhook.secretHash)) {
      throw new NotFoundException("Webhook not found")
    }
    return webhook
  }

  private async requireOwnedWebhook(userId: string, id: string): Promise<void> {
    const webhook = await this.prisma.userWebhook.findFirst({
      where: { id, userId, deletedAt: null },
      select: { id: true },
    })
    if (!webhook) throw new NotFoundException("Webhook not found")
  }

  private toDashboardWebhookDto(webhook: WebhookRecord, publicAppUrl: string): DashboardWebhookDto {
    const latestDelivery = webhook.deliveries?.[0]
    const lastDeliveryStatus = normalizeWebhookDeliveryStatus(latestDelivery?.status)
    const url = webhook.secret ? buildWebhookUrl(publicAppUrl, webhook.publicId, webhook.secret) : null
    const dto: DashboardWebhookDto = {
      id: webhook.id,
      publicId: webhook.publicId,
      name: webhook.name,
      enabled: webhook.enabled,
      maskedUrl: maskWebhookUrl(buildWebhookUrl(publicAppUrl, webhook.publicId, "secret")),
      url,
      createdAt: webhook.createdAt.toISOString(),
      updatedAt: webhook.updatedAt.toISOString(),
    }
    if (latestDelivery) {
      return {
        ...dto,
        lastDeliveryAt: latestDelivery.receivedAt.toISOString(),
        ...(lastDeliveryStatus ? { lastDeliveryStatus } : {}),
      }
    }
    return dto
  }

  private async getAuditActorEmail(userId: string): Promise<string> {
    if (!this.auditLog) return userId
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      })
      return user?.email ?? userId
    } catch {
      return userId
    }
  }

  private async createWebhookAudit(tx: Prisma.TransactionClient, input: {
    readonly actorEmail: string
    readonly action: "webhook.create" | "webhook.update" | "webhook.delete" | "webhook.reset_secret"
    readonly webhook: Pick<WebhookRecord, "id" | "publicId" | "name" | "enabled">
    readonly detail: Prisma.InputJsonObject
    readonly ipAddress: string
  }): Promise<void> {
    await tx.auditLog.create({
      data: {
        adminEmail: input.actorEmail,
        action: input.action,
        targetType: "webhook",
        targetId: input.webhook.id,
        detail: input.detail,
        ipAddress: input.ipAddress,
      },
    })
  }
}

function normalizeWebhookName(name: string): string {
  const value = name.trim()
  if (value.length < 1 || value.length > 80) {
    throw new BadRequestException("Webhook name must be 1 to 80 characters.")
  }
  return value
}

function parseDeliveryHistoryDate(value: string, boundary: "start" | "end" = "start"): Date {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new BadRequestException("日期参数无效。")
  if (boundary === "end" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setUTCHours(23, 59, 59, 999)
  }
  return date
}

function buildDeliveryHistoryWhere(
  ownerUserId: string | null,
  filters: WebhookDeliveryHistoryFilters = {},
): Prisma.WebhookDeliveryWhereInput {
  const where: Prisma.WebhookDeliveryWhereInput = {}
  if (ownerUserId) {
    where.userId = ownerUserId
  } else if (filters.userId) {
    where.userId = filters.userId
  }
  const userSearch = ownerUserId ? "" : filters.user?.trim()
  if (userSearch) {
    where.webhook = {
      user: {
        OR: [
          { email: { contains: userSearch, mode: "insensitive" } },
          { displayName: { contains: userSearch, mode: "insensitive" } },
        ],
      },
    }
  }
  if (filters.webhookId) where.webhookId = filters.webhookId
  if (filters.status) {
    if (!webhookStatusValues.has(filters.status)) throw new BadRequestException("Webhook delivery status is invalid.")
    where.status = filters.status
  }
  if (filters.from || filters.to) {
    where.receivedAt = {
      ...(filters.from ? { gte: parseDeliveryHistoryDate(filters.from) } : {}),
      ...(filters.to ? { lte: parseDeliveryHistoryDate(filters.to, "end") } : {}),
    }
  }
  return where
}

function deliveryHistoryInclude() {
  return {
    receipts: { orderBy: { sentAt: "asc" as const } },
    webhook: {
      select: {
        id: true,
        publicId: true,
        name: true,
        deletedAt: true,
      },
    },
  }
}

function normalizeWebhookMethod(method: string): string {
  return method.toUpperCase()
}

function firstHeader(value: string | readonly string[] | undefined): string | undefined {
  if (typeof value === "string") return value
  return value?.[0]
}

function toWebhookDeliveryDto(delivery: DeliveryRecord): WebhookDeliveryDto {
  const clientReceipts = (delivery.receipts ?? []).map(toWebhookDeliveryClientReceiptDto)
  const acknowledgedClientCount = clientReceipts.filter((receipt) =>
    receipt.status === WEBHOOK_DELIVERY_CLIENT_RECEIPT_STATUS.acknowledged || Boolean(receipt.acknowledgedAt)
  ).length
  return {
    id: delivery.id,
    webhookId: delivery.webhookId,
    method: delivery.method,
    path: delivery.path,
    query: delivery.query,
    headers: delivery.headers,
    bodyKind: delivery.bodyKind,
    bodySize: delivery.bodySize,
    bodyPreview: delivery.bodyPreview ?? undefined,
    receivedAt: delivery.receivedAt.toISOString(),
    onlineClientCount: delivery.onlineClientCount,
    sentClientCount: delivery.sentClientCount,
    failedClientCount: delivery.failedClientCount,
    acknowledgedClientCount,
    clientReceipts,
    status: normalizeWebhookDeliveryStatus(delivery.status) ?? WEBHOOK_DELIVERY_STATUS.rejected,
    error: delivery.error ?? undefined,
  }
}

function toWebhookDeliveryClientReceiptDto(receipt: DeliveryReceiptRecord): WebhookDeliveryClientReceiptDto {
  return {
    id: receipt.id,
    clientInstanceId: receipt.clientInstanceId,
    deviceName: receipt.deviceName,
    platform: receipt.platform,
    appVersion: receipt.appVersion,
    sentAt: receipt.sentAt.toISOString(),
    ...(receipt.acknowledgedAt ? { acknowledgedAt: receipt.acknowledgedAt.toISOString() } : {}),
    status: normalizeWebhookDeliveryReceiptStatus(receipt.status),
  }
}

function toWebhookDeliveryHistoryDto(
  delivery: DeliveryRecord & {
    readonly webhook?: {
      readonly id: string
      readonly publicId: string
      readonly name: string
      readonly deletedAt: Date | null
    } | null
  },
  usersById: Map<string, { readonly id: string; readonly email: string; readonly displayName: string | null }>,
): WebhookDeliveryHistoryDto {
  const dto = toWebhookDeliveryDto(delivery)
  const user = delivery.userId ? usersById.get(delivery.userId) : undefined
  return {
    ...dto,
    webhook: {
      id: delivery.webhook?.id ?? delivery.webhookId,
      publicId: delivery.webhookPublicId ?? delivery.webhook?.publicId ?? "-",
      name: delivery.webhookName ?? delivery.webhook?.name ?? "已删除 Webhook",
      ...(delivery.webhook?.name ? { currentName: delivery.webhook.name } : {}),
      ...(delivery.webhook?.deletedAt ? { deletedAt: delivery.webhook.deletedAt.toISOString() } : {}),
    },
    ...(user
      ? {
          user: {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
          },
        }
      : {}),
  }
}

function readChangedFields(input: { readonly name?: string; readonly enabled?: boolean }): string[] {
  return [
    ...(input.name !== undefined ? ["name"] : []),
    ...(input.enabled !== undefined ? ["enabled"] : []),
  ]
}

function normalizeWebhookDeliveryStatus(status: string | undefined): WebhookDeliveryStatus | undefined {
  if (status === "accepted") return WEBHOOK_DELIVERY_STATUS.received
  return status && webhookStatusValues.has(status) ? status as WebhookDeliveryStatus : undefined
}

function normalizeWebhookDeliveryReceiptStatus(status: string): WebhookDeliveryClientReceiptDto["status"] {
  if (status === WEBHOOK_DELIVERY_CLIENT_RECEIPT_STATUS.acknowledged ||
    status === WEBHOOK_DELIVERY_CLIENT_RECEIPT_STATUS.sendFailed ||
    status === WEBHOOK_DELIVERY_CLIENT_RECEIPT_STATUS.sent
  ) {
    return status
  }
  return WEBHOOK_DELIVERY_CLIENT_RECEIPT_STATUS.sendFailed
}

function resolveBroadcastDeliveryStatus(input: {
  readonly onlineClientCount: number
  readonly sentClientCount: number
  readonly failedClientCount: number
  readonly error?: string
}): WebhookDeliveryStatus {
  if (input.failedClientCount > 0 || input.error) return WEBHOOK_DELIVERY_STATUS.broadcastFailed
  if (input.onlineClientCount === 0) return WEBHOOK_DELIVERY_STATUS.noOnlineClients
  if (input.sentClientCount > 0) return WEBHOOK_DELIVERY_STATUS.sent
  return WEBHOOK_DELIVERY_STATUS.received
}
