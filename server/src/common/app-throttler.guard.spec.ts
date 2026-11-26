import "reflect-metadata"
import { Controller, Get, Req, UnauthorizedException, UseGuards } from "@nestjs/common"
import { APP_GUARD } from "@nestjs/core"
import { Test } from "@nestjs/testing"
import { Throttle, ThrottlerModule } from "@nestjs/throttler"
import cookieParser from "cookie-parser"
import request from "supertest"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UserAuthGuard, type AuthenticatedUserRequest } from "../auth/user-auth.guard"
import { UserAuthService } from "../auth/user-auth.service"
import { userSessionCookieName } from "../auth/user-web-session"
import { AppThrottlerGuard } from "./app-throttler.guard"

@Controller("/api/test-throttle")
class TestThrottleController {
  @UseGuards(UserAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 2 } })
  @Get("/protected")
  protectedEndpoint(@Req() req: AuthenticatedUserRequest) {
    return { userId: req.user!.id }
  }

  @Throttle({ default: { ttl: 60_000, limit: 2 } })
  @Get("/public")
  publicEndpoint() {
    return { ok: true }
  }
}

async function createTestApp() {
  const resolveWebSessionUserId = vi.fn(async (token: string) => {
    if (token === "cookie-a") return "user-a"
    if (token === "cookie-b") return "user-b"
    return null
  })
  const verifyWebSession = vi.fn(async (token: string) => {
    if (token === "cookie-a") return { userId: "user-a", sessionId: "session-a", expiresAt: new Date(Date.now() + 60_000) }
    if (token === "cookie-b") return { userId: "user-b", sessionId: "session-b", expiresAt: new Date(Date.now() + 60_000) }
    return null
  })
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 2 }])],
    controllers: [TestThrottleController],
    providers: [
      UserAuthGuard,
      { provide: APP_GUARD, useClass: AppThrottlerGuard },
      {
        provide: UserAuthService,
        useValue: {
          resolveAccessTokenSubject: vi.fn((token: string) => {
            if (token === "token-a") return "user-a"
            if (token === "token-b") return "user-b"
            return null
          }),
          verifyAccessToken: vi.fn(async (token: string) => {
            if (token === "token-a") return { userId: "user-a" }
            if (token === "token-b") return { userId: "user-b" }
            throw new UnauthorizedException()
          }),
          resolveWebSessionUserId,
          verifyWebSession,
        },
      },
    ],
  }).compile()
  const app = moduleRef.createNestApplication()
  app.getHttpAdapter().getInstance().set("trust proxy", "loopback")
  app.use(cookieParser())
  await app.init()
  await app.listen(0, "127.0.0.1")
  return { app, resolveWebSessionUserId, verifyWebSession }
}

describe("AppThrottlerGuard", () => {
  beforeEach(() => vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test"))
  afterEach(() => vi.unstubAllEnvs())

  it("isolates authenticated Bearer users sharing the same egress IP", async () => {
    const { app } = await createTestApp()
    try {
      const server = app.getHttpServer()
      await request(server).get("/api/test-throttle/protected").auth("token-a", { type: "bearer" }).set("X-Forwarded-For", "61.50.102.122").expect(200)
      await request(server).get("/api/test-throttle/protected").auth("token-a", { type: "bearer" }).set("X-Forwarded-For", "61.50.102.122").expect(200)
      await request(server).get("/api/test-throttle/protected").auth("token-a", { type: "bearer" }).set("X-Forwarded-For", "61.50.102.122").expect(429)

      // Different user behind the exact same office NAT IP keeps an independent quota.
      const resB = await request(server).get("/api/test-throttle/protected").auth("token-b", { type: "bearer" }).set("X-Forwarded-For", "61.50.102.122").expect(200)
      expect(resB.body).toEqual({ userId: "user-b" })
    } finally {
      await app.close()
    }
  })

  it("shares the same user quota across different IP addresses", async () => {
    const { app } = await createTestApp()
    try {
      const server = app.getHttpServer()
      await request(server).get("/api/test-throttle/protected").auth("token-a", { type: "bearer" }).set("X-Forwarded-For", "203.0.113.1").expect(200)
      await request(server).get("/api/test-throttle/protected").auth("token-a", { type: "bearer" }).set("X-Forwarded-For", "203.0.113.2").expect(200)
      await request(server).get("/api/test-throttle/protected").auth("token-a", { type: "bearer" }).set("X-Forwarded-For", "203.0.113.3").expect(429)
    } finally {
      await app.close()
    }
  })

  it("isolates web session cookie users behind the same IP without invoking verifyWebSession during throttling", async () => {
    const { app, resolveWebSessionUserId, verifyWebSession } = await createTestApp()
    try {
      const server = app.getHttpServer()
      await request(server).get("/api/test-throttle/protected").set("Cookie", `${userSessionCookieName}=cookie-a`).set("Origin", "https://synapse.test").set("X-Forwarded-For", "61.50.102.122").expect(200)
      await request(server).get("/api/test-throttle/protected").set("Cookie", `${userSessionCookieName}=cookie-a`).set("Origin", "https://synapse.test").set("X-Forwarded-For", "61.50.102.122").expect(200)
      await request(server).get("/api/test-throttle/protected").set("Cookie", `${userSessionCookieName}=cookie-a`).set("Origin", "https://synapse.test").set("X-Forwarded-For", "61.50.102.122").expect(429)

      // The 3rd request was rejected at throttle time before verifyWebSession (which writes lastUsedAt).
      expect(resolveWebSessionUserId).toHaveBeenCalledTimes(3)
      expect(verifyWebSession).toHaveBeenCalledTimes(2)

      const resB = await request(server).get("/api/test-throttle/protected").set("Cookie", `${userSessionCookieName}=cookie-b`).set("Origin", "https://synapse.test").set("X-Forwarded-For", "61.50.102.122").expect(200)
      expect(resB.body).toEqual({ userId: "user-b" })
    } finally {
      await app.close()
    }
  })

  it("falls back to IP throttling for invalid Bearer tokens and never mixes into valid user quotas", async () => {
    const { app } = await createTestApp()
    try {
      const server = app.getHttpServer()
      await request(server).get("/api/test-throttle/protected").auth("forged-1", { type: "bearer" }).set("X-Forwarded-For", "198.51.100.10").expect(401)
      await request(server).get("/api/test-throttle/protected").auth("forged-2", { type: "bearer" }).set("X-Forwarded-For", "198.51.100.10").expect(401)
      await request(server).get("/api/test-throttle/protected").auth("forged-3", { type: "bearer" }).set("X-Forwarded-For", "198.51.100.10").expect(429)

      // Valid user from the same IP still succeeds.
      await request(server).get("/api/test-throttle/protected").auth("token-a", { type: "bearer" }).set("X-Forwarded-For", "198.51.100.10").expect(200)
    } finally {
      await app.close()
    }
  })

  it("keeps public routes strictly IP-throttled even when Bearer tokens are sent", async () => {
    const { app } = await createTestApp()
    try {
      const server = app.getHttpServer()
      await request(server).get("/api/test-throttle/public").auth("token-a", { type: "bearer" }).set("X-Forwarded-For", "61.50.102.122").expect(200)
      await request(server).get("/api/test-throttle/public").auth("token-b", { type: "bearer" }).set("X-Forwarded-For", "61.50.102.122").expect(200)
      await request(server).get("/api/test-throttle/public").auth("token-b", { type: "bearer" }).set("X-Forwarded-For", "61.50.102.122").expect(429)
    } finally {
      await app.close()
    }
  })
})
