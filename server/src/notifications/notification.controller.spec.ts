import type { ExecutionContext } from "@nestjs/common"
import { THROTTLER_KEY_GENERATOR } from "@nestjs/throttler/dist/throttler.constants"
import { describe, expect, it, vi } from "vitest"
import { NotificationController, OpenNotificationController, notificationThrottleKey } from "./notification.controller"

/** 与 `createApiKeySecret()` 同形状的固定密钥，避免测试夹具被密钥格式校验挡下。 */
const exampleKey = `syn_sk_${"a".repeat(43)}`

function controller(scopes: string[] = ["notification.send"]) {
  const service = {
    create: vi.fn(async (_input: Record<string, unknown>) => ({ id: "message-1", createdAt: new Date("2026-09-23T08:00:00Z") })),
  }
  const request = { openApiPrincipal: { userId: "user-1", apiKeyId: "key-1", scopes } }
  return { controller: new OpenNotificationController(service as never), service, request }
}

describe("OpenNotificationController", () => {
  it("sends with the key and message in one request body", async () => {
    const { controller: endpoint, request, service } = controller()
    await expect(endpoint.createWithKeyInBody(request as never, { key: exampleKey, title: "部署完成", body: "已更新" }))
      .resolves.toEqual({ id: "message-1", createdAt: "2026-09-23T08:00:00.000Z" })
    const created = service.create.mock.calls[0]?.[0] as Record<string, unknown>
    expect(created).toMatchObject({ title: "部署完成", body: "已更新", level: "active", source: "external" })
    // 密钥只用于鉴权，不能跟着消息进入持久化。
    expect(created).not.toHaveProperty("key")
  })

  it("sends with the key in the path and the message in the body", async () => {
    const { controller: endpoint, request, service } = controller()
    await endpoint.createWithKeyInPath(request as never, { title: "部署完成", body: "已更新", group: "部署", level: "timeSensitive" })
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ group: "部署", level: "timeSensitive" }))
  })

  it("sends from a URL alone, defaulting the level", async () => {
    const { controller: endpoint, request, service } = controller()
    await endpoint.createFromPath(request as never, { key: exampleKey, title: "部署完成", body: "已更新" }, {})
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ title: "部署完成", body: "已更新", level: "active" }))
  })

  it("lets the URL query override the message fields it carries", async () => {
    const { controller: endpoint, request, service } = controller()
    await endpoint.createFromPath(
      request as never,
      { key: exampleKey, title: "部署完成", body: "已更新" },
      { group: "部署", level: "passive", url: "https://example.com/releases" },
    )
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({
      group: "部署",
      level: "passive",
      url: "https://example.com/releases",
    }))
  })

  it("requires an isolated notification.send scope before validating input", async () => {
    const { controller: endpoint, request } = controller(["drive.public_link.download"])
    await expect(endpoint.createWithKeyInBody(request as never, { title: "" })).rejects.toMatchObject({ statusCode: 403 })
  })

  it("rejects non-HTTPS URLs, unknown fields, and invalid retry keys", async () => {
    const { controller: endpoint, request } = controller()
    const message = { title: "测试", body: "正文" }
    await expect(endpoint.createWithKeyInBody(request as never, { ...message, key: exampleKey, url: "http://example.com" })).rejects.toMatchObject({ statusCode: 400 })
    await expect(endpoint.createWithKeyInBody(request as never, { ...message, key: exampleKey, extra: 1 })).rejects.toMatchObject({ statusCode: 400 })
    await expect(endpoint.createWithKeyInPath(request as never, { ...message, title: "x".repeat(65) })).rejects.toMatchObject({ statusCode: 400 })
    await expect(endpoint.createWithKeyInPath(request as never, message, "short")).rejects.toMatchObject({ statusCode: 400 })
    // `critical` 是外部推送服务的级别，Synapse 只认自己的三个值。
    await expect(endpoint.createFromPath(request as never, { key: exampleKey, ...message }, { level: "critical" })).rejects.toMatchObject({ statusCode: 400 })
  })

  it("passes a key-specific idempotency identity to persistence", async () => {
    const { controller: endpoint, request, service } = controller()
    await endpoint.createWithKeyInPath(request as never, { title: "部署完成", body: "已更新" }, "deploy-001")
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", sourceKey: "external:key-1:deploy-001" }))
  })

  it("refuses HEAD probes on the URL shape without sending anything", async () => {
    const { controller: endpoint, request, service } = controller()
    const head = { ...request, method: "HEAD" }
    await expect(endpoint.createFromPath(head as never, { key: exampleKey, title: "标题", body: "正文" }, {}))
      .rejects.toMatchObject({ statusCode: 405, code: "METHOD_NOT_ALLOWED" })
    expect(service.create).not.toHaveBeenCalled()
  })
})

