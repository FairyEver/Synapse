import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import {
  type DashboardWebhookDto,
  type DashboardWebhookSecretResult,
  type WebhookDeliveryDto,
  type WebhookDeliveryStatus,
} from "@synapse/shared"
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

@Injectable()
export class WebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: WebhookTokenFactory = {},
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
  ): Promise<DashboardWebhookDto> {
    await this.requireOwnedWebhook(userId, id)
    const data: { name?: string; enabled?: boolean } = {}
    if (input.name !== undefined) data.name = normalizeWebhookName(input.name)
    if (input.enabled !== undefined) data.enabled = input.enabled

    const webhook = await this.prisma.userWebhook.update({
      where: { id },
      data,
      include: webhookWithLatestDelivery,
    })
    return this.toDashboardWebhookDto(webhook, publicAppUrl)
  }

  async deleteForUser(userId: string, id: string): Promise<{ readonly ok: true }> {
    await this.requireOwnedWebhook(userId, id)
    await this.prisma.userWebhook.delete({ where: { id } })
    return { ok: true }
  }

  async resetSecret(userId: string, id: string, publicAppUrl: string): Promise<DashboardWebhookSecretResult> {
    await this.requireOwnedWebhook(userId, id)
    const secret = this.tokens.createSecret?.() ?? createWebhookSecret()
    const webhook = await this.prisma.userWebhook.update({
      where: { id },
      data: { secretHash: hashWebhookSecret(secret) },
      include: webhookWithLatestDelivery,
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
    return {
      id: webhook.id,
      publicId: webhook.publicId,
      name: webhook.name,
      enabled: webhook.enabled,
      maskedUrl: maskWebhookUrl(buildWebhookUrl(publicAppUrl, webhook.publicId, "secret")),
      createdAt: webhook.createdAt.toISOString(),
      updatedAt: webhook.updatedAt.toISOString(),
      lastDeliveryAt: latestDelivery?.receivedAt.toISOString(),
      lastDeliveryStatus: latestDelivery?.status as WebhookDeliveryStatus | undefined,
    }
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
    status: delivery.status as WebhookDeliveryStatus,
    error: delivery.error ?? undefined,
  }
}
