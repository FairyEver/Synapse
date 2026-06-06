import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common"
import {
  WEBHOOK_DELIVERY_STATUS,
  type DashboardWebhookDto,
  type DashboardWebhookSecretResult,
  type WebhookDeliveryDto,
  type WebhookDeliveryStatus,
} from "@synapse/shared"
import { AuditLogService } from "../common/audit-log.service"
import { PrismaService } from "../prisma/prisma.service"
import {
  buildWebhookUrl,
  createWebhookPublicId,
  createWebhookSecret,
  hashWebhookSecret,
  maskWebhookUrl,
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

@Injectable()
export class WebhookService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(webhookTokenFactoryToken) private readonly tokens: WebhookTokenFactory = {},
    @Optional() private readonly auditLog?: AuditLogService,
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
    const webhook = await this.prisma.userWebhook.create({
      data: {
        userId,
        publicId,
        secretHash: hashWebhookSecret(secret),
        name,
      },
      include: webhookWithLatestDelivery,
    })
    await this.recordWebhookAudit({
      actorUserId: userId,
      action: "webhook.create",
      webhook,
      detail: { publicId: webhook.publicId, name: webhook.name, enabled: webhook.enabled },
      ipAddress,
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
      return updated
    })
    await this.recordWebhookAudit({
      actorUserId: userId,
      action: "webhook.update",
      webhook,
      detail: {
        publicId: webhook.publicId,
        name: webhook.name,
        enabled: webhook.enabled,
        changedFields,
      },
      ipAddress,
    })
    return this.toDashboardWebhookDto(webhook, publicAppUrl)
  }

  async deleteForUser(userId: string, id: string, ipAddress = "system"): Promise<{ readonly ok: true }> {
    const webhook = await this.prisma.userWebhook.findFirst({
      where: { id, userId },
      select: { id: true, publicId: true, name: true, enabled: true },
    })
    const result = await this.prisma.userWebhook.deleteMany({ where: { id, userId } })
    if (result.count === 0 || !webhook) throw new NotFoundException("Webhook not found")
    await this.recordWebhookAudit({
      actorUserId: userId,
      action: "webhook.delete",
      webhook,
      detail: { publicId: webhook.publicId, name: webhook.name, enabled: webhook.enabled },
      ipAddress,
    })
    return { ok: true }
  }

  async resetSecret(userId: string, id: string, publicAppUrl: string, ipAddress = "system"): Promise<DashboardWebhookSecretResult> {
    const secret = this.tokens.createSecret?.() ?? createWebhookSecret()
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
      return updated
    })
    await this.recordWebhookAudit({
      actorUserId: userId,
      action: "webhook.reset_secret",
      webhook,
      detail: { publicId: webhook.publicId, name: webhook.name, enabled: webhook.enabled },
      ipAddress,
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

  private async recordWebhookAudit(input: {
    readonly actorUserId: string
    readonly action: "webhook.create" | "webhook.update" | "webhook.delete" | "webhook.reset_secret"
    readonly webhook: Pick<WebhookRecord, "id" | "publicId" | "name" | "enabled">
    readonly detail: Record<string, unknown>
    readonly ipAddress: string
  }): Promise<void> {
    const actorEmail = await this.getAuditActorEmail(input.actorUserId)
    await this.auditLog?.record({
      adminEmail: actorEmail,
      action: input.action,
      targetType: "webhook",
      targetId: input.webhook.id,
      detail: input.detail,
      ipAddress: input.ipAddress,
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