describe("notification throttle key", () => {
  const context = { getClass: () => OpenNotificationController } as never as ExecutionContext

  it("ignores the handler so the three send shapes share one bucket", () => {
    // ThrottlerGuard 默认的键会带上 handler 名，三个路由各占一份额度。
    expect(notificationThrottleKey(context, "203.0.113.7", "default")).toBe(
      notificationThrottleKey(context, "203.0.113.7", "default"),
    )
    expect(notificationThrottleKey(context, "203.0.113.7", "default")).not.toBe(
      notificationThrottleKey(context, "198.51.100.9", "default"),
    )
  })

  it("is what all three send shapes declare", () => {
    // 用库自己的常量读元数据，避免和 ThrottlerGuard 读取的键名各写一份。
    const metadataKey = `${THROTTLER_KEY_GENERATOR}default`
    for (const handler of ["createWithKeyInBody", "createWithKeyInPath", "createFromPath"]) {
      expect(
        Reflect.getMetadata(metadataKey, OpenNotificationController.prototype[handler as never]),
        handler,
      ).toBe(notificationThrottleKey)
    }
  })
})

describe("NotificationController", () => {
  it("limits bulk deletion to all or pending messages for the signed-in user", async () => {
    const service = { deleteAll: vi.fn(async () => undefined) }
    const endpoint = new NotificationController(service as never)
    const request = { user: { id: "user-1" } }

    await expect(endpoint.deleteAll(request as never, { filter: "pending" })).resolves.toEqual({ ok: true })
    expect(service.deleteAll).toHaveBeenCalledWith("user-1", "pending")
    await expect(endpoint.deleteAll(request as never, { filter: "unread" })).rejects.toMatchObject({ status: 400 })
    expect(service.deleteAll).toHaveBeenCalledOnce()
  })

  it("writes desktop-owned sources to the caller's own queue", async () => {
    for (const source of ["system-notifier", "terminal-complete"] as const) {
      const service = { create: vi.fn(async () => ({ id: "message-1" })) }
      const endpoint = new NotificationController(service as never)
      const request = { user: { id: "user-1" } }

      await expect(endpoint.createFromDesktop(request as never, { source, title: "标题", body: "正文" }))
        .resolves.toEqual({ id: "message-1" })
      expect(service.create).toHaveBeenCalledWith({ source, title: "标题", body: "正文", userId: "user-1" })
    }
  })

  it("refuses sources the desktop does not own", async () => {
    const service = { create: vi.fn(async () => ({ id: "message-1" })) }
    const endpoint = new NotificationController(service as never)
    const request = { user: { id: "user-1" } }

    for (const source of ["external", "terminal-attention", "meeting-transcription"]) {
      await expect(endpoint.createFromDesktop(request as never, { source, title: "标题", body: "正文" }))
        .rejects.toMatchObject({ status: 400 })
    }
    expect(service.create).not.toHaveBeenCalled()
  })

  it("keeps the legacy path on the same handler", () => {
    // 已发布的桌面构建仍在打 /internal，它必须和新名字落在同一个处理器上。
    expect(Reflect.getMetadata("path", NotificationController.prototype.createFromDesktop))
      .toEqual(["desktop", "internal"])
  })
})
