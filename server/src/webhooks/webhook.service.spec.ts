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
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    webhookDelivery: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback({
      userWebhook: {
        findFirst: vi.fn(),
        updateMany: vi.fn(),
      },
    })),
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
    }, { record: vi.fn() } as never)
    prisma.user.findUnique.mockResolvedValue({ email: "user@example.com" })

    const result = await service.createForUser("user-1", { name: " GitHub " }, "https://synapse.test", "203.0.113.10")

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

  it("audits webhook creation without secret material", async () => {
    const prisma = createPrismaMock()
    const auditLog = { record: vi.fn() }
    prisma.user.findUnique.mockResolvedValue({ email: "user@example.com" })
    prisma.userWebhook.create.mockResolvedValue({
      ...baseWebhook,
      secretHash: hashWebhookSecret("whsec_secret"),
      deliveries: [],
    })
    const service = new WebhookService(prisma as never, {
      createPublicId: () => "wh_public",
      createSecret: () => "whsec_secret",
    }, auditLog as never)

    await service.createForUser("user-1", { name: "GitHub" }, "https://synapse.test", "203.0.113.10")

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "user@example.com",
      action: "webhook.create",
      targetType: "webhook",
      targetId: "webhook-1",
      detail: { publicId: "wh_public", name: "GitHub", enabled: true },
      ipAddress: "203.0.113.10",
    })
    const serializedAudit = JSON.stringify(auditLog.record.mock.calls)
    expect(serializedAudit).not.toContain("whsec_")
    expect(serializedAudit).not.toContain("secretHash")
    expect(serializedAudit).not.toContain("https://synapse.test/webhooks/wh_public/whsec_secret")
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
    const tx = {
      userWebhook: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn(),
      },
    }
    const oldHash = hashWebhookSecret("whsec_old")
    prisma.userWebhook.findFirst.mockResolvedValue({
      ...baseWebhook,
      secretHash: oldHash,
    })
    tx.userWebhook.findFirst.mockImplementation(() => Promise.resolve({
      ...baseWebhook,
      secretHash: tx.userWebhook.updateMany.mock.calls[0]?.[0]?.data.secretHash,
      deliveries: [],
    }))
    prisma.$transaction.mockImplementation((callback) => callback(tx))
    const service = new WebhookService(prisma as never, {
      createPublicId: () => "wh_public",
      createSecret: () => "whsec_new",
    })

    const reset = await service.resetSecret("user-1", "webhook-1", "https://synapse.test")

    expect(reset.url).toBe("https://synapse.test/webhooks/wh_public/whsec_new")
    expect(tx.userWebhook.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "webhook-1", userId: "user-1" },
    }))
    const savedHash = tx.userWebhook.updateMany.mock.calls[0]?.[0]?.data.secretHash
    expect(verifyWebhookSecret("whsec_old", savedHash)).toBe(false)
    expect(verifyWebhookSecret("whsec_new", savedHash)).toBe(true)
  })

  it("audits update, reset, and delete without secret material", async () => {
    const prisma = createPrismaMock()
    const auditLog = { record: vi.fn() }
    prisma.user.findUnique.mockResolvedValue({ email: "user@example.com" })
    const tx = {
      userWebhook: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn().mockResolvedValue({ ...baseWebhook, name: "Deploy", enabled: false, deliveries: [] }),
      },
    }
    prisma.$transaction.mockImplementation((callback) => callback(tx))
    prisma.userWebhook.findFirst.mockResolvedValue({ ...baseWebhook, name: "Deploy", enabled: false })
    prisma.userWebhook.deleteMany.mockResolvedValue({ count: 1 })
    const service = new WebhookService(prisma as never, {
      createPublicId: () => "wh_public",
      createSecret: () => "whsec_new",
    }, auditLog as never)

    await service.updateForUser("user-1", "webhook-1", { name: "Deploy", enabled: false }, "https://synapse.test", "203.0.113.11")
    await service.resetSecret("user-1", "webhook-1", "https://synapse.test", "203.0.113.12")
    await service.deleteForUser("user-1", "webhook-1", "203.0.113.13")

    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "webhook.update",
      detail: { publicId: "wh_public", name: "Deploy", enabled: false, changedFields: ["name", "enabled"] },
      ipAddress: "203.0.113.11",
    }))
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "webhook.reset_secret",
      detail: { publicId: "wh_public", name: "Deploy", enabled: false },
      ipAddress: "203.0.113.12",
    }))
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "webhook.delete",
      detail: { publicId: "wh_public", name: "Deploy", enabled: false },
      ipAddress: "203.0.113.13",
    }))
    const serializedAudit = JSON.stringify(auditLog.record.mock.calls)
    expect(serializedAudit).not.toContain("whsec_")
    expect(serializedAudit).not.toContain("secretHash")
    expect(serializedAudit).not.toContain("https://synapse.test/webhooks/wh_public/whsec_new")
  })

  it("keeps users isolated when listing and mutating webhooks", async () => {
    const prisma = createPrismaMock()
    prisma.userWebhook.findMany.mockResolvedValue([{ ...baseWebhook, deliveries: [] }])
    const tx = {
      userWebhook: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirst: vi.fn(),
      },
    }
    prisma.$transaction.mockImplementation((callback) => callback(tx))
    const service = new WebhookService(prisma as never)

    await expect(service.updateForUser("user-2", "webhook-1", { name: "Hack" }, "https://synapse.test"))
      .rejects.toThrow(NotFoundException)
    await expect(service.listForUser("user-1", "https://synapse.test")).resolves.toHaveLength(1)
    expect(prisma.userWebhook.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1" },
    }))
  })

  it("scopes update and delete writes by both webhook id and user id", async () => {
    const prisma = createPrismaMock()
    const tx = {
      userWebhook: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn().mockResolvedValue({ ...baseWebhook, name: "Deploy", deliveries: [] }),
      },
    }
    prisma.$transaction.mockImplementation((callback) => callback(tx))
    prisma.userWebhook.findFirst.mockResolvedValue({ ...baseWebhook, name: "Deploy" })
    prisma.userWebhook.deleteMany.mockResolvedValue({ count: 1 })
    const service = new WebhookService(prisma as never)

    await service.updateForUser("user-1", "webhook-1", { name: "Deploy" }, "https://synapse.test")
    await service.deleteForUser("user-1", "webhook-1")

    expect(tx.userWebhook.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "webhook-1", userId: "user-1" },
    }))
    expect(prisma.userWebhook.deleteMany).toHaveBeenCalledWith({
      where: { id: "webhook-1", userId: "user-1" },
    })
  })

  it("rejects empty webhook updates", async () => {
    const service = new WebhookService(createPrismaMock() as never)

    await expect(service.updateForUser("user-1", "webhook-1", {}, "https://synapse.test"))
      .rejects.toThrow("Webhook update must include at least one field.")
  })

  it("omits unknown last delivery status from webhook DTOs", async () => {
    const prisma = createPrismaMock()
    prisma.userWebhook.findMany.mockResolvedValue([
      {
        ...baseWebhook,
        deliveries: [{
          receivedAt: new Date("2026-06-06T11:00:00.000Z"),
          status: "future_status",
        }],
      },
    ])
    const service = new WebhookService(prisma as never)

    const [webhook] = await service.listForUser("user-1", "https://synapse.test")

    expect(webhook).not.toHaveProperty("lastDeliveryStatus")
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

  it("maps unknown delivery statuses to a safe DTO status", async () => {
    const prisma = createPrismaMock()
    prisma.userWebhook.findFirst.mockResolvedValue({ id: "webhook-1" })
    prisma.webhookDelivery.findMany.mockResolvedValue([
      {
        id: "delivery-1",
        webhookId: "webhook-1",
        method: "POST",
        path: "/webhooks/wh_public/***",
        query: {},
        headers: {},
        bodyKind: "json",
        bodySize: 12,
        bodyPreview: null,
        receivedAt: new Date("2026-06-06T12:00:00.000Z"),
        onlineClientCount: 0,
        sentClientCount: 0,
        failedClientCount: 0,
        status: "future_status",
        error: null,
      },
    ])
    const service = new WebhookService(prisma as never)

    await expect(service.listDeliveriesForUser("user-1", "webhook-1")).resolves.toEqual([
      expect.objectContaining({ status: WEBHOOK_DELIVERY_STATUS.rejected }),
    ])
  })
})
