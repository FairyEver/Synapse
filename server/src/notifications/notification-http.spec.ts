import "reflect-metadata"
import { APP_GUARD } from "@nestjs/core"
import { Test } from "@nestjs/testing"
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler"
import { PinoLogger } from "nestjs-pino"
import request from "supertest"
import { describe, expect, it, vi } from "vitest"
import { ApiKeyService } from "../api-keys/api-key.service"
import { OpenApiExceptionFilter } from "../open-api/open-api-exception.filter"
import { OpenNotificationController } from "./notification.controller"
import { NotificationService } from "./notification.service"

/** 与 `createApiKeySecret()` 同形状的固定密钥，避免夹具被密钥格式校验挡下。 */
const exampleKey = `syn_sk_${"a".repeat(43)}`
const createdAt = new Date("2026-09-24T08:00:00Z")

/**
 * 三种请求形状走真实的 Nest 路由、参数提取和请求体解析管线。
 *
 * 直接调用控制器方法测不到路由是否真的匹配、`@Param()` 是否取到路径段、表单编码是否被
 * 解析——而这些正是换掉接口形状时最容易出错的地方。
 */
async function appWith(scopes: readonly string[] = ["notification.send"]) {
  const created = vi.fn(async (input: Record<string, unknown>) => ({ id: "message-1", createdAt, ...input }))
  const moduleRef = await Test.createTestingModule({
    controllers: [OpenNotificationController],
    providers: [
      { provide: NotificationService, useValue: { create: created } },
      {
        provide: ApiKeyService,
        useValue: {
          verifyOpenApiSecret: vi.fn(async (secret: string) => (
            secret === exampleKey ? { userId: "user-1", apiKeyId: "key-1", scopes: [...scopes] } : null
          )),
          touchLastUsed: vi.fn(async () => undefined),
        },
      },
      { provide: PinoLogger, useValue: { error: vi.fn() } },
      OpenApiExceptionFilter,
    ],
  }).compile()
  const app = moduleRef.createNestApplication()
  await app.init()
  return { app, created }
}

