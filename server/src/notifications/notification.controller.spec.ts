import type { ExecutionContext } from "@nestjs/common"
import { THROTTLER_KEY_GENERATOR } from "@nestjs/throttler/dist/throttler.constants"
import { NOTIFICATION_SOURCES } from "@synapse/shared"
import { PassThrough, Readable } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { NotificationController, OpenNotificationController, notificationThrottleKey } from "./notification.controller"
import { NotificationImageInvalidTypeError, NotificationImageUnavailableError } from "./notification-image.service"

/** 与 `createApiKeySecret()` 同形状的固定密钥，避免测试夹具被密钥格式校验挡下。 */
const exampleKey = `syn_sk_${"a".repeat(43)}`

function controller(scopes: string[] = ["notification.send"]) {
  const service = {
    create: vi.fn(async (_input: Record<string, unknown>) => ({ id: "message-1", createdAt: new Date("2026-09-23T08:00:00Z") })),
  }
  const request = { openApiPrincipal: { userId: "user-1", apiKeyId: "key-1", scopes } }
  return { controller: new OpenNotificationController(service as never), service, request }
}

describe("NotificationController", () => {
  it("accepts each existing notification source and rejects unknown categories", async () => {
    const page = { items: [], nextCursor: null }
    const service = { list: vi.fn(async () => page) }
    const endpoint = new NotificationController(service as never, {} as never)
    const request = { user: { id: "reader" } }
    for (const source of NOTIFICATION_SOURCES) {
      await expect(endpoint.list(request as never, { source, filter: "unread", cursor: "n1" })).resolves.toEqual(page)
      expect(service.list).toHaveBeenLastCalledWith("reader", { source, filter: "unread", cursor: "n1" })
    }
    await expect(endpoint.list(request as never, { source: "unknown" })).rejects.toMatchObject({ status: 400 })
    expect(service.list).toHaveBeenCalledTimes(NOTIFICATION_SOURCES.length)
  })

  it("keeps old mark-read calls working and accepts an explicit mark-unread request", async () => {
    const service = { markRead: vi.fn(async () => undefined) }
    const endpoint = new NotificationController(service as never, {} as never)
    const request = { user: { id: "reader" } }
    await endpoint.markRead(request as never, "n1", undefined)
    await endpoint.markRead(request as never, "n1", { read: false })
    expect(service.markRead).toHaveBeenNthCalledWith(1, "reader", "n1", true)
    expect(service.markRead).toHaveBeenNthCalledWith(2, "reader", "n1", false)
    await expect(endpoint.markRead(request as never, "n1", { read: "false" })).rejects.toMatchObject({ status: 400 })
  })

  it("rejects a non-boolean copyOnTap on the desktop write path", async () => {
    const service = { create: vi.fn(async () => ({ id: "n1", createdAt: new Date("2026-10-15T08:00:00Z") })) }
    const endpoint = new NotificationController(service as never, {} as never)
    const request = { user: { id: "writer" } }

    await endpoint.createFromDesktop(request as never, {
      source: "system-notifier", title: "标题", body: "正文", copyOnTap: true,
    })
    expect(service.create).toHaveBeenLastCalledWith(expect.objectContaining({ copyOnTap: true }))

    await expect(endpoint.createFromDesktop(request as never, {
      source: "system-notifier", title: "标题", body: "正文", copyOnTap: "true",
    })).rejects.toMatchObject({ status: 400 })
  })
})

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

  it("does not let URL query fields forge Todo ownership metadata", async () => {
    const { controller: endpoint, request, service } = controller()
    for (const query of [{ source: "todo-reminder" }, { sourceKey: "todo:id:1" }, { target: { id: "todo" } }]) {
      await endpoint.createFromPath(request as never, { key: exampleKey, title: "事项", body: "正文" }, query)
      const created = service.create.mock.calls.at(-1)?.[0]
      expect(created).toMatchObject({ source: "external", sourceKey: undefined })
      expect(created).not.toHaveProperty("target")
    }
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

  it("sends copyOnTap through both request-body shapes", async () => {
    const { controller: endpoint, service, request } = controller()
    const message = { title: "标题", body: "正文", copyOnTap: true }

    // 整体式：密钥与消息在同一个请求体里。
    await endpoint.createWithKeyInBody(request as never, { ...message, key: exampleKey })
    expect(service.create).toHaveBeenLastCalledWith(expect.objectContaining({ copyOnTap: true }))

    // 表单式：密钥是 URL 段，消息来自请求体。
    await endpoint.createWithKeyInPath(request as never, message)
    expect(service.create).toHaveBeenLastCalledWith(expect.objectContaining({ copyOnTap: true }))
  })

  it("treats only a literal 1 in the path shape's query as copy-on-tap", async () => {
    const { controller: endpoint, service, request } = controller()
    const path = { key: exampleKey, title: "标题", body: "正文" }

    await endpoint.createFromPath(request as never, path, { copyOnTap: "1" })
    expect(service.create).toHaveBeenLastCalledWith(expect.objectContaining({ copyOnTap: true }))

    // 拼错、留空、重复成数组都按缺省处理：这条形状的价值是粘上去就能用，
    // 不该因为一个开关把整条链接判成无效。断言的是「没有 true」，不是「等于 false」——
    // 关掉与没写只有一个表示。
    for (const wrong of ["yes", "", "0", ["1", "0"]]) {
      await endpoint.createFromPath(request as never, path, { copyOnTap: wrong })
      const lastInput = service.create.mock.calls.at(-1)?.[0] as Record<string, unknown>
      expect(lastInput.copyOnTap).toBeUndefined()
    }
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
    const endpoint = new NotificationController(service as never, {} as never)
    const request = { user: { id: "user-1" } }

    await expect(endpoint.deleteAll(request as never, { filter: "pending" })).resolves.toEqual({ ok: true })
    expect(service.deleteAll).toHaveBeenCalledWith("user-1", "pending")
    await expect(endpoint.deleteAll(request as never, { filter: "unread" })).rejects.toMatchObject({ status: 400 })
    expect(service.deleteAll).toHaveBeenCalledOnce()
  })

  it("writes desktop-owned sources to the caller's own queue", async () => {
    for (const source of ["system-notifier", "terminal-complete"] as const) {
      const service = { create: vi.fn(async () => ({ id: "message-1" })) }
      const endpoint = new NotificationController(service as never, {} as never)
      const request = { user: { id: "user-1" } }

      await expect(endpoint.createFromDesktop(request as never, { source, title: "标题", body: "正文" }))
        .resolves.toEqual({ id: "message-1" })
      expect(service.create).toHaveBeenCalledWith({ source, title: "标题", body: "正文", userId: "user-1" })
    }
  })

  it("carries an optional link and group without widening the desktop-owned sources", async () => {
    const service = { create: vi.fn(async () => ({ id: "message-1" })) }
    const endpoint = new NotificationController(service as never, {} as never)
    const request = { user: { id: "user-1" } }

    await expect(endpoint.createFromDesktop(request as never, {
      source: "system-notifier",
      title: "周报已生成",
      body: "点开查看完整报告",
      group: "云盘分享",
      url: "https://synapse.d2.pub/share/shr_9Kx2M4Qr7Tv1Bw8Zc3Nd6Fh5Jp0Ls",
    })).resolves.toEqual({ id: "message-1" })
    expect(service.create).toHaveBeenCalledWith({
      source: "system-notifier",
      title: "周报已生成",
      body: "点开查看完整报告",
      group: "云盘分享",
      url: "https://synapse.d2.pub/share/shr_9Kx2M4Qr7Tv1Bw8Zc3Nd6Fh5Jp0Ls",
      userId: "user-1",
    })
  })

  it("refuses a link the desktop could not open on a phone", async () => {
    const service = { create: vi.fn(async () => ({ id: "message-1" })) }
    const endpoint = new NotificationController(service as never, {} as never)
    const request = { user: { id: "user-1" } }

    for (const url of ["http://example.com/x", "ftp://example.com/x", "not a url"]) {
      await expect(endpoint.createFromDesktop(request as never, {
        source: "system-notifier", title: "标题", body: "正文", url,
      })).rejects.toMatchObject({ status: 400 })
    }
    await expect(endpoint.createFromDesktop(request as never, {
      source: "system-notifier", title: "标题", body: "正文", group: "云".repeat(65),
    })).rejects.toMatchObject({ status: 400 })
    expect(service.create).not.toHaveBeenCalled()
  })

  it("refuses sources the desktop does not own", async () => {
    const service = { create: vi.fn(async () => ({ id: "message-1" })) }
    const endpoint = new NotificationController(service as never, {} as never)
    const request = { user: { id: "user-1" } }

    for (const source of ["external", "terminal-attention", "meeting-transcription", "todo-reminder"]) {
      await expect(endpoint.createFromDesktop(request as never, { source, title: "标题", body: "正文" }))
        .rejects.toMatchObject({ status: 400 })
    }
    expect(service.create).not.toHaveBeenCalled()
  })

  it("accepts an imageId on the desktop write path and rejects non-string values", async () => {
    const create = vi.fn(async (input: Record<string, unknown>) => ({ id: "n1", createdAt: new Date("2026-10-28T08:00:00Z"), ...input }))
    const endpoint = new NotificationController({ create } as never, {} as never)
    const request = { user: { id: "writer" } }
    await endpoint.createFromDesktop(request as never, { source: "system-notifier", title: "图", body: "看图", imageId: "img-1" })
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ imageId: "img-1" }))
    await expect(endpoint.createFromDesktop(request as never, { source: "system-notifier", title: "图", body: "看图", imageId: 1 }))
      .rejects.toMatchObject({ status: 400 })
  })

  it("answers 400 when the claimed image is unavailable for this caller", async () => {
    // 认领失败有三种：不属于本人、已被别的通知认领、暂存过期。服务层统一抛这一种错误，
    // 这里转成 400；桌面拿到的必须是「图片不可用」，而不是一个 500。
    const create = vi.fn(async () => { throw new NotificationImageUnavailableError() })
    const endpoint = new NotificationController({ create } as never, {} as never)
    const request = { user: { id: "writer" } }

    await expect(endpoint.createFromDesktop(request as never, {
      source: "system-notifier", title: "图", body: "看图", imageId: "img-1",
    })).rejects.toMatchObject({ status: 400 })
  })

  it("lets every other write failure through unchanged", async () => {
    // 只有认领这一件事该被改写成 400；别的失败照旧抛出去，免得把真实故障伪装成参数问题。
    const failure = new Error("database is down")
    const create = vi.fn(async () => { throw failure })
    const endpoint = new NotificationController({ create } as never, {} as never)
    const request = { user: { id: "writer" } }

    await expect(endpoint.createFromDesktop(request as never, {
      source: "system-notifier", title: "图", body: "看图",
    })).rejects.toBe(failure)
  })

  it("keeps the legacy path on the same handler", () => {
    // 已发布的桌面构建仍在打 /internal，它必须和新名字落在同一个处理器上。
    expect(Reflect.getMetadata("path", NotificationController.prototype.createFromDesktop))
      .toEqual(["desktop", "internal"])
  })

  it("streams the notification image only when the record belongs to the caller", async () => {
    const imageFor = vi.fn(async () => ({ stream: Readable.from([Buffer.from([1])]), mimeType: "image/png", byteSize: 1 }))
    const endpoint = new NotificationController({ imageFor } as never, {} as never)
    const headers: Record<string, string> = {}
    // `PassThrough` 本身没有 `setHeader`；补一个只为记录响应头的同名方法。
    const response = new PassThrough() as PassThrough & { setHeader(name: string, value: string): PassThrough }
    response.setHeader = (name, value) => { headers[name] = value; return response }
    await endpoint.notificationImage({ user: { id: "u1" } } as never, response as never, "n1")
    expect(headers["Content-Type"]).toBe("image/png")
    expect(headers["Cache-Control"]).toBe("private, no-store")
    expect(imageFor).toHaveBeenCalledWith("u1", "n1")
  })

  it("returns 404 when the notification has no image", async () => {
    const endpoint = new NotificationController({ imageFor: vi.fn(async () => null) } as never, {} as never)
    await expect(endpoint.notificationImage({ user: { id: "u1" } } as never, {} as never, "n1"))
      .rejects.toMatchObject({ status: 404 })
  })
})

it("uploads raw image bytes and rejects an unsupported payload", async () => {
  const stage = vi.fn(async (_userId: string, bytes: Buffer) => ({ id: "img-1", mimeType: "image/png", byteSize: bytes.length }))
  const endpoint = new NotificationController({} as never, { stage } as never)
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  await expect(endpoint.uploadImage(
    Object.assign(Readable.from([png]), { user: { id: "u1" } }) as never,
  )).resolves.toMatchObject({ imageId: "img-1", mimeType: "image/png" })
  expect(stage).toHaveBeenLastCalledWith("u1", png)
})

it("rejects bytes the image service does not recognize as an image with a 400", async () => {
  const stage = vi.fn(async () => { throw new NotificationImageInvalidTypeError() })
  const endpoint = new NotificationController({} as never, { stage } as never)
  await expect(endpoint.uploadImage(
    Object.assign(Readable.from([Buffer.from("not an image")]), { user: { id: "u1" } }) as never,
  )).rejects.toMatchObject({ status: 400 })
  expect(stage).toHaveBeenCalledOnce()
})
