import { NotFoundException } from "@nestjs/common"
import { WEBHOOK_DELIVERY_STATUS } from "@synapse/shared"
import { describe, expect, it, vi } from "vitest"
import { hashWebhookSecret, verifyWebhookSecret } from "./webhook-token"
import { WebhookService } from "./webhook.service"

const baseWebhook = {
  id: "webhook-1",
  userId: "user-1",
  publicId: "wh_public",
  secretHash: "hash",
  name: "GitHub",
  enabled: true,
  createdAt: new Date("2026-06-06T10:00:00.000Z"),
  updatedAt: new Date("2026-06-06T10:00:00.000Z"),
  deliveries: [],
}

function createPrismaMock() {
  return {
    userWebhook: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    webhookDelivery: {
      findMany: vi.fn(),
    },
  }
}

describe("WebhookService", () => {
  it("creates a webhook for the current user and returns the full URL once", async () => {
    const prisma = createPrismaMock()
    prisma.userWebhook.create.mockImplementation(({ data }) => Promise.resolve({
      ...baseWebhook,
      ...data,
      id: "webhook-1",
      createdAt: baseWebhook.createdAt,
      updatedAt: baseWebhook.updatedAt,
      deliveries: [],
    }))
    const service = new WebhookService(prisma as never, {
      createPublicId: () => "wh_public",
      createSecret: () => "whsec_secret",
    })

    const result = await service.createForUser("user-1", { name: " GitHub " }, "https://synapse.test")

    expect(result.url).toBe("https://synapse.test/webhooks/wh_public/whsec_secret")
    expect(result.webhook).toMatchObject({
      publicId: "wh_public",
      name: "GitHub",
      enabled: true,
      maskedUrl: "https://synapse.test/webhooks/wh_public/***",
    })
    expect(JSON.stringify(prisma.userWebhook.create.mock.calls)).not.toContain("whsec_secret")
    expect(prisma.userWebhook.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: "user-1",
        publicId: "wh_public",
        name: "GitHub",
      }),
    }))
  })

  it("lists webhooks for one user with latest delivery metadata", async () => {
    const prisma = createPrismaMock()
    prisma.userWebhook.findMany.mockResolvedValue([
      {
        ...baseWebhook,
        deliveries: [{
          receivedAt: new Date("2026-06-06T11:00:00.000Z"),
          status: WEBHOOK_DELIVERY_STATUS.accepted,
        }],
      },
    ])
    const service = new WebhookService(prisma as never)

    await expect(service.listForUser("user-1", "https://synapse.test")).resolves.toEqual([{
      id: "webhook-1",
      publicId: "wh_public",
      name: "GitHub",
      enabled: true,
      maskedUrl: "https://synapse.test/webhooks/wh_public/***",
      createdAt: "2026-06-06T10:00:00.000Z",
      updatedAt: "2026-06-06T10:00:00.000Z",
      lastDeliveryAt: "2026-06-06T11:00:00.000Z",
      lastDeliveryStatus: WEBHOOK_DELIVERY_STATUS.accepted,
    }])
    expect(prisma.userWebhook.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1" },
      include: expect.objectContaining({
        deliveries: expect.objectContaining({
          orderBy: { receivedAt: "desc" },
          take: 1,
        }),
      }),
    }))
  })

  it("resets secret and invalidates the old secret hash", async () => {
    const prisma = createPrismaMock()
    const oldHash = hashWebhookSecret("whsec_old")
    prisma.userWebhook.findFirst.mockResolvedValue({
      ...baseWebhook,
      secretHash: oldHash,
    })
    prisma.userWebhook.update.mockImplementation(({ data }) => Promise.resolve({
      ...baseWebhook,
      secretHash: data.secretHash,
      deliveries: [],
    }))
    const service = new WebhookService(prisma as never, {
      createPublicId: () => "wh_public",
      createSecret: () => "whsec_new",
    })

    const reset = await service.resetSecret("user-1", "webhook-1", "https://synapse.test")

    expect(reset.url).toBe("https://synapse.test/webhooks/wh_public/whsec_new")
    const savedHash = prisma.userWebhook.update.mock.calls[0]?.[0]?.data.secretHash
    expect(verifyWebhookSecret("whsec_old", savedHash)).toBe(false)
    expect(verifyWebhookSecret("whsec_new", savedHash)).toBe(true)
  })

  it("keeps users isolated when listing and mutating webhooks", async () => {
    const prisma = createPrismaMock()
    prisma.userWebhook.findMany.mockResolvedValue([{ ...baseWebhook, deliveries: [] }])
    prisma.userWebhook.findFirst.mockResolvedValue(null)
    const service = new WebhookService(prisma as never)

    await expect(service.updateForUser("user-2", "webhook-1", { name: "Hack" }, "https://synapse.test"))
      .rejects.toThrow(NotFoundException)
    await expect(service.listForUser("user-1", "https://synapse.test")).resolves.toHaveLength(1)
    expect(prisma.userWebhook.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1" },
    }))
  })

  it("lists deliveries only for an owned webhook in newest-first order", async () => {
    const prisma = createPrismaMock()
    prisma.userWebhook.findFirst.mockResolvedValue({ id: "webhook-1" })
    prisma.webhookDelivery.findMany.mockResolvedValue([
      {
        id: "delivery-new",
        webhookId: "webhook-1",
        method: "POST",
        path: "/webhooks/wh_public/***",
        query: { q: "1" },
        headers: { "content-type": "application/json" },
        bodyKind: "json",
        bodySize: 12,
        bodyPreview: "{\"ok\":true}",
        receivedAt: new Date("2026-06-06T12:00:00.000Z"),
        onlineClientCount: 2,
        sentClientCount: 1,
        failedClientCount: 1,
        status: WEBHOOK_DELIVERY_STATUS.broadcastFailed,
        error: "send failed",
      },
    ])
    const service = new WebhookService(prisma as never)

    await expect(service.listDeliveriesForUser("user-1", "webhook-1")).resolves.toEqual([{
      id: "delivery-new",
      webhookId: "webhook-1",
      method: "POST",
      path: "/webhooks/wh_public/***",
      query: { q: "1" },
      headers: { "content-type": "application/json" },
      bodyKind: "json",
      bodySize: 12,
      bodyPreview: "{\"ok\":true}",
      receivedAt: "2026-06-06T12:00:00.000Z",
      onlineClientCount: 2,
      sentClientCount: 1,
      failedClientCount: 1,
      status: WEBHOOK_DELIVERY_STATUS.broadcastFailed,
      error: "send failed",
    }])
    expect(prisma.webhookDelivery.findMany).toHaveBeenCalledWith({
      where: { webhookId: "webhook-1", userId: "user-1" },
      orderBy: { receivedAt: "desc" },
      take: 100,
    })
  })
})