describe("notification send over HTTP", () => {
  it("accepts the key in the JSON body", async () => {
    const { app, created } = await appWith()
    try {
      const response = await request(app.getHttpServer())
        .post("/api/open/v1/notifications")
        .send({ key: exampleKey, title: "部署完成", body: "生产环境已更新" })
        .expect(201)

      expect(response.body).toEqual({ id: "message-1", createdAt: "2026-09-24T08:00:00.000Z" })
      const input = created.mock.calls[0]?.[0] as Record<string, unknown>
      expect(input).toMatchObject({ userId: "user-1", title: "部署完成", level: "active", source: "external" })
      expect(input).not.toHaveProperty("key")
    } finally {
      await app.close()
    }
  })

  it("accepts the key in the path with a form encoded body", async () => {
    const { app, created } = await appWith()
    try {
      await request(app.getHttpServer())
        .post(`/api/open/v1/notifications/${exampleKey}`)
        .type("form")
        .send({ title: "部署完成", body: "生产环境已更新", group: "部署", level: "timeSensitive" })
        .expect(201)

      expect(created).toHaveBeenCalledWith(expect.objectContaining({ group: "部署", level: "timeSensitive" }))
    } finally {
      await app.close()
    }
  })

  it("accepts the key in the path with a JSON body", async () => {
    const { app, created } = await appWith()
    try {
      await request(app.getHttpServer())
        .post(`/api/open/v1/notifications/${exampleKey}`)
        .send({ title: "部署完成", body: "生产环境已更新" })
        .expect(201)

      expect(created).toHaveBeenCalledWith(expect.objectContaining({ title: "部署完成", body: "生产环境已更新" }))
    } finally {
      await app.close()
    }
  })

  it("accepts the key, title, and body from the URL alone", async () => {
    const { app, created } = await appWith()
    try {
      const group = encodeURIComponent("部署")
      const level = "passive"
      await request(app.getHttpServer())
        .get(`/api/open/v1/notifications/${exampleKey}/${encodeURIComponent("部署完成")}/${encodeURIComponent("生产环境已更新")}?group=${group}&level=${level}`)
        .expect(201)

      expect(created).toHaveBeenCalledWith(expect.objectContaining({
        title: "部署完成",
        body: "生产环境已更新",
        group: "部署",
        level: "passive",
      }))
    } finally {
      await app.close()
    }
  })

  it("rejects an unknown key, a missing scope, and a malformed URL", async () => {
    const { app } = await appWith()
    const scoped = await appWith(["drive.public_link.download"])
    try {
      const unknownKey = await request(app.getHttpServer())
        .post("/api/open/v1/notifications")
        .send({ key: `syn_sk_${"b".repeat(43)}`, title: "标题", body: "正文" })
        .expect(401)
      expect(unknownKey.body.error.code).toBe("INVALID_API_KEY")

      await request(app.getHttpServer())
        .post("/api/open/v1/notifications")
        .send({ title: "标题", body: "正文" })
        .expect(401)

      const missingScope = await request(scoped.app.getHttpServer())
        .post("/api/open/v1/notifications")
        .send({ key: exampleKey, title: "标题", body: "正文" })
        .expect(403)
      expect(missingScope.body.error.code).toBe("INSUFFICIENT_SCOPE")

      // 两个路径段不足以构成路径式，会落到集合根路由上并因为缺少密钥被拒。
      await request(app.getHttpServer())
        .get(`/api/open/v1/notifications/${exampleKey}/${encodeURIComponent("只有标题")}`)
        .expect(404)
    } finally {
      await app.close()
      await scoped.app.close()
    }
  })

  it("burns one shared rate limit budget across the three shapes", async () => {
    const created = vi.fn(async () => ({ id: "message-1", createdAt }))
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 60 }])],
      controllers: [OpenNotificationController],
      providers: [
        { provide: NotificationService, useValue: { create: created } },
        {
          provide: ApiKeyService,
          useValue: {
            verifyOpenApiSecret: vi.fn(async () => ({ userId: "user-1", apiKeyId: "key-1", scopes: ["notification.send"] })),
            touchLastUsed: vi.fn(async () => undefined),
          },
        },
        { provide: PinoLogger, useValue: { error: vi.fn() } },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        OpenApiExceptionFilter,
      ],
    }).compile()
    const app = moduleRef.createNestApplication()
    await app.init()
    try {
      const server = app.getHttpServer()
      const url = `/api/open/v1/notifications/${exampleKey}/${encodeURIComponent("部署完成")}/${encodeURIComponent("已更新")}`
      for (let sent = 0; sent < 60; sent += 1) {
        await request(server).get(url).expect(201)
      }
      // 额度是三种形状共用的，所以换一种形状发出的第 61 次同样被拒。
      const blocked = await request(server)
        .post(`/api/open/v1/notifications/${exampleKey}`)
        .send({ title: "部署完成", body: "已更新" })
        .expect(429)
      expect(blocked.body.error.code).toBe("RATE_LIMITED")
      expect(created).toHaveBeenCalledTimes(60)
    } finally {
      await app.close()
    }
  })

  it("refuses HEAD probes on the URL shape without creating a message", async () => {
    const { app, created } = await appWith()
    try {
      // Express 把 HEAD 也交给 @Get 的处理器；链接预览和邮件安全网关正是用它探地址。
      // HEAD 响应按规范不带 body，所以只断言状态码、错误信封的请求头和没有落库。
      const response = await request(app.getHttpServer())
        .head(`/api/open/v1/notifications/${exampleKey}/${encodeURIComponent("部署完成")}/${encodeURIComponent("已更新")}`)
        .expect(405)
      expect(response.headers["x-request-id"]).toMatch(/^req_/u)
      expect(created).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it("rejects a request body with fields outside the message schema", async () => {
    const { app } = await appWith()
    try {
      const response = await request(app.getHttpServer())
        .post(`/api/open/v1/notifications/${exampleKey}`)
        .send({ title: "标题", body: "正文", device_key: "bark-style" })
        .expect(400)
      expect(response.body.error.code).toBe("INVALID_REQUEST")
    } finally {
      await app.close()
    }
  })

  it("answers other methods on the URL shape with 404 rather than sending", async () => {
    const { app, created } = await appWith()
    try {
      // 只有 `HEAD` 会落进 `@Get` 的处理器（所以上面单测 405）；其余方法没有路由，
      // 由路由表按 404 回答。文档里的 405 只承诺 `HEAD`，这里把另一半钉住。
      await request(app.getHttpServer())
        .post(`/api/open/v1/notifications/${exampleKey}/${encodeURIComponent("标题")}/${encodeURIComponent("正文")}`)
        .expect(404)
      expect(created).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })
})
