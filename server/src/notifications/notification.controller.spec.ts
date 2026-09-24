import { describe, expect, it, vi } from "vitest"
import { NotificationController, OpenNotificationController } from "./notification.controller"

function controller(scopes: string[]) {
  const service = { create: vi.fn(async () => ({ id: "message-1", createdAt: new Date("2026-09-23T08:00:00Z") })) }
  const request = { openApiPrincipal: { userId: "user-1", apiKeyId: "key-1", scopes } }
  return { controller: new OpenNotificationController(service as never), service, request }
}

describe("OpenNotificationController", () => {
  it("requires an isolated notification.send scope", async () => {
    const { controller: endpoint, request } = controller(["drive.public_link.download"])
    await expect(endpoint.create(request as never, { title: "测试", body: "正文" })).rejects.toMatchObject({ statusCode: 403 })
  })

  it("rejects non-HTTPS URLs and invalid retry keys", async () => {
    const { controller: endpoint, request } = controller(["notification.send"])
    await expect(endpoint.create(request as never, { title: "测试", body: "正文", url: "http://example.com" })).rejects.toMatchObject({ statusCode: 400 })
    await expect(endpoint.create(request as never, { title: "测试", body: "正文" }, "short")).rejects.toMatchObject({ statusCode: 400 })
  })

  it("passes a key-specific idempotency identity to persistence", async () => {
    const { controller: endpoint, request, service } = controller(["notification.send"])
    await expect(endpoint.create(request as never, { title: "部署完成", body: "已更新" }, "deploy-001")).resolves.toEqual({ id: "message-1", createdAt: "2026-09-23T08:00:00.000Z" })
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", sourceKey: "external:key-1:deploy-001" }))
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
})
