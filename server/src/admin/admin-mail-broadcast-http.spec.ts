import "reflect-metadata"
import { Test } from "@nestjs/testing"
import type { NestExpressApplication } from "@nestjs/platform-express"
import cookieParser from "cookie-parser"
import request from "supertest"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AdminAuthGuard } from "../admin-auth/admin-auth.guard"
import { AdminAuthService } from "../admin-auth/admin-auth.service"
import { AuditLogService } from "../common/audit-log.service"
import { registerHttpBodyParsers } from "../common/http-body-parser"
import { LiveDeviceService } from "../live/live-device.service"
import { WebhookService } from "../webhooks/webhook.service"
import { AdminMailBroadcastService } from "./admin-mail-broadcast.service"
import { AdminController } from "./admin.controller"
import { AdminService } from "./admin.service"

async function fixture() {
  const auth = {
    verifySession: vi.fn(async (token: string) => token === "admin-token"
      ? { status: "active", session: { sessionId: "admin-session", expiresAt: new Date(Date.now() + 60_000) } }
      : { status: "invalid" }),
    recordRejectedSession: vi.fn(async () => undefined),
  }
  const broadcast = {
    audience: vi.fn(async () => ({ activeUsers: 2 })),
    send: vi.fn(async () => ({ messageId: "mail-1", recipientCount: 2 })),
  }
  const moduleRef = await Test.createTestingModule({
    controllers: [AdminController],
    providers: [
      AdminAuthGuard,
      { provide: AdminAuthService, useValue: auth },
      { provide: AdminMailBroadcastService, useValue: broadcast },
      { provide: AdminService, useValue: {} },
      { provide: AuditLogService, useValue: { record: vi.fn(async () => undefined) } },
      { provide: LiveDeviceService, useValue: {} },
      { provide: WebhookService, useValue: {} },
    ],
  }).compile()
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false })
  registerHttpBodyParsers(app)
  app.use(cookieParser())
  await app.init()
  return { app, broadcast }
}

describe("administrator broadcast HTTP", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("rejects ordinary-user cookies and wrong origins before sending", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.example")
    const { app, broadcast } = await fixture()
    try {
      await request(app.getHttpServer()).get("/api/admin/mail/broadcasts/audience")
        .set("Cookie", "synapse_user_session=user-token").expect(401)
      await request(app.getHttpServer()).post("/api/admin/mail/broadcasts")
        .set("Cookie", "synapse_admin_session=admin-token")
        .set("Origin", "https://other.example")
        .send({ requestId: "release:v1.0.0", subject: "更新", body: "正文" }).expect(403)
      expect(broadcast.send).not.toHaveBeenCalled()
    } finally { await app.close() }
  })

  it("routes a valid admin session to the broadcast service", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.example")
    const { app, broadcast } = await fixture()
    try {
      await request(app.getHttpServer()).get("/api/admin/mail/broadcasts/audience")
        .set("Cookie", "synapse_admin_session=admin-token").expect(200, { activeUsers: 2 })
      await request(app.getHttpServer()).post("/api/admin/mail/broadcasts")
        .set("Cookie", "synapse_admin_session=admin-token")
        .set("Origin", "https://synapse.example")
        .send({ requestId: "release:v1.0.0", subject: "更新", body: "正文" }).expect(201)
      expect(broadcast.send).toHaveBeenCalledWith({ requestId: "release:v1.0.0", subject: "更新", body: "正文" }, "admin-session", expect.any(String))
    } finally { await app.close() }
  })
})
