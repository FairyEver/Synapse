import { type INestApplication, Module } from "@nestjs/common"
import { APP_GUARD } from "@nestjs/core"
import { Test } from "@nestjs/testing"
import { JwtService } from "@nestjs/jwt"
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler"
import { randomUUID } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AllExceptionsFilter } from "../common/all-exceptions.filter"
import { RATE_LIMIT_TTL_MS } from "../common/rate-limits"
import { sanitizeWebhookLogRequest } from "../webhooks/webhook-sanitize"
import { UpdateIntentModule } from "./update-intent.module"

type TestResponse = {
  readonly status: number
  readonly headers: Record<string, string | undefined>
  readonly body: Record<string, unknown>
}

type TestRequest = PromiseLike<TestResponse> & {
  readonly set: (name: string, value: string) => TestRequest
  readonly send: (body: unknown) => TestRequest
}

const request = require("supertest") as (server: unknown) => {
  readonly post: (path: string) => TestRequest
}
const updateIntentSecret = "update-intent-secret-update-intent-secret-update-intent-secret-64"

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: "default", ttl: RATE_LIMIT_TTL_MS, limit: 600 }]),
    UpdateIntentModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
class UpdateIntentHttpTestModule {}

describe("update intent HTTP API", () => {
  let app: INestApplication
  let previousEnv: NodeJS.ProcessEnv
  let requestLogs: unknown[]
  let errorLogs: unknown[]

  beforeEach(async () => {
    previousEnv = { ...process.env }
    process.env = {
      ...previousEnv,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://synapse:synapse@localhost:5432/synapse",
      ADMIN_EMAIL: "admin@example.com",
      ADMIN_PASSWORD: "password-password",
      ADMIN_JWT_SECRET: "admin-secret-admin-secret-admin-secret",
      USER_ACCESS_JWT_SECRET: "user-secret-user-secret-user-secret",
      APP_PUBLIC_URL: "https://synapse.d2.pub",
      DESKTOP_UPDATE_INTENT_SECRET: updateIntentSecret,
      SYNAPSE_DRIVE_LOCAL_ROOT: "/tmp/synapse-test-drive",
      SKILL_REPOSITORY_COS_SECRET_ID: "skill-repository-secret-id",
      SKILL_REPOSITORY_COS_SECRET_KEY: "skill-repository-secret-key",
      SKILL_REPOSITORY_COS_BUCKET: "skill-repository-bucket",
      SKILL_REPOSITORY_COS_REGION: "ap-beijing",
    }

    const moduleRef = await Test.createTestingModule({ imports: [UpdateIntentHttpTestModule] }).compile()
    app = moduleRef.createNestApplication()
    requestLogs = []
    errorLogs = []
    app.use((incoming: unknown, _response: unknown, next: () => void) => {
      requestLogs.push(sanitizeWebhookLogRequest(incoming as never))
      next()
    })
    app.useGlobalFilters(new AllExceptionsFilter({
      error: (...values: unknown[]) => errorLogs.push(values),
    } as never))
    await app.init()
  })

  afterEach(async () => {
    await app.close()
    process.env = previousEnv
  })

  it("issues a short-lived update credential as a complete update deep link", async () => {
    const before = Math.floor(Date.now() / 1_000)
    const response = await request(app.getHttpServer())
      .post("/api/desktop/update-intent")
      .set("Origin", "https://synapse.d2.pub")
    const after = Math.floor(Date.now() / 1_000)

    expect(response.status).toBe(200)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.body).toEqual({
      deepLink: expect.stringMatching(/^synapse:\/\/update\?token=[A-Za-z0-9._-]+$/u),
      expiresAt: expect.any(String),
    })
    const expiresAt = Math.floor(new Date(response.body.expiresAt as string).getTime() / 1_000)
    expect(expiresAt).toBeGreaterThanOrEqual(before + 120)
    expect(expiresAt).toBeLessThanOrEqual(after + 120)
  })

  it("verifies an issued credential with only the minimal authorization result", async () => {
    const issued = await request(app.getHttpServer())
      .post("/api/desktop/update-intent")
      .set("Origin", "https://synapse.d2.pub")
    const token = new URL(issued.body.deepLink as string).searchParams.get("token")

    const response = await request(app.getHttpServer())
      .post("/api/desktop/update-intent/verify")
      .send({ token })
    const replay = await request(app.getHttpServer())
      .post("/api/desktop/update-intent/verify")
      .send({ token })

    expect(response.status).toBe(200)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.body).toEqual({ authorized: true })
    expect(replay.status).toBe(200)
    expect(replay.body).toEqual({ authorized: true })
  })

  it("rejects credential issuance without the exact official public origin", async () => {
    const missingOrigin = await request(app.getHttpServer())
      .post("/api/desktop/update-intent")
    const thirdPartyOrigin = await request(app.getHttpServer())
      .post("/api/desktop/update-intent")
      .set("Origin", "https://example.com")

    expect(missingOrigin.status).toBe(403)
    expect(thirdPartyOrigin.status).toBe(403)
  })

  it("issues only the fixed update-to-latest claims with a random identifier", async () => {
    const first = await issueCredential(app)
    const second = await issueCredential(app)
    const firstClaims = decodeJwtPayload(first)
    const secondClaims = decodeJwtPayload(second)

    expect(firstClaims).toEqual({
      type: "desktop-update-intent",
      aud: "synapse-desktop",
      scope: "update:latest",
      jti: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      iat: expect.any(Number),
      exp: expect.any(Number),
    })
    expect((firstClaims.exp as number) - (firstClaims.iat as number)).toBe(120)
    expect(secondClaims.jti).not.toBe(firstClaims.jti)
  })

  it.each([
    ["expired", createCredential({ iat: nowSeconds() - 240, exp: nowSeconds() - 120 })],
    ["wrong algorithm", createCredential({}, "HS512")],
    ["wrong type", createCredential({ type: "other-purpose" })],
    ["wrong audience", createCredential({ aud: "other-client" })],
    ["wrong scope", createCredential({ scope: "update:specific" })],
    ["wrong lifetime", createCredential({ exp: nowSeconds() + 121 })],
  ])("rejects a %s credential", async (_caseName, token) => {
    const response = await request(app.getHttpServer())
      .post("/api/desktop/update-intent/verify")
      .send({ token })

    expect(response.status).toBe(401)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(response.body).toEqual(expect.objectContaining({
      message: "更新凭证无效或已过期。",
    }))
  })

  it("rejects a tampered credential", async () => {
    const token = await issueCredential(app)
    const [header, payload, signature] = token.split(".")
    const tampered = `${header}.${payload}.${signature?.startsWith("A") ? "B" : "A"}${signature?.slice(1)}`

    const response = await request(app.getHttpServer())
      .post("/api/desktop/update-intent/verify")
      .send({ token: tampered })

    expect(response.status).toBe(401)
  })

  it("strictly rate limits credential issuance without allowing caches to retain the response", async () => {
    for (let index = 0; index < 10; index += 1) {
      const allowed = await request(app.getHttpServer())
        .post("/api/desktop/update-intent")
        .set("Origin", "https://synapse.d2.pub")
      expect(allowed.status).toBe(200)
    }

    const limited = await request(app.getHttpServer())
      .post("/api/desktop/update-intent")
      .set("Origin", "https://synapse.d2.pub")

    expect(limited.status).toBe(429)
    expect(limited.headers["cache-control"]).toBe("no-store")
  })

  it("applies a separate strict rate limit to credential verification", async () => {
    const token = await issueCredential(app)
    for (let index = 0; index < 30; index += 1) {
      const allowed = await request(app.getHttpServer())
        .post("/api/desktop/update-intent/verify")
        .send({ token })
      expect(allowed.status).toBe(200)
    }

    const limited = await request(app.getHttpServer())
      .post("/api/desktop/update-intent/verify")
      .send({ token })

    expect(limited.status).toBe(429)
    expect(limited.headers["cache-control"]).toBe("no-store")
  })

  it("keeps credentials, complete deep links, and verification bodies out of request and error logs", async () => {
    const issued = await request(app.getHttpServer())
      .post("/api/desktop/update-intent")
      .set("Origin", "https://synapse.d2.pub")
    const deepLink = issued.body.deepLink as string
    const token = new URL(deepLink).searchParams.get("token") ?? ""

    await request(app.getHttpServer())
      .post("/api/desktop/update-intent/verify")
      .send({ token })
    await request(app.getHttpServer())
      .post("/api/desktop/update-intent/verify")
      .send({ token: `${token}tampered` })

    const serializedLogs = JSON.stringify({ requestLogs, errorLogs })
    expect(serializedLogs).not.toContain(token)
    expect(serializedLogs).not.toContain(deepLink)
    expect(serializedLogs).not.toContain(JSON.stringify({ token }))
  })
})

async function issueCredential(app: INestApplication): Promise<string> {
  const response = await request(app.getHttpServer())
    .post("/api/desktop/update-intent")
    .set("Origin", "https://synapse.d2.pub")
  return new URL(response.body.deepLink as string).searchParams.get("token") ?? ""
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1]
  return JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8")) as Record<string, unknown>
}

function createCredential(
  overrides: Record<string, unknown>,
  algorithm: "HS256" | "HS512" = "HS256",
): string {
  const issuedAt = nowSeconds()
  return new JwtService({ secret: updateIntentSecret }).sign({
    type: "desktop-update-intent",
    aud: "synapse-desktop",
    scope: "update:latest",
    jti: randomUUID(),
    iat: issuedAt,
    exp: issuedAt + 120,
    ...overrides,
  }, { algorithm })
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000)
}
