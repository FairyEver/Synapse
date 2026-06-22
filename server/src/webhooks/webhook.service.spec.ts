import { BadRequestException, Logger, NotFoundException, PayloadTooLargeException } from "@nestjs/common"
import { LIVE_MESSAGE_TYPES, WEBHOOK_DELIVERY_STATUS } from "@synapse/shared"
import { describe, expect, it, vi } from "vitest"
import { hashWebhookSecret, verifyWebhookSecret } from "./webhook-token"
import { WebhookService } from "./webhook.service"

const baseWebhook = {
  id: "webhook-1",
  userId: "user-1",
  publicId: "wh_public",
  secretHash: "hash",
  secret: "whsec_secret",
  name: "GitHub",
  enabled: true,
  deletedAt: null,
  createdAt: new Date("2026-06-06T10:00:00.000Z"),
  updatedAt: new Date("2026-06-06T10:00:00.000Z"),
  deliveries: [],
}

function createPrismaMock() {
  return {
    userWebhook: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    webhookDelivery: {
      create: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    webhookDeliveryReceipt: {
      createMany: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn((callback) => callback({
      userWebhook: {
        create: vi.fn(),
        findFirst: vi.fn(),
        updateMany: vi.fn(),
        deleteMany: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    })),
  }
}

describe("WebhookService", () => {
  it("creates a webhook for the current user and returns the full URL in the webhook dto", async () => {
    const prisma = createPrismaMock()
    const tx = {
      userWebhook: {
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({
          ...baseWebhook,
          ...data,
          id: "webhook-1",
          createdAt: baseWebhook.createdAt,
          updatedAt: baseWebhook.updatedAt,
          deliveries: [],
        })),
      },
      auditLog: {
        create: vi.fn(),
      },
    }
    prisma.$transaction.mockImplementation((callback) => callback(tx))
    const service = new WebhookService(prisma as never, {
      createPublicId: () => "wh_public",
      createSecret: () => "whsec_secret",
    }, { record: vi.fn() } as never)
    prisma.user.findUnique.mockResolvedValue({ email: "user@example.com" })

    const result = await service.createForUser("user-1", { name: " GitHub " }, "https://synapse.test", "203.0.113.10")

    expect(result.url).toBe("https://synapse.test/webhooks/wh_public/whsec_secret")
    expect(result.webhook.publicId).toBe("wh_public")
    expect(result.webhook.name).toBe("GitHub")
    expect(result.webhook.enabled).toBe(true)
    expect(result.webhook.url).toBe("https://synapse.test/webhooks/wh_public/whsec_secret")
    expect(result.webhook.maskedUrl).toBe("https://synapse.test/webhooks/wh_public/***")
    expect(tx.userWebhook.create.mock.calls[0]?.[0]?.data).toMatchObject({
      userId: "user-1",
      publicId: "wh_public",
      secret: "whsec_secret",
      name: "GitHub",
    })
  })

  it("audits webhook creation without secret material", async () => {
    const prisma = createPrismaMock()
    const auditLog = {}
    const tx = {
      userWebhook: {
        create: vi.fn().mockResolvedValue({
          ...baseWebhook,
          secretHash: hashWebhookSecret("whsec_secret"),
          deliveries: [],
        }),
      },
      auditLog: {
        create: vi.fn(),
      },
    }
    prisma.user.findUnique.mockResolvedValue({ email: "user@example.com" })
    prisma.$transaction.mockImplementation((callback) => callback(tx))
    const service = new WebhookService(prisma as never, {
      createPublicId: () => "wh_public",
      createSecret: () => "whsec_secret",
    }, auditLog as never)

    await service.createForUser("user-1", { name: "GitHub" }, "https://synapse.test", "203.0.113.10")

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        adminEmail: "user@example.com",
        action: "webhook.create",
        targetType: "webhook",
        targetId: "webhook-1",
        detail: { publicId: "wh_public", name: "GitHub", enabled: true },
        ipAddress: "203.0.113.10",
      },
    })
    const serializedAudit = JSON.stringify(tx.auditLog.create.mock.calls)
    expect(serializedAudit).not.toContain("whsec_")
    expect(serializedAudit).not.toContain("secretHash")
    expect(serializedAudit).not.toContain("https://synapse.test/webhooks/wh_public/whsec_secret")
  })

  it("rolls back webhook creation when audit insert fails before returning the copyable URL", async () => {
    const prisma = createPrismaMock()
    const persistedWebhooks: unknown[] = []
    const tx = {
      userWebhook: {
        create: vi.fn().mockImplementation(({ data }) => {
          const webhook = {
            ...baseWebhook,
            ...data,
            id: "webhook-1",
            createdAt: baseWebhook.createdAt,
            updatedAt: baseWebhook.updatedAt,
            deliveries: [],
          }
          persistedWebhooks.push(webhook)
          return Promise.resolve(webhook)
        }),
      },
      auditLog: {
        create: vi.fn().mockRejectedValue(new Error("audit failed")),
      },
    }
    prisma.user.findUnique.mockResolvedValue({ email: "user@example.com" })
    prisma.$transaction.mockImplementation(async (callback) => {
      const snapshot = [...persistedWebhooks]
      try {
        return await callback(tx)
      } catch (error) {
        persistedWebhooks.splice(0, persistedWebhooks.length, ...snapshot)
        throw error
      }
    })
    const service = new WebhookService(prisma as never, {
      createPublicId: () => "wh_public",
      createSecret: () => "whsec_secret",
    }, {} as never)

    await expect(service.createForUser("user-1", { name: "GitHub" }, "https://synapse.test", "203.0.113.10"))
      .rejects.toThrow("audit failed")

    expect(persistedWebhooks).toHaveLength(0)
    expect(tx.auditLog.create).toHaveBeenCalled()
  })

  it("lists webhooks for one user with latest delivery metadata", async () => {
    const prisma = createPrismaMock()
    prisma.userWebhook.findMany.mockResolvedValue([
      {
        ...baseWebhook,
        deliveries: [{
          receivedAt: new Date("2026-06-06T11:00:00.000Z"),
          status: "accepted",
        }],
      },
    ])
    prisma.userWebhook.count.mockResolvedValue(1)
    prisma.$transaction.mockImplementation((input) => Array.isArray(input) ? Promise.all(input) : input({}))
    const service = new WebhookService(prisma as never)

    await expect(service.listForUser("user-1", {
      publicAppUrl: "https://synapse.test",
      pagination: { page: 2, pageSize: 10, sortBy: "createdAt", sortOrder: "desc" },
    })).resolves.toEqual({
      data: [{
        id: "webhook-1",
        publicId: "wh_public",
        name: "GitHub",
        enabled: true,
        url: "https://synapse.test/webhooks/wh_public/whsec_secret",
        maskedUrl: "https://synapse.test/webhooks/wh_public/***",
        createdAt: "2026-06-06T10:00:00.000Z",
        updatedAt: "2026-06-06T10:00:00.000Z",
        lastDeliveryAt: "2026-06-06T11:00:00.000Z",
        lastDeliveryStatus: WEBHOOK_DELIVERY_STATUS.received,
      }],
      total: 1,
      page: 2,
      pageSize: 10,
    })
    const findManyArgs = prisma.userWebhook.findMany.mock.calls[0]?.[0]
    expect(findManyArgs.where).toEqual({ userId: "user-1", deletedAt: null })
    expect(findManyArgs.include.deliveries.orderBy).toEqual({ receivedAt: "desc" })
    expect(findManyArgs.include.deliveries.take).toBe(1)
    expect(findManyArgs.skip).toBe(10)
    expect(findManyArgs.take).toBe(10)
    expect(prisma.userWebhook.count).toHaveBeenCalledWith({
      where: { userId: "user-1", deletedAt: null },
    })
  })

  it("returns null full URLs for legacy hash-only webhooks", async () => {
    const prisma = createPrismaMock()
    prisma.userWebhook.findFirst.mockResolvedValue({
      ...baseWebhook,
      secret: null,
      deliveries: [],
    })
    const service = new WebhookService(prisma as never)

    await expect(service.getForUser("user-1", "webhook-1", "https://synapse.test")).resolves.toEqual({
      id: "webhook-1",
      publicId: "wh_public",
      name: "GitHub",
      enabled: true,
      url: null,
      maskedUrl: "https://synapse.test/webhooks/wh_public/***",
      createdAt: "2026-06-06T10:00:00.000Z",
      updatedAt: "2026-06-06T10:00:00.000Z",
    })
  })

  it("resets secret and invalidates the old secret hash", async () => {
    const prisma = createPrismaMock()
    const tx = {
      userWebhook: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
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
      secret: tx.userWebhook.updateMany.mock.calls[0]?.[0]?.data.secret,
      deliveries: [],
    }))
    prisma.$transaction.mockImplementation((callback) => callback(tx))
    const service = new WebhookService(prisma as never, {
      createPublicId: () => "wh_public",
      createSecret: () => "whsec_new",
    })

    const reset = await service.resetSecret("user-1", "webhook-1", "https://synapse.test")

    expect(reset.url).toBe("https://synapse.test/webhooks/wh_public/whsec_new")
    expect(reset.webhook.url).toBe("https://synapse.test/webhooks/wh_public/whsec_new")
    expect(tx.userWebhook.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "webhook-1", userId: "user-1", deletedAt: null },
      data: expect.objectContaining({ secret: "whsec_new" }),
    }))
    const savedHash = tx.userWebhook.updateMany.mock.calls[0]?.[0]?.data.secretHash
    expect(verifyWebhookSecret("whsec_old", savedHash)).toBe(false)
    expect(verifyWebhookSecret("whsec_new", savedHash)).toBe(true)
  })

  it("audits update, reset, and delete without secret material", async () => {
    const prisma = createPrismaMock()
    const auditLog = {}
    prisma.user.findUnique.mockResolvedValue({ email: "user@example.com" })
    const tx = {
      userWebhook: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn().mockResolvedValue({ ...baseWebhook, name: "Deploy", enabled: false, deliveries: [] }),
      },
      auditLog: {
        create: vi.fn(),
      },
    }
    prisma.$transaction.mockImplementation((callback) => callback(tx))
    prisma.userWebhook.findFirst.mockResolvedValue({ ...baseWebhook, name: "Deploy", enabled: false })
    const service = new WebhookService(prisma as never, {
      createPublicId: () => "wh_public",
      createSecret: () => "whsec_new",
    }, auditLog as never)

    await service.updateForUser("user-1", "webhook-1", { name: "Deploy", enabled: false }, "https://synapse.test", "203.0.113.11")
    await service.resetSecret("user-1", "webhook-1", "https://synapse.test", "203.0.113.12")
    await service.deleteForUser("user-1", "webhook-1", "203.0.113.13")

    const auditRecords = tx.auditLog.create.mock.calls.map((call) => call[0].data)
    expect(auditRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "webhook.update",
        detail: { publicId: "wh_public", name: "Deploy", enabled: false, changedFields: ["name", "enabled"] },
        ipAddress: "203.0.113.11",
      }),
      expect.objectContaining({
        action: "webhook.reset_secret",
        detail: { publicId: "wh_public", name: "Deploy", enabled: false },
        ipAddress: "203.0.113.12",
      }),
      expect.objectContaining({
        action: "webhook.delete",
        detail: { publicId: "wh_public", name: "Deploy", enabled: false },
        ipAddress: "203.0.113.13",
      }),
    ]))
    const serializedAudit = JSON.stringify(tx.auditLog.create.mock.calls)
    expect(serializedAudit).not.toContain("whsec_")
    expect(serializedAudit).not.toContain("secretHash")
    expect(serializedAudit).not.toContain("https://synapse.test/webhooks/wh_public/whsec_new")
  })

  it("soft-deletes webhooks without deleting delivery history", async () => {
    const prisma = createPrismaMock()
    const tx = {
      userWebhook: {
        findFirst: vi.fn().mockResolvedValue({ id: "webhook-1", publicId: "wh_public", name: "GitHub", enabled: true }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: vi.fn() },
    }
    prisma.user.findUnique.mockResolvedValue({ email: "user@example.com" })
    prisma.$transaction.mockImplementation((callback) => callback(tx))
    const service = new WebhookService(prisma as never, {}, {} as never)

    await expect(service.deleteForUser("user-1", "webhook-1", "203.0.113.13")).resolves.toEqual({ ok: true })

    expect(tx.userWebhook.findFirst).toHaveBeenCalledWith({
      where: { id: "webhook-1", userId: "user-1", deletedAt: null },
      select: { id: true, publicId: true, name: true, enabled: true },
    })
    expect(tx.userWebhook.updateMany).toHaveBeenCalledWith({
      where: { id: "webhook-1", userId: "user-1", deletedAt: null },
      data: {
        deletedAt: expect.any(Date),
        enabled: false,
        secret: null,
      },
    })
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "webhook.delete" }),
    }))
  })

  it("rolls back secret reset when audit insert fails before returning the copyable URL", async () => {
    const prisma = createPrismaMock()
    const oldHash = hashWebhookSecret("whsec_old")
    let storedHash = oldHash
    const tx = {
      userWebhook: {
        updateMany: vi.fn().mockImplementation(({ data }) => {
          storedHash = data.secretHash
          return Promise.resolve({ count: 1 })
        }),
        findFirst: vi.fn().mockImplementation(() => Promise.resolve({
          ...baseWebhook,
          secretHash: storedHash,
          deliveries: [],
        })),
      },
      auditLog: {
        create: vi.fn().mockRejectedValue(new Error("audit failed")),
      },
    }
    prisma.user.findUnique.mockResolvedValue({ email: "user@example.com" })
    prisma.$transaction.mockImplementation(async (callback) => {
      const snapshot = storedHash
      try {
        return await callback(tx)
      } catch (error) {
        storedHash = snapshot
        throw error
      }
    })
    const service = new WebhookService(prisma as never, {
      createSecret: () => "whsec_new",
    }, {} as never)

    await expect(service.resetSecret("user-1", "webhook-1", "https://synapse.test", "203.0.113.12"))
      .rejects.toThrow("audit failed")

    expect(verifyWebhookSecret("whsec_old", storedHash)).toBe(true)
    expect(verifyWebhookSecret("whsec_new", storedHash)).toBe(false)
    expect(tx.auditLog.create).toHaveBeenCalled()
  })

  it("keeps users isolated when listing and mutating webhooks", async () => {
    const prisma = createPrismaMock()
    prisma.userWebhook.findMany.mockResolvedValue([{ ...baseWebhook, deliveries: [] }])
    prisma.userWebhook.count.mockResolvedValue(1)
    const tx = {
      userWebhook: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findFirst: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    }
    prisma.$transaction.mockImplementation((input) => Array.isArray(input) ? Promise.all(input) : input(tx))
    const service = new WebhookService(prisma as never)

    await expect(service.updateForUser("user-2", "webhook-1", { name: "Hack" }, "https://synapse.test"))
      .rejects.toThrow(NotFoundException)
    await expect(service.listForUser("user-1", {
      publicAppUrl: "https://synapse.test",
      pagination: { page: 1, pageSize: 20, sortBy: "createdAt", sortOrder: "desc" },
    })).resolves.toMatchObject({ total: 1, data: [expect.objectContaining({ id: "webhook-1" })] })
    expect(prisma.userWebhook.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1", deletedAt: null },
    }))
  })

  it("scopes update and delete writes by both webhook id and user id", async () => {
    const prisma = createPrismaMock()
    const tx = {
      userWebhook: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn().mockResolvedValue({ ...baseWebhook, name: "Deploy", deliveries: [] }),
      },
      auditLog: {
        create: vi.fn(),
      },
    }
    prisma.$transaction.mockImplementation((callback) => callback(tx))
    prisma.userWebhook.findFirst.mockResolvedValue({ ...baseWebhook, name: "Deploy" })
    const service = new WebhookService(prisma as never)

    await service.updateForUser("user-1", "webhook-1", { name: "Deploy" }, "https://synapse.test")
    await service.deleteForUser("user-1", "webhook-1")

    expect(tx.userWebhook.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: "webhook-1", userId: "user-1", deletedAt: null },
    }))
    expect(tx.userWebhook.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "webhook-1", userId: "user-1", deletedAt: null },
      data: {
        deletedAt: expect.any(Date),
        enabled: false,
        secret: null,
      },
    })
  })

  it("rejects empty webhook updates", async () => {
    const service = new WebhookService(createPrismaMock() as never)

    await expect(service.updateForUser("user-1", "webhook-1", {}, "https://synapse.test"))
      .rejects.toThrow("Webhook update must include at least one field.")
  })

  it("omits unknown last delivery status from webhook DTOs", async () => {
    const prisma = createPrismaMock()
    prisma.userWebhook.findFirst.mockResolvedValue({
      ...baseWebhook,
      deliveries: [{
        receivedAt: new Date("2026-06-06T11:00:00.000Z"),
        status: "future_status",
      }],
    })
    const service = new WebhookService(prisma as never)

    const webhook = await service.getForUser("user-1", "webhook-1", "https://synapse.test")

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
        receipts: [
          {
            id: "receipt-1",
            clientInstanceId: "client-a",
            deviceName: "MacBook",
            platform: "darwin-arm64",
            appVersion: "0.2.253",
            sentAt: new Date("2026-06-06T12:00:01.000Z"),
            acknowledgedAt: new Date("2026-06-06T12:00:02.000Z"),
            status: "acknowledged",
          },
        ],
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
      acknowledgedClientCount: 1,
      clientReceipts: [{
        id: "receipt-1",
        clientInstanceId: "client-a",
        deviceName: "MacBook",
        platform: "darwin-arm64",
        appVersion: "0.2.253",
        sentAt: "2026-06-06T12:00:01.000Z",
        acknowledgedAt: "2026-06-06T12:00:02.000Z",
        status: "acknowledged",
      }],
      status: WEBHOOK_DELIVERY_STATUS.broadcastFailed,
      error: "send failed",
    }])
    expect(prisma.webhookDelivery.findMany).toHaveBeenCalledWith({
      where: { webhookId: "webhook-1", userId: "user-1" },
      include: { receipts: { orderBy: { sentAt: "asc" } } },
      orderBy: { receivedAt: "desc" },
      take: 100,
    })
    expect(prisma.userWebhook.findFirst).toHaveBeenCalledWith({
      where: { id: "webhook-1", userId: "user-1", deletedAt: null },
      select: { id: true },
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

  it("lists current-user delivery history with filters and webhook metadata", async () => {
    const prisma = createPrismaMock()
    const deliveries = [{
      id: "delivery-1",
      webhookId: "webhook-1",
      webhookPublicId: "wh_public",
      webhookName: "GitHub",
      method: "POST",
      path: "/webhooks/wh_public/***",
      query: { event: "push" },
      headers: { "x-github-event": "push" },
      bodyKind: "json",
      bodySize: 12,
      bodyPreview: "{\"ok\":true}",
      receivedAt: new Date("2026-06-07T09:00:00.000Z"),
      onlineClientCount: 2,
      sentClientCount: 2,
      failedClientCount: 0,
      status: WEBHOOK_DELIVERY_STATUS.delivered,
      error: null,
      receipts: [],
      webhook: {
        id: "webhook-1",
        publicId: "wh_public",
        name: "GitHub current",
        deletedAt: new Date("2026-06-07T10:00:00.000Z"),
      },
    }]
    prisma.webhookDelivery.findMany.mockResolvedValue(deliveries)
    prisma.webhookDelivery.count.mockResolvedValue(1)
    prisma.$transaction.mockImplementation((input) => Array.isArray(input) ? Promise.all(input) : input({}))
    const service = new WebhookService(prisma as never)

    await expect(service.listDeliveryHistoryForUser("user-1", {
      pagination: { page: 1, pageSize: 20, sortBy: "receivedAt", sortOrder: "desc" },
      filters: { webhookId: "webhook-1", status: WEBHOOK_DELIVERY_STATUS.delivered, from: "2026-06-07", to: "2026-06-08" },
    })).resolves.toMatchObject({
      total: 1,
      data: [{
        id: "delivery-1",
        webhook: {
          id: "webhook-1",
          publicId: "wh_public",
          name: "GitHub",
          currentName: "GitHub current",
          deletedAt: "2026-06-07T10:00:00.000Z",
        },
      }],
    })
    expect(prisma.webhookDelivery.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: "user-1",
        webhookId: "webhook-1",
        status: WEBHOOK_DELIVERY_STATUS.delivered,
        receivedAt: {
          gte: new Date("2026-06-07T00:00:00.000Z"),
          lte: new Date("2026-06-08T23:59:59.999Z"),
        },
      }),
      include: expect.objectContaining({
        receipts: { orderBy: { sentAt: "asc" } },
        webhook: expect.any(Object),
      }),
      orderBy: { receivedAt: "desc" },
      skip: 0,
      take: 20,
    }))
  })

  it("lists admin delivery history across users with user summaries", async () => {
    const prisma = createPrismaMock()
    const delivery = {
      id: "delivery-1",
      webhookId: "webhook-1",
      userId: "user-1",
      webhookPublicId: "wh_public",
      webhookName: "GitHub",
      method: "POST",
      path: "/webhooks/wh_public/***",
      query: {},
      headers: {},
      bodyKind: "json",
      bodySize: 12,
      bodyPreview: null,
      receivedAt: new Date("2026-06-07T09:00:00.000Z"),
      onlineClientCount: 0,
      sentClientCount: 0,
      failedClientCount: 0,
      status: WEBHOOK_DELIVERY_STATUS.noOnlineClients,
      error: null,
      receipts: [],
      webhook: { id: "webhook-1", publicId: "wh_public", name: "GitHub", deletedAt: null },
    }
    prisma.user.findMany.mockResolvedValueOnce([{ id: "user-1", email: "user@example.com", displayName: "Ada" }])
    prisma.webhookDelivery.findMany.mockResolvedValue([delivery])
    prisma.webhookDelivery.count.mockResolvedValue(1)
    prisma.$transaction.mockImplementation((input) => Array.isArray(input) ? Promise.all(input) : input({}))
    const service = new WebhookService(prisma as never)

    await expect(service.listDeliveryHistoryForAdmin({
      pagination: { page: 1, pageSize: 20, sortBy: "receivedAt", sortOrder: "desc" },
      filters: { user: "user@example.com" },
    })).resolves.toMatchObject({
      data: [{ user: { email: "user@example.com", displayName: "Ada" } }],
      total: 1,
    })
    expect(prisma.webhookDelivery.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        webhook: {
          user: {
            OR: [
              { email: { contains: "user@example.com", mode: "insensitive" } },
              { displayName: { contains: "user@example.com", mode: "insensitive" } },
            ],
          },
        },
      },
    }))
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.user.findMany).not.toHaveBeenCalledWith(expect.objectContaining({ take: 100 }))
  })

  it("accepts a webhook request, broadcasts to online clients, and stores delivery counts", async () => {
    const harness = createWebhookReceiveHarness({
      broadcastResult: {
        onlineClientCount: 2,
        sentClientCount: 2,
        failedClientCount: 0,
        clientResults: [
          {
            clientInstanceId: "client-a",
            deviceName: "MacBook",
            platform: "darwin-arm64",
            appVersion: "0.2.253",
            sentAt: "2026-06-06T12:00:00.000Z",
            status: "sent",
          },
          {
            clientInstanceId: "client-b",
            deviceName: "Workstation",
            platform: "win32-x64",
            appVersion: "0.2.253",
            sentAt: "2026-06-06T12:00:00.000Z",
            status: "sent",
          },
        ],
      },
    })

    const result = await harness.receive({
      method: "POST",
      query: { event: "push", secret: "query-secret" },
      headers: {
        "x-github-event": "push",
        authorization: "Bearer raw-secret",
      },
      body: Buffer.from(JSON.stringify({
        repository: { full_name: "FairyEver/Synapse" },
        token: "body-secret",
      })),
      contentType: "application/json",
      remoteAddress: "127.0.0.1",
    })

    expect(result.response).toMatchObject({ ok: true, deliveryId: expect.any(String) })
    expect(harness.live.broadcastToUser).toHaveBeenCalledWith("user-1", expect.objectContaining({
      type: LIVE_MESSAGE_TYPES.webhookDeliveryReceived,
    }))
    expect(harness.deliveries).toEqual([
      expect.objectContaining({
        webhookId: "webhook-1",
        webhookPublicId: "wh_public",
        webhookName: "GitHub",
        userId: "user-1",
        onlineClientCount: 2,
        sentClientCount: 2,
        failedClientCount: 0,
        status: WEBHOOK_DELIVERY_STATUS.sent,
      }),
    ])
    expect(harness.receipts).toEqual([
      expect.objectContaining({
        deliveryId: "delivery-1",
        clientInstanceId: "client-a",
        deviceName: "MacBook",
        status: "sent",
        acknowledgedAt: null,
      }),
      expect.objectContaining({
        deliveryId: "delivery-1",
        clientInstanceId: "client-b",
        deviceName: "Workstation",
        status: "sent",
        acknowledgedAt: null,
      }),
    ])
    const message = harness.live.broadcastToUser.mock.calls[0]?.[1]
    expect(message.payload).toMatchObject({
      deliveryId: "delivery-1",
      webhook: { id: "webhook-1", publicId: "wh_public", name: "GitHub" },
      request: {
        method: "POST",
        url: "https://synapse.test/webhooks/wh_public/***",
        query: { event: "push", secret: "[redacted]" },
        headers: { "x-github-event": "push", authorization: "[redacted]" },
        body: {
          repository: { full_name: "FairyEver/Synapse" },
          token: "[redacted]",
        },
        contentType: "application/json",
        remoteAddress: "127.0.0.1",
      },
    })
    const serializedPayload = JSON.stringify(message.payload)
    expect(serializedPayload).not.toContain("whsec_secret")
    expect(serializedPayload).not.toContain("raw-secret")
    expect(serializedPayload).not.toContain("query-secret")
    expect(serializedPayload).not.toContain("body-secret")
  })

  it("records no_online_clients when no live clients are online", async () => {
    const harness = createWebhookReceiveHarness()

    await harness.receive()

    expect(harness.deliveries).toEqual([
      expect.objectContaining({
        onlineClientCount: 0,
        sentClientCount: 0,
        failedClientCount: 0,
        status: WEBHOOK_DELIVERY_STATUS.noOnlineClients,
        error: null,
      }),
    ])
    expect(harness.receipts).toHaveLength(0)
  })

  it("keeps delivery history when receiving high-frequency webhook requests", async () => {
    const harness = createWebhookReceiveHarness()

    for (let index = 0; index < 105; index += 1) {
      await harness.receive({
        body: Buffer.from(JSON.stringify({ marker: index })),
      })
    }

    expect(harness.deliveries).toHaveLength(105)
    expect(harness.deliveries[0]?.bodyPreview).toContain("\"marker\":0")
    expect(harness.deliveries.at(-1)?.bodyPreview).toContain("\"marker\":104")
    expect(harness.prisma.webhookDelivery.deleteMany).not.toHaveBeenCalled()
  })

  it("rejects invalid secrets without broadcasting", async () => {
    const harness = createWebhookReceiveHarness()

    await expect(harness.receive({ secret: "wrong" })).rejects.toThrow("Webhook not found")
    expect(harness.live.broadcastToUser).not.toHaveBeenCalled()
    expect(harness.deliveries).toHaveLength(0)
  })

  it("rejects disabled webhooks without broadcasting", async () => {
    const harness = createWebhookReceiveHarness({ enabled: false })

    await expect(harness.receive()).rejects.toThrow("Webhook not found")
    expect(harness.live.broadcastToUser).not.toHaveBeenCalled()
    expect(harness.deliveries).toHaveLength(0)
  })

  it("rejects deleted webhooks without broadcasting", async () => {
    const harness = createWebhookReceiveHarness({ deletedAt: new Date("2026-06-07T10:00:00.000Z") })

    await expect(harness.receive()).rejects.toThrow("Webhook not found")
    expect(harness.live.broadcastToUser).not.toHaveBeenCalled()
    expect(harness.deliveries).toHaveLength(0)
  })

  it("rejects unsupported methods without broadcasting", async () => {
    const harness = createWebhookReceiveHarness()

    await expect(harness.receive({ method: "OPTIONS" })).rejects.toThrow("Webhook not found")
    expect(harness.live.broadcastToUser).not.toHaveBeenCalled()
    expect(harness.deliveries).toHaveLength(0)
  })

  it("records broadcast_failed status when live broadcast partially fails", async () => {
    const harness = createWebhookReceiveHarness({
      broadcastResult: { onlineClientCount: 2, sentClientCount: 1, failedClientCount: 1 },
    })

    await harness.receive()

    expect(harness.deliveries).toEqual([
      expect.objectContaining({
        onlineClientCount: 2,
        sentClientCount: 1,
        failedClientCount: 1,
        status: WEBHOOK_DELIVERY_STATUS.broadcastFailed,
      }),
    ])
  })

  it.each(["GET", "POST", "PUT", "PATCH", "DELETE"])("accepts %s public webhook requests", async (method) => {
    const harness = createWebhookReceiveHarness()

    await expect(harness.receive({ method })).resolves.toMatchObject({
      response: { ok: true, deliveryId: expect.any(String) },
    })
    expect(harness.live.broadcastToUser).toHaveBeenCalledTimes(1)
    expect(harness.deliveries).toEqual([
      expect.objectContaining({ method, status: WEBHOOK_DELIVERY_STATUS.noOnlineClients }),
    ])
  })

  it("records client acknowledgements and marks deliveries delivered", async () => {
    const harness = createWebhookReceiveHarness({
      broadcastResult: {
        onlineClientCount: 1,
        sentClientCount: 1,
        failedClientCount: 0,
        clientResults: [{
          clientInstanceId: "client-a",
          deviceName: "MacBook",
          platform: "darwin-arm64",
          appVersion: "0.2.253",
          sentAt: "2026-06-06T12:00:00.000Z",
          status: "sent",
        }],
      },
    })
    await harness.receive()

    await harness.service.recordDeliveryAck({
      userId: "user-1",
      deliveryId: "delivery-1",
      clientInstanceId: "client-a",
      deviceName: "MacBook",
      platform: "darwin-arm64",
      appVersion: "0.2.253",
      acknowledgedAt: new Date("2026-06-06T12:00:02.000Z"),
    })

    expect(harness.receipts).toEqual([
      expect.objectContaining({
        deliveryId: "delivery-1",
        clientInstanceId: "client-a",
        status: "acknowledged",
        acknowledgedAt: new Date("2026-06-06T12:00:02.000Z"),
      }),
    ])
    expect(harness.deliveries).toEqual([
      expect.objectContaining({ id: "delivery-1", status: WEBHOOK_DELIVERY_STATUS.delivered }),
    ])
  })

  it("ignores acknowledgements for another user or unknown delivery", async () => {
    const harness = createWebhookReceiveHarness({
      broadcastResult: {
        onlineClientCount: 1,
        sentClientCount: 1,
        failedClientCount: 0,
        clientResults: [{
          clientInstanceId: "client-a",
          deviceName: "MacBook",
          platform: "darwin-arm64",
          appVersion: "0.2.253",
          sentAt: "2026-06-06T12:00:00.000Z",
          status: "sent",
        }],
      },
    })
    await harness.receive()

    await harness.service.recordDeliveryAck({
      userId: "user-2",
      deliveryId: "delivery-1",
      clientInstanceId: "client-a",
      deviceName: "MacBook",
      platform: "darwin-arm64",
      appVersion: "0.2.253",
      acknowledgedAt: new Date("2026-06-06T12:00:02.000Z"),
    })
    await harness.service.recordDeliveryAck({
      userId: "user-1",
      deliveryId: "delivery-missing",
      clientInstanceId: "client-a",
      deviceName: "MacBook",
      platform: "darwin-arm64",
      appVersion: "0.2.253",
      acknowledgedAt: new Date("2026-06-06T12:00:03.000Z"),
    })

    expect(harness.receipts).toEqual([
      expect.objectContaining({
        deliveryId: "delivery-1",
        clientInstanceId: "client-a",
        status: "sent",
        acknowledgedAt: null,
      }),
    ])
    expect(harness.deliveries).toEqual([
      expect.objectContaining({ id: "delivery-1", status: WEBHOOK_DELIVERY_STATUS.sent }),
    ])
  })

  it("ignores acknowledgements that arrive without a sent receipt", async () => {
    const harness = createWebhookReceiveHarness({
      broadcastResult: { onlineClientCount: 1, sentClientCount: 1, failedClientCount: 0 },
    })
    await harness.receive()

    await harness.service.recordDeliveryAck({
      userId: "user-1",
      deliveryId: "delivery-1",
      clientInstanceId: "client-a",
      deviceName: "MacBook",
      platform: "darwin-arm64",
      appVersion: "0.2.253",
      acknowledgedAt: new Date("2026-06-06T12:00:02.000Z"),
    })

    expect(harness.receipts).toEqual([])
    expect(harness.deliveries).toEqual([
      expect.objectContaining({ id: "delivery-1", status: WEBHOOK_DELIVERY_STATUS.sent }),
    ])
  })

  it("rejects acknowledgements from another client that did not receive the delivery", async () => {
    const harness = createWebhookReceiveHarness({
      broadcastResult: {
        onlineClientCount: 1,
        sentClientCount: 1,
        failedClientCount: 0,
        clientResults: [{
          clientInstanceId: "client-a",
          deviceName: "MacBook",
          platform: "darwin-arm64",
          appVersion: "0.2.253",
          sentAt: "2026-06-06T12:00:00.000Z",
          status: "sent",
        }],
      },
    })
    await harness.receive()

    await harness.service.recordDeliveryAck({
      userId: "user-1",
      deliveryId: "delivery-1",
      clientInstanceId: "client-b",
      deviceName: "Workstation",
      platform: "win32-x64",
      appVersion: "0.2.253",
      acknowledgedAt: new Date("2026-06-06T12:00:02.000Z"),
    })

    expect(harness.receipts).toEqual([
      expect.objectContaining({
        deliveryId: "delivery-1",
        clientInstanceId: "client-a",
        status: "sent",
        acknowledgedAt: null,
      }),
    ])
    expect(harness.deliveries).toEqual([
      expect.objectContaining({ id: "delivery-1", status: WEBHOOK_DELIVERY_STATUS.sent }),
    ])
  })

  it("keeps delivery status delivered when acknowledgement arrives before broadcast status update", async () => {
    const harness = createWebhookReceiveHarness({
      acknowledgeBeforeBroadcastStatusUpdate: true,
      broadcastResult: {
        onlineClientCount: 1,
        sentClientCount: 1,
        failedClientCount: 0,
        clientResults: [{
          clientInstanceId: "client-a",
          deviceName: "MacBook",
          platform: "darwin-arm64",
          appVersion: "0.2.253",
          sentAt: "2026-06-06T12:00:00.000Z",
          status: "sent",
        }],
      },
    })

    await harness.receive()

    expect(harness.receipts).toEqual([
      expect.objectContaining({
        deliveryId: "delivery-1",
        clientInstanceId: "client-a",
        status: "acknowledged",
      }),
    ])
    expect(harness.deliveries).toEqual([
      expect.objectContaining({ id: "delivery-1", status: WEBHOOK_DELIVERY_STATUS.delivered }),
    ])
  })

  it("rejects oversized webhook bodies before broadcasting", async () => {
    const harness = createWebhookReceiveHarness()

    await expect(harness.receive({ body: Buffer.alloc(256 * 1024 + 1) }))
      .rejects.toThrow(PayloadTooLargeException)
    expect(harness.live.broadcastToUser).not.toHaveBeenCalled()
    expect(harness.deliveries).toHaveLength(0)
  })

  it("rejects invalid JSON bodies without broadcasting or accepting delivery", async () => {
    const harness = createWebhookReceiveHarness()

    await expect(harness.receive({ body: Buffer.from("{\"broken\"") }))
      .rejects.toThrow(BadRequestException)
    expect(harness.live.broadcastToUser).not.toHaveBeenCalled()
    expect(harness.deliveries).toHaveLength(0)
  })

  it("records broadcast_failed and returns accepted response when live broadcast throws", async () => {
    const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined)
    const harness = createWebhookReceiveHarness({ broadcastError: new Error("socket send exploded") })

    try {
      await expect(harness.receive()).resolves.toMatchObject({
        response: { ok: true, deliveryId: "delivery-1" },
      })
    } finally {
      warnSpy.mockRestore()
    }

    expect(harness.deliveries).toEqual([
      expect.objectContaining({
        onlineClientCount: 0,
        sentClientCount: 0,
        failedClientCount: 0,
        status: WEBHOOK_DELIVERY_STATUS.broadcastFailed,
        error: "broadcast_failed",
      }),
    ])
  })

  it("keeps successful broadcast status when the first delivery status update fails once", async () => {
    const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined)
    const harness = createWebhookReceiveHarness({
      updateError: new Error("transient database update failed"),
      updateErrorAttempts: 1,
      broadcastResult: { onlineClientCount: 1, sentClientCount: 1, failedClientCount: 0 },
    })

    try {
      await expect(harness.receive()).resolves.toMatchObject({
        response: { ok: true, deliveryId: "delivery-1" },
      })
    } finally {
      warnSpy.mockRestore()
    }

    expect(harness.prisma.webhookDelivery.update).toHaveBeenCalledTimes(2)
    expect(harness.deliveries).toEqual([
      expect.objectContaining({
        onlineClientCount: 1,
        sentClientCount: 1,
        failedClientCount: 0,
        status: WEBHOOK_DELIVERY_STATUS.sent,
        error: null,
      }),
    ])
  })

  it("leaves a non-contradictory received marker and returns accepted response when delivery status update fails", async () => {
    const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined)
    const harness = createWebhookReceiveHarness({
      updateError: new Error("database update failed"),
      broadcastResult: { onlineClientCount: 1, sentClientCount: 1, failedClientCount: 0 },
    })

    try {
      await expect(harness.receive()).resolves.toMatchObject({
        response: { ok: true, deliveryId: "delivery-1" },
      })
    } finally {
      warnSpy.mockRestore()
    }

    expect(harness.deliveries).toEqual([
      expect.objectContaining({
        onlineClientCount: 0,
        sentClientCount: 0,
        failedClientCount: 0,
        status: WEBHOOK_DELIVERY_STATUS.received,
        error: null,
      }),
    ])
  })
})

