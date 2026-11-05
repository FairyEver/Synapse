import "reflect-metadata"
import { UnauthorizedException } from "@nestjs/common"
import { APP_GUARD } from "@nestjs/core"
import { Test } from "@nestjs/testing"
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler"
import cookieParser from "cookie-parser"
import request from "supertest"
import { describe, expect, it, vi } from "vitest"
import { UserAuthGuard } from "../auth/user-auth.guard"
import { UserAuthService } from "../auth/user-auth.service"
import { userSessionCookieName } from "../auth/user-web-session"
import { ProfileAvatarController } from "./profile-avatar.controller"
import { ProfileAvatarService } from "./profile-avatar.service"
import { ProfileAvatarRandomThrottleGuard } from "./profile-avatar-random-throttle.guard"

async function createApp() {
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 600 }])],
    controllers: [ProfileAvatarController],
    providers: [
      UserAuthGuard,
      ProfileAvatarRandomThrottleGuard,
      { provide: APP_GUARD, useClass: ThrottlerGuard },
      { provide: ProfileAvatarService, useValue: { randomize: vi.fn(async () => undefined) } },
      {
        provide: UserAuthService,
        useValue: {
          verifyAccessToken: vi.fn(async (token: string) => {
            if (token === "user-a-session-1" || token === "user-a-session-2") return { userId: "user-a" }
            if (token === "user-b-session-1") return { userId: "user-b" }
            throw new UnauthorizedException()
          }),
          verifyWebSession: vi.fn(async (token: string) => (
            token === "user-a-web-session" ? { userId: "user-a", sessionId: "web-session-a" } : null
          )),
          getMe: vi.fn(async (id: string) => ({ user: { id } })),
        },
      },
    ],
  }).compile()
  const app = moduleRef.createNestApplication()
  app.getHttpAdapter().getInstance().set("trust proxy", "loopback")
  app.use(cookieParser())
  await app.init()
  return app
}

const randomAvatarPath = "/api/console/me/avatar/random"

describe("random avatar rate limit over HTTP", () => {
  it("gives each account its own 60 requests behind the same IP", async () => {
    const app = await createApp()
    try {
      const server = app.getHttpServer()
      for (let sent = 0; sent < 60; sent += 1) {
        await request(server).post(randomAvatarPath).auth("user-a-session-1", { type: "bearer" }).expect(201)
      }
      for (let sent = 0; sent < 60; sent += 1) {
        const response = await request(server).post(randomAvatarPath).auth("user-b-session-1", { type: "bearer" }).expect(201)
        expect(response.body.user.id).toBe("user-b")
      }
      await request(server).post(randomAvatarPath).auth("user-a-session-1", { type: "bearer" }).expect(429)
      await request(server).post(randomAvatarPath).auth("user-b-session-1", { type: "bearer" }).expect(429)
    } finally {
      await app.close()
    }
  })

  it("shares the account budget across bearer tokens, web sessions, and IP addresses", async () => {
    const app = await createApp()
    try {
      const server = app.getHttpServer()
      for (let sent = 0; sent < 40; sent += 1) {
        await request(server).post(randomAvatarPath)
          .auth(sent < 20 ? "user-a-session-1" : "user-a-session-2", { type: "bearer" })
          .set("X-Forwarded-For", sent < 20 ? "203.0.113.1" : "203.0.113.2")
          .expect(201)
      }
      for (let sent = 0; sent < 20; sent += 1) {
        await request(server).post(randomAvatarPath)
          .set("Cookie", `${userSessionCookieName}=user-a-web-session`)
          .set("X-Forwarded-For", "203.0.113.3")
          .expect(201)
      }
      await request(server).post(randomAvatarPath)
        .auth("user-a-session-2", { type: "bearer" })
        .set("X-Forwarded-For", "203.0.113.4")
        .expect(429)
      await request(server).post(randomAvatarPath)
        .set("Cookie", `${userSessionCookieName}=user-a-web-session`)
        .expect(429)
    } finally {
      await app.close()
    }
  })

  it("rejects unauthenticated requests without consuming an account budget", async () => {
    const app = await createApp()
    try {
      const server = app.getHttpServer()
      for (let sent = 0; sent < 61; sent += 1) {
        await request(server).post(randomAvatarPath).auth("invalid", { type: "bearer" }).expect(401)
      }
      for (let sent = 0; sent < 60; sent += 1) {
        await request(server).post(randomAvatarPath).auth("user-a-session-1", { type: "bearer" }).expect(201)
      }
      await request(server).post(randomAvatarPath).auth("user-a-session-1", { type: "bearer" }).expect(429)
    } finally {
      await app.close()
    }
  })
})
