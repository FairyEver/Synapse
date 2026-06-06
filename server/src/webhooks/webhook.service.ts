import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional, PayloadTooLargeException } from "@nestjs/common"
import { Prisma } from "@prisma/client"
import {
  LIVE_MESSAGE_TYPES,
  WEBHOOK_DELIVERY_STATUS,
  createLiveEnvelope,
  type DashboardWebhookDto,
  type DashboardWebhookSecretResult,
  type LiveDesktopServerMessage,
  type WebhookDeliveryDto,
  type WebhookDeliveryReceivedPayload,
  type WebhookDeliveryStatus,
} from "@synapse/shared"
import { AuditLogService } from "../common/audit-log.service"
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
  readonly name: string
  readonly enabled: boolean
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly deliveries?: readonly DeliverySummaryRecord[]
}

type PublicWebhookRecord = Pick<WebhookRecord, "id" | "publicId" | "name" | "enabled"> & {
  readonly userId: string
  readonly secretHash: string
}

type DeliveryRecord = {
  readonly id: string
  readonly webhookId: string
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
  readonly status: string
  readonly error: string | null
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
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name)

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(webhookTokenFactoryToken) private readonly tokens: WebhookTokenFactory = {},
    @Optional() private readonly auditLog?: AuditLogService,
    @Optional() private readonly liveDesktopGateway?: LiveDesktopGateway,
  ) {}

  async listForUser(userId: string, publicAppUrl = ""): Promise<DashboardWebhookDto[]> {
    const webhooks = await this.prisma.userWebhook.findMany({
      where: { userId },
      include: webhookWithLatestDelivery,
      orderBy: { createdAt: "desc" },
    })
    return webhooks.map((webhook) => this.toDashboardWebhookDto(webhook, publicAppUrl))
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
        where: { id, userId },
        data,
      })
      if (result.count === 0) throw new NotFoundException("Webhook not found")
      const updated = await tx.userWebhook.findFirst({
        where: { id, userId },
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
    await this.prisma.$transaction(async (tx) => {
      const webhook = await tx.userWebhook.findFirst({
        where: { id, userId },
        select: { id: true, publicId: true, name: true, enabled: true },
      })
      const result = await tx.userWebhook.deleteMany({ where: { id, userId } })
      if (result.count === 0 || !webhook) throw new NotFoundException("Webhook not found")
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
        where: { id, userId },
        data: { secretHash: hashWebhookSecret(secret) },
      })
      if (result.count === 0) throw new NotFoundException("Webhook not found")
      const updated = await tx.userWebhook.findFirst({
        where: { id, userId },
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
      orderBy: { receivedAt: "desc" },
      take: 100,
    })
    return deliveries.map(toWebhookDeliveryDto)
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
        status: WEBHOOK_DELIVERY_STATUS.accepted,
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

    const broadcastResult = this.liveDesktopGateway?.broadcastToUser(webhook.userId, message) ?? {
      onlineClientCount: 0,
      sentClientCount: 0,
      failedClientCount: 0,
    }
    const status = broadcastResult.failedClientCount > 0
      ? WEBHOOK_DELIVERY_STATUS.broadcastFailed
      : WEBHOOK_DELIVERY_STATUS.accepted

    await this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        onlineClientCount: broadcastResult.onlineClientCount,
        sentClientCount: broadcastResult.sentClientCount,
        failedClientCount: broadcastResult.failedClientCount,
        status,
        error: status === WEBHOOK_DELIVERY_STATUS.broadcastFailed ? "broadcast_failed" : null,
      },
    })
    await this.pruneOldDeliveries(webhook.id)

    return {
      response: {
        ok: true,
        deliveryId: delivery.id,
        acceptedAt: receivedAtIso,
      },
    }
  }

  private async findEnabledPublicWebhook(publicId: string, secret: string): Promise<PublicWebhookRecord> {
    const webhook = await this.prisma.userWebhook.findFirst({
      where: { publicId },
      select: {
        id: true,
        userId: true,
        publicId: true,
        name: true,
        enabled: true,
        secretHash: true,
      },
    })
    if (!webhook || !webhook.enabled || !verifyWebhookSecret(secret, webhook.secretHash)) {
      throw new NotFoundException("Webhook not found")
    }
    return webhook
  }

  private async pruneOldDeliveries(webhookId: string): Promise<void> {
    try {
      const staleDeliveries = await this.prisma.webhookDelivery.findMany({
        where: { webhookId },
        orderBy: { receivedAt: "desc" },
        skip: 100,
        select: { id: true },
      })
      const staleIds = staleDeliveries.map((delivery) => delivery.id)
      if (staleIds.length === 0) return
      await this.prisma.webhookDelivery.deleteMany({
        where: { id: { in: staleIds } },
      })
    } catch (error) {
      this.logger.warn({
        errorName: error instanceof Error ? error.name : typeof error,
        webhookId,
      }, "Webhook delivery retention cleanup failed")
    }
  }

  private async requireOwnedWebhook(userId: string, id: string): Promise<void> {
    const webhook = await this.prisma.userWebhook.findFirst({
      where: { id, userId },
      select: { id: true },
    })
    if (!webhook) throw new NotFoundException("Webhook not found")
  }

  private toDashboardWebhookDto(webhook: WebhookRecord, publicAppUrl: string): DashboardWebhookDto {
    const latestDelivery = webhook.deliveries?.[0]
    const lastDeliveryStatus = normalizeWebhookDeliveryStatus(latestDelivery?.status)
    const dto: DashboardWebhookDto = {
      id: webhook.id,
      publicId: webhook.publicId,
      name: webhook.name,
      enabled: webhook.enabled,
      maskedUrl: maskWebhookUrl(buildWebhookUrl(publicAppUrl, webhook.publicId, "secret")),
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

function normalizeWebhookMethod(method: string): string {
  return method.toUpperCase()
}

function firstHeader(value: string | readonly string[] | undefined): string | undefined {
  if (typeof value === "string") return value
  return value?.[0]
}

function toWebhookDeliveryDto(delivery: DeliveryRecord): WebhookDeliveryDto {
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
    status: normalizeWebhookDeliveryStatus(delivery.status) ?? WEBHOOK_DELIVERY_STATUS.rejected,
    error: delivery.error ?? undefined,
  }
}

function readChangedFields(input: { readonly name?: string; readonly enabled?: boolean }): string[] {
  return [
    ...(input.name !== undefined ? ["name"] : []),
    ...(input.enabled !== undefined ? ["enabled"] : []),
  ]
}

function normalizeWebhookDeliveryStatus(status: string | undefined): WebhookDeliveryStatus | undefined {
  return status && webhookStatusValues.has(status) ? status as WebhookDeliveryStatus : undefined
}