function createWebhookReceiveHarness(input: {
  readonly enabled?: boolean
  readonly deletedAt?: Date | null
  readonly broadcastError?: Error
  readonly updateError?: Error
  readonly updateErrorAttempts?: number
  readonly acknowledgeBeforeBroadcastStatusUpdate?: boolean
  readonly broadcastResult?: {
    readonly onlineClientCount: number
    readonly sentClientCount: number
    readonly failedClientCount: number
    readonly clientResults?: readonly {
      readonly clientInstanceId: string
      readonly deviceName: string
      readonly platform: string
      readonly appVersion: string
      readonly sentAt: string
      readonly status: string
    }[]
  }
} = {}) {
  const deliveries: Array<Record<string, unknown>> = []
  const receipts: Array<Record<string, unknown>> = []
  let updateErrorsRemaining = input.updateErrorAttempts ?? (input.updateError ? Number.POSITIVE_INFINITY : 0)
  let acknowledgeBeforeBroadcastStatusUpdate = input.acknowledgeBeforeBroadcastStatusUpdate ?? false
  const prisma = createPrismaMock()
  const webhook = {
    ...baseWebhook,
    enabled: input.enabled ?? true,
    deletedAt: input.deletedAt ?? null,
    secretHash: hashWebhookSecret("whsec_secret"),
  }
  const live = {
    broadcastToUser: input.broadcastError
      ? vi.fn().mockImplementation(() => {
        throw input.broadcastError
      })
      : vi.fn().mockReturnValue(input.broadcastResult ?? {
        onlineClientCount: 0,
        sentClientCount: 0,
        failedClientCount: 0,
      }),
  }
  prisma.userWebhook.findFirst.mockImplementation(({ where }) => {
    if (where.publicId === webhook.publicId) {
      return Promise.resolve(webhook)
    }
    return Promise.resolve(null)
  })
  prisma.webhookDelivery.create.mockImplementation(({ data }) => {
    const receivedAt = new Date(Date.parse("2026-06-06T12:00:00.000Z") + deliveries.length)
    const delivery = {
      id: `delivery-${deliveries.length + 1}`,
      ...data,
      receivedAt,
    }
    deliveries.push(delivery)
    return Promise.resolve(delivery)
  })
  let service: WebhookService
  prisma.webhookDelivery.update.mockImplementation(async ({ where, data }) => {
    if (input.updateError && updateErrorsRemaining > 0) {
      updateErrorsRemaining -= 1
      return Promise.reject(input.updateError)
    }
    if (
      acknowledgeBeforeBroadcastStatusUpdate &&
      data.status === WEBHOOK_DELIVERY_STATUS.sent
    ) {
      acknowledgeBeforeBroadcastStatusUpdate = false
      await service.recordDeliveryAck({
        userId: "user-1",
        deliveryId: "delivery-1",
        clientInstanceId: "client-a",
        deviceName: "MacBook",
        platform: "darwin-arm64",
        appVersion: "0.2.253",
        acknowledgedAt: new Date("2026-06-06T12:00:02.000Z"),
      })
    }
    const index = deliveries.findIndex((delivery) => delivery.id === where.id)
    if (index >= 0) {
      deliveries[index] = { ...deliveries[index], ...data }
      return Promise.resolve(deliveries[index])
    }
    return Promise.resolve(null)
  })
  prisma.webhookDelivery.findMany.mockImplementation(({ skip = 0, take }: { skip?: number; take?: number }) => {
    const sorted = [...deliveries].sort((left, right) => {
      const leftTime = left.receivedAt instanceof Date ? left.receivedAt.getTime() : 0
      const rightTime = right.receivedAt instanceof Date ? right.receivedAt.getTime() : 0
      return rightTime - leftTime
    })
    return Promise.resolve(sorted.slice(skip, take === undefined ? undefined : skip + take).map((delivery) => ({ id: delivery.id })))
  })
  prisma.webhookDelivery.deleteMany.mockImplementation(({ where }) => {
    const ids = new Set(where.id.in)
    for (let index = deliveries.length - 1; index >= 0; index -= 1) {
      if (ids.has(deliveries[index]?.id)) deliveries.splice(index, 1)
    }
    return Promise.resolve({ count: ids.size })
  })
  prisma.webhookDelivery.updateMany.mockImplementation(({ where, data }) => {
    let count = 0
    for (let index = 0; index < deliveries.length; index += 1) {
      const delivery = deliveries[index]
      const statusFilter = where.status as { readonly not?: string } | undefined
      if (
        delivery?.id === where.id &&
        (where.userId === undefined || delivery.userId === where.userId) &&
        (statusFilter?.not === undefined || delivery.status !== statusFilter.not)
      ) {
        deliveries[index] = { ...delivery, ...data }
        count += 1
      }
    }
    return Promise.resolve({ count })
  })
  prisma.webhookDelivery.findFirst.mockImplementation(({ where }) => {
    const delivery = deliveries.find((item) => item.id === where.id && item.userId === where.userId)
    return Promise.resolve(delivery ? { id: delivery.id } : null)
  })
  prisma.webhookDeliveryReceipt.createMany.mockImplementation(({ data }) => {
    let count = 0
    for (const item of data) {
      if (receipts.some((receipt) =>
        receipt.deliveryId === item.deliveryId && receipt.clientInstanceId === item.clientInstanceId
      )) {
        continue
      }
      receipts.push({
        id: `receipt-${receipts.length + 1}`,
        ...item,
      })
      count += 1
    }
    return Promise.resolve({ count })
  })
  prisma.webhookDeliveryReceipt.upsert.mockImplementation(({ where, update, create }) => {
    const key = where.deliveryId_clientInstanceId
    const index = receipts.findIndex((receipt) =>
      receipt.deliveryId === key.deliveryId && receipt.clientInstanceId === key.clientInstanceId
    )
    if (index >= 0) {
      receipts[index] = { ...receipts[index], ...update }
      return Promise.resolve(receipts[index])
    }
    const receipt = {
      id: `receipt-${receipts.length + 1}`,
      ...create,
    }
    receipts.push(receipt)
    return Promise.resolve(receipt)
  })
  prisma.webhookDeliveryReceipt.updateMany.mockImplementation(({ where, data }) => {
    let count = 0
    for (let index = 0; index < receipts.length; index += 1) {
      const receipt = receipts[index]
      const delivery = deliveries.find((item) => item.id === receipt?.deliveryId)
      if (
        receipt?.deliveryId === where.deliveryId &&
        receipt.clientInstanceId === where.clientInstanceId &&
        (where.status === undefined || receipt.status === where.status) &&
        delivery?.userId === where.delivery?.userId
      ) {
        receipts[index] = { ...receipt, ...data }
        count += 1
      }
    }
    return Promise.resolve({ count })
  })
  prisma.webhookDeliveryReceipt.findFirst.mockImplementation(({ where }) => {
    const receipt = receipts.find((item) =>
      item.deliveryId === where.deliveryId && item.status === where.status
    )
    return Promise.resolve(receipt ? { id: receipt.id } : null)
  })

  service = new WebhookService(prisma as never, {}, undefined, live as never)

  return {
    service,
    prisma,
    live,
    deliveries,
    receipts,
    receive: (overrides: {
      readonly publicId?: string
      readonly secret?: string
      readonly method?: string
      readonly path?: string
      readonly query?: Record<string, string | readonly string[]>
      readonly headers?: Record<string, string | readonly string[]>
      readonly body?: Buffer
      readonly contentType?: string
      readonly remoteAddress?: string
      readonly publicAppUrl?: string
    } = {}) => service.receivePublicWebhook({
      publicId: overrides.publicId ?? "wh_public",
      secret: overrides.secret ?? "whsec_secret",
      method: overrides.method ?? "POST",
      path: overrides.path ?? "/webhooks/wh_public/whsec_secret",
      query: overrides.query ?? {},
      headers: overrides.headers ?? {},
      body: overrides.body ?? Buffer.from(JSON.stringify({ ok: true })),
      contentType: overrides.contentType ?? "application/json",
      remoteAddress: overrides.remoteAddress,
      publicAppUrl: overrides.publicAppUrl ?? "https://synapse.test",
    }),
  }
}
