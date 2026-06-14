import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PATH_METADATA } from "@nestjs/common/constants"
import { WebhookDashboardController, WebhookDeliveryDashboardController, WebhookPublicController } from "./webhook.controller"
import type { WebhookService } from "./webhook.service"

function createRequest() {
  return {
    user: { id: "user-1" },
    headers: {
      host: "internal.test",
      "x-forwarded-host": "synapse.test",
      "x-forwarded-proto": "https",
    },
    protocol: "http",
    ip: "203.0.113.20",
    get: (name: string) => name.toLowerCase() === "host" ? "synapse.test" : undefined,
  }
}

beforeEach(() => {
  vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("WebhookDashboardController", () => {
  it("mounts console and legacy dashboard webhook routes", () => {
    expect(Reflect.getMetadata(PATH_METADATA, WebhookDashboardController)).toEqual([
      "/api/console",
      "/api/dashboard",
    ])
    expect(Reflect.getMetadata(PATH_METADATA, WebhookDashboardController.prototype.list)).toBe("/webhooks")
  })

  it("lists current-user webhooks", async () => {
    const service = {
      listForUser: vi.fn().mockResolvedValue({ data: [], total: 0, page: 2, pageSize: 10 }),
    }
    const controller = new WebhookDashboardController(service as unknown as WebhookService)

    await expect(controller.list({
      page: "2",
      pageSize: "10",
      sortBy: "createdAt",
      sortOrder: "desc",
    }, createRequest() as never)).resolves.toEqual({ data: [], total: 0, page: 2, pageSize: 10 })
    expect(service.listForUser).toHaveBeenCalledWith("user-1", {
      publicAppUrl: "https://synapse.test",
      pagination: { page: 2, pageSize: 10, sortBy: "createdAt", sortOrder: "desc" },
    })
  })

  it("gets a current-user webhook by id", async () => {
    const service = {
      getForUser: vi.fn().mockResolvedValue({ id: "webhook-1" }),
    }
    const controller = new WebhookDashboardController(service as unknown as WebhookService)

    await expect(controller.get("webhook-1", createRequest() as never)).resolves.toEqual({ id: "webhook-1" })
    expect(service.getForUser).toHaveBeenCalledWith("user-1", "webhook-1", "https://synapse.test")
  })

  it("creates webhooks with configured public URLs", async () => {
    const service = {
      createForUser: vi.fn().mockResolvedValue({ url: "https://synapse.test/webhooks/wh_id/whsec_secret" }),
    }
    const controller = new WebhookDashboardController(service as unknown as WebhookService)

    await expect(controller.create({ name: " GitHub " }, createRequest() as never))
      .resolves
      .toEqual({ url: "https://synapse.test/webhooks/wh_id/whsec_secret" })
    expect(service.createForUser).toHaveBeenCalledWith(
      "user-1",
      { name: "GitHub" },
      "https://synapse.test",
      "203.0.113.20",
    )
  })

  it("rejects invalid create bodies", async () => {
    const service = {
      createForUser: vi.fn(),
    }
    const controller = new WebhookDashboardController(service as unknown as WebhookService)

    expect(() => controller.create({ name: "", extra: true }, createRequest() as never))
      .toThrow("Webhook create request is invalid")
    expect(service.createForUser).not.toHaveBeenCalled()
  })

  it("updates webhooks for the current user", async () => {
    const service = {
      updateForUser: vi.fn().mockResolvedValue({ id: "webhook-1" }),
    }
    const controller = new WebhookDashboardController(service as unknown as WebhookService)

    await expect(controller.update("webhook-1", { name: "Deploy", enabled: false }, createRequest() as never))
      .resolves
      .toEqual({ id: "webhook-1" })
    expect(service.updateForUser).toHaveBeenCalledWith(
      "user-1",
      "webhook-1",
      { name: "Deploy", enabled: false },
      "https://synapse.test",
      "203.0.113.20",
    )
  })

  it("rejects empty update bodies", () => {
    const service = {
      updateForUser: vi.fn(),
    }
    const controller = new WebhookDashboardController(service as unknown as WebhookService)

    expect(() => controller.update("webhook-1", {}, createRequest() as never))
      .toThrow("Webhook update request is invalid")
    expect(service.updateForUser).not.toHaveBeenCalled()
  })

  it("resets webhook secrets with configured public URLs", async () => {
    const service = {
      resetSecret: vi.fn().mockResolvedValue({ url: "https://synapse.test/webhooks/wh_id/whsec_new" }),
    }
    const controller = new WebhookDashboardController(service as unknown as WebhookService)

    await expect(controller.resetSecret("webhook-1", createRequest() as never))
      .resolves
      .toEqual({ url: "https://synapse.test/webhooks/wh_id/whsec_new" })
    expect(service.resetSecret).toHaveBeenCalledWith("user-1", "webhook-1", "https://synapse.test", "203.0.113.20")
  })

  it("rejects webhook URL generation when APP_PUBLIC_URL is missing", async () => {
    const service = {
      resetSecret: vi.fn(),
    }
    const controller = new WebhookDashboardController(service as unknown as WebhookService)

    vi.stubEnv("APP_PUBLIC_URL", "")

    expect(() => controller.resetSecret("webhook-1", createRequest() as never))
      .toThrow("APP_PUBLIC_URL 未配置，无法生成公开链接。")
    expect(service.resetSecret).not.toHaveBeenCalled()
  })

  it("deletes and lists deliveries for the current user", async () => {
    const service = {
      deleteForUser: vi.fn().mockResolvedValue({ ok: true }),
      listDeliveriesForUser: vi.fn().mockResolvedValue([]),
    }
    const controller = new WebhookDashboardController(service as unknown as WebhookService)

    await expect(controller.delete("webhook-1", createRequest() as never)).resolves.toEqual({ ok: true })
    await expect(controller.listDeliveries("webhook-1", createRequest() as never)).resolves.toEqual([])
    expect(service.deleteForUser).toHaveBeenCalledWith("user-1", "webhook-1", "203.0.113.20")
    expect(service.listDeliveriesForUser).toHaveBeenCalledWith("user-1", "webhook-1")
  })
})

describe("WebhookDeliveryDashboardController", () => {
  it("mounts console and legacy dashboard webhook delivery routes", () => {
    expect(Reflect.getMetadata(PATH_METADATA, WebhookDeliveryDashboardController)).toEqual([
      "/api/console",
      "/api/dashboard",
    ])
    expect(Reflect.getMetadata(PATH_METADATA, WebhookDeliveryDashboardController.prototype.list)).toBe("/webhook-deliveries")
  })

  it("lists current-user delivery history with pagination and filters", async () => {
    const service = {
      listDeliveryHistoryForUser: vi.fn().mockResolvedValue({ data: [], total: 0, page: 2, pageSize: 10 }),
    }
    const controller = new WebhookDeliveryDashboardController(service as unknown as WebhookService)

    await expect(controller.list({
      page: "2",
      pageSize: "10",
      sortBy: "receivedAt",
      sortOrder: "desc",
      webhookId: "webhook-1",
      status: "delivered",
      from: "2026-06-07",
      to: "2026-06-08",
    }, createRequest() as never)).resolves.toEqual({ data: [], total: 0, page: 2, pageSize: 10 })

    expect(service.listDeliveryHistoryForUser).toHaveBeenCalledWith("user-1", {
      pagination: { page: 2, pageSize: 10, sortBy: "receivedAt", sortOrder: "desc" },
      filters: {
        webhookId: "webhook-1",
        status: "delivered",
        from: "2026-06-07",
        to: "2026-06-08",
      },
    })
  })
})

describe("WebhookPublicController", () => {
  it("maps public webhook requests to the receive service without auth guard metadata", async () => {
    const service = {
      receivePublicWebhook: vi.fn().mockResolvedValue({
        response: { ok: true, deliveryId: "delivery-1", acceptedAt: "2026-06-06T12:00:00.000Z" },
      }),
    }
    const controller = new WebhookPublicController(service as unknown as WebhookService)
    const request = {
      method: "POST",
      path: "/webhooks/wh_public/whsec_secret",
      query: { event: "push" },
      headers: { "content-type": "application/json" },
      body: Buffer.from("{\"ok\":true}"),
      ip: "203.0.113.30",
      protocol: "http",
      get: (name: string) => name.toLowerCase() === "host" ? "synapse.test" : undefined,
    }

    await expect(controller.receive("wh_public", "whsec_secret", request as never))
      .resolves
      .toEqual({ ok: true, deliveryId: "delivery-1", acceptedAt: "2026-06-06T12:00:00.000Z" })

    expect(service.receivePublicWebhook).toHaveBeenCalledWith(expect.objectContaining({
      publicId: "wh_public",
      secret: "whsec_secret",
      method: "POST",
      path: "/webhooks/wh_public/whsec_secret",
      query: { event: "push" },
      body: Buffer.from("{\"ok\":true}"),
      contentType: "application/json",
      remoteAddress: "203.0.113.30",
      publicAppUrl: "https://synapse.test",
    }))
    expect(Reflect.getMetadata("__guards__", WebhookPublicController)).toBeUndefined()
    expect(Reflect.getMetadata("__httpCode__", controller.receive)).toBe(202)
  })

  it("rejects public webhook URL generation when APP_PUBLIC_URL is missing", async () => {
    const service = {
      receivePublicWebhook: vi.fn(),
    }
    const controller = new WebhookPublicController(service as unknown as WebhookService)
    const request = {
      method: "POST",
      path: "/webhooks/wh_public/whsec_secret",
      query: {},
      headers: { host: "evil.example.com" },
      body: Buffer.from("{}"),
      ip: "203.0.113.30",
      protocol: "https",
      get: (name: string) => name.toLowerCase() === "host" ? "evil.example.com" : undefined,
    }

    vi.stubEnv("APP_PUBLIC_URL", "")

    await expect(controller.receive("wh_public", "whsec_secret", request as never))
      .rejects
      .toThrow("APP_PUBLIC_URL 未配置，无法生成公开链接。")
    expect(service.receivePublicWebhook).not.toHaveBeenCalled()
  })
})
