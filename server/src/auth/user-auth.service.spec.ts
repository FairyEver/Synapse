import { createHash } from "node:crypto"
import { UnauthorizedException } from "@nestjs/common"
import { JwtService } from "@nestjs/jwt"
import { Prisma } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { hashPassword } from "./password"
import { hashToken } from "./token"
import { UserAuthService, type UserMeResponse } from "./user-auth.service"

function createPrismaMock() {
  const tx = {
    adminUser: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    user: {
      create: vi.fn().mockResolvedValue({ id: "user-1", email: "u@example.com", status: "active" }),
      update: vi.fn().mockResolvedValue({ id: "user-1" }),
    },
    userSession: {
      create: vi.fn().mockResolvedValue({ id: "session-1" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    desktopLoginCode: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    userPasswordResetToken: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $executeRaw: vi.fn(),
  }
  return {
    $transaction: vi.fn((callback) => callback(tx)),
    __tx: tx,
    adminUser: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    userSession: {
      create: vi.fn().mockResolvedValue({ id: "session-1" }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    desktopLoginCode: {
      create: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    userPasswordResetToken: {
      create: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUnique: vi.fn(),
    },
  }
}

function createUniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6.0.0",
  })
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url")
}

function createService(
  prisma: ReturnType<typeof createPrismaMock>,
  auditLog?: { record: ReturnType<typeof vi.fn> },
  options: { exposePasswordResetUrl?: boolean } = {},
) {
  return new UserAuthService(
    prisma as never,
    new JwtService({ secret: "user-secret-at-least-32-characters!" }),
    {
      accessMinutes: 15,
      refreshDays: 30,
      exposePasswordResetUrl: options.exposePasswordResetUrl ?? true,
    },
    auditLog as never,
  )
}

describe("UserAuthService", () => {
  it("rejects login for unknown users", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValue(null)
    const service = createService(prisma)

    await expect(service.login({ email: "missing@example.com", password: "x" }))
      .rejects
      .toThrow(UnauthorizedException)
  })

  it("rejects disabled users", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "u@example.com",
      passwordHash: await hashPassword("StrongPassword123!"),
      status: "disabled",
    })
    const auditLog = { record: vi.fn() }
    const service = createService(prisma, auditLog)

    await expect(service.login({ email: "u@example.com", password: "StrongPassword123!" }, "203.0.113.22"))
      .rejects
      .toThrow("邮箱或密码错误。")
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "u@example.com",
      action: "user.login.disabled",
      targetType: "user",
      targetId: "user-1",
      ipAddress: "203.0.113.22",
    })
  })

  it("records login failure audits with the request ip", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValue(null)
    const auditLog = { record: vi.fn() }
    const service = createService(prisma, auditLog)

    await expect(service.login({ email: "missing@example.com", password: "x" }, "203.0.113.23"))
      .rejects
      .toThrow(UnauthorizedException)

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "missing@example.com",
      action: "user.login.failure",
      targetType: "user",
      targetId: "unknown",
      ipAddress: "203.0.113.23",
    })
  })

  it("records login success audits with the request ip", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "u@example.com",
      passwordHash: await hashPassword("StrongPassword123!"),
      status: "active",
    })
    const auditLog = { record: vi.fn() }
    const service = createService(prisma, auditLog)

    await service.login({ email: "u@example.com", password: "StrongPassword123!" }, "203.0.113.24")

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "u@example.com",
      action: "user.login.success",
      targetType: "user",
      targetId: "user-1",
      ipAddress: "203.0.113.24",
    })
  })

  it("authorizes and exchanges a desktop login code with PKCE without returning user profile", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValue({ id: "user-1", email: "desktop@example.com", status: "active" })
    prisma.desktopLoginCode.create.mockResolvedValue({ id: "code-1" })
    const codeVerifier = "desktop-code-verifier-1234567890"
    const codeChallenge = pkceChallenge(codeVerifier)
    prisma.desktopLoginCode.findUnique.mockResolvedValue({
      id: "code-1",
      userId: "user-1",
      codeHash: "hash",
      clientId: "synapse-desktop",
      redirectUri: "synapse://auth/desktop/callback",
      state: "state-1234567890",
      codeChallenge,
      codeChallengeMethod: "S256",
      usedAt: null,
      expiresAt: new Date("2999-01-01T00:00:00.000Z"),
      user: { id: "user-1", email: "desktop@example.com", status: "active" },
    })
    prisma.desktopLoginCode.updateMany.mockResolvedValue({ count: 1 })
    const auditLog = { record: vi.fn() }
    const service = createService(prisma, auditLog)
    const issuedAt = Date.now()

    const issued = await service.authorizeDesktopLogin({
      userId: "user-1",
      clientId: "synapse-desktop",
      redirectUri: "synapse://auth/desktop/callback",
      state: "state-1234567890",
      codeChallenge,
      codeChallengeMethod: "S256",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    })

    expect(issued.code).toHaveLength(43)
    expect(issued.deepLinkUrl).toBe(`synapse://auth/desktop/callback?code=${encodeURIComponent(issued.code)}&state=state-1234567890`)
    expect(prisma.desktopLoginCode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        codeHash: hashToken(issued.code),
        userId: "user-1",
        clientId: "synapse-desktop",
        redirectUri: "synapse://auth/desktop/callback",
        state: "state-1234567890",
        codeChallenge,
        codeChallengeMethod: "S256",
        ipAddress: "127.0.0.1",
        userAgent: "vitest",
      }),
    })
    const persistedExpiresAt = prisma.desktopLoginCode.create.mock.calls[0]?.[0].data.expiresAt
    expect(persistedExpiresAt).toEqual(expect.any(Date))
    expect(persistedExpiresAt.getTime()).toBeGreaterThanOrEqual(issuedAt + 5 * 60 * 1000)
    expect(persistedExpiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000)

    const exchanged = await service.exchangeDesktopLoginToken({
      code: issued.code,
      state: "state-1234567890",
      codeVerifier,
      ipAddress: "127.0.0.1",
    })

    expect(exchanged.accessToken).toEqual(expect.any(String))
    expect(exchanged.refreshToken).toEqual(expect.any(String))
    expect(exchanged).not.toHaveProperty("user")
    expect(prisma.__tx.desktopLoginCode.updateMany).toHaveBeenCalledWith({
      where: { id: "code-1", usedAt: null },
      data: { usedAt: expect.any(Date) },
    })
    expect(prisma.__tx.userSession.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        refreshTokenHash: expect.any(String),
        expiresAt: expect.any(Date),
      },
    })
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "desktop@example.com",
      action: "user.desktop_login.issue",
      targetType: "user",
      targetId: "user-1",
      ipAddress: "127.0.0.1",
    })
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "desktop@example.com",
      action: "user.desktop_login.exchange.success",
      targetType: "user",
      targetId: "user-1",
      ipAddress: "127.0.0.1",
    })
  })

  it("rejects desktop login code replay", async () => {
    const prisma = createPrismaMock()
    prisma.desktopLoginCode.findUnique.mockResolvedValue({
      id: "code-1",
      userId: "user-1",
      codeHash: "hash",
      clientId: "synapse-desktop",
      redirectUri: "synapse://auth/desktop/callback",
      state: "state-1234567890",
      codeChallenge: pkceChallenge("desktop-code-verifier-1234567890"),
      codeChallengeMethod: "S256",
      usedAt: new Date("2026-05-28T00:00:00.000Z"),
      expiresAt: new Date("2999-01-01T00:00:00.000Z"),
      user: { id: "user-1", email: "desktop@example.com", status: "active" },
    })
    const service = createService(prisma)

    await expect(service.exchangeDesktopLoginToken({
      code: "desktop-code",
      state: "state-1234567890",
      codeVerifier: "desktop-code-verifier-1234567890",
      ipAddress: "127.0.0.1",
    }))
      .rejects
      .toThrow("登录凭证无效或已过期。")
    expect(prisma.desktopLoginCode.updateMany).not.toHaveBeenCalled()
  })

  it("rejects desktop login token requests when PKCE verification fails", async () => {
    const prisma = createPrismaMock()
    prisma.desktopLoginCode.findUnique.mockResolvedValue({
      id: "code-1",
      userId: "user-1",
      codeHash: "hash",
      clientId: "synapse-desktop",
      redirectUri: "synapse://auth/desktop/callback",
      state: "state-1234567890",
      codeChallenge: pkceChallenge("desktop-code-verifier-1234567890"),
      codeChallengeMethod: "S256",
      usedAt: null,
      expiresAt: new Date("2999-01-01T00:00:00.000Z"),
      user: { id: "user-1", email: "desktop@example.com", status: "active" },
    })
    const service = createService(prisma)

    await expect(service.exchangeDesktopLoginToken({
      code: "desktop-code",
      state: "state-1234567890",
      codeVerifier: "wrong-code-verifier-1234567890",
      ipAddress: "127.0.0.1",
    }))
      .rejects
      .toThrow("登录凭证无效或已过期。")
    expect(prisma.desktopLoginCode.updateMany).not.toHaveBeenCalled()
  })

  it("records logout audits with the request ip", async () => {
    const prisma = createPrismaMock()
    prisma.userSession.findUnique.mockResolvedValue({
      id: "session-1",
      revokedAt: null,
      user: { id: "user-1", email: "u@example.com" },
    })
    prisma.userSession.update.mockResolvedValue({})
    const auditLog = { record: vi.fn() }
    const service = createService(prisma, auditLog)

    await expect(service.logout({ refreshToken: "refresh-token" }, "203.0.113.25"))
      .resolves
      .toEqual({ ok: true })

    expect(prisma.userSession.findUnique).toHaveBeenCalledWith({
      where: { refreshTokenHash: hashToken("refresh-token") },
      include: { user: { select: { id: true, email: true } } },
    })
    expect(prisma.userSession.update).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: { revokedAt: expect.any(Date) },
    })
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "u@example.com",
      action: "user.logout.success",
      targetType: "user",
      targetId: "user-1",
      ipAddress: "203.0.113.25",
    })
  })

  it("registers users without an invitation and records success audits with the request ip", async () => {
    const prisma = createPrismaMock()
    const auditLog = { record: vi.fn() }
    const service = createService(prisma, auditLog)

    await service.register({
      email: "U@example.com",
      password: "StrongPassword123!",
    }, "203.0.113.25")

    expect(prisma.__tx.$executeRaw).toHaveBeenCalledTimes(1)
    expect(prisma.__tx.adminUser.findUnique).toHaveBeenCalledWith({
      where: { email: "u@example.com" },
      select: { id: true },
    })
    expect(prisma.__tx.user.create).toHaveBeenCalledWith({
      data: {
        email: "u@example.com",
        passwordHash: expect.any(String),
      },
    })
    expect(prisma.__tx.userSession.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        refreshTokenHash: expect.any(String),
        expiresAt: expect.any(Date),
      },
    })
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "u@example.com",
      action: "user.register.success",
      targetType: "user",
      targetId: "user-1",
      ipAddress: "203.0.113.25",
    })
  })

  it("rejects admin emails during registration and records duplicate email audits", async () => {
    const prisma = createPrismaMock()
    prisma.__tx.adminUser.findUnique.mockResolvedValue({ id: "admin-1" })
    const auditLog = { record: vi.fn() }
    const service = createService(prisma, auditLog)

    await expect(service.register({
      email: "Admin@example.com",
      password: "StrongPassword123!",
    }, "203.0.113.26"))
      .rejects
      .toThrow("邮箱已注册。")

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "user.register.failure",
      targetType: "user",
      targetId: "unknown",
      detail: { reason: "duplicate_email" },
      ipAddress: "203.0.113.26",
    })
    expect(prisma.__tx.user.create).not.toHaveBeenCalled()
    expect(prisma.__tx.userSession.create).not.toHaveBeenCalled()
  })

  it("records duplicate registration attempts", async () => {
    const prisma = createPrismaMock()
    prisma.$transaction.mockRejectedValue(createUniqueConstraintError())
    const auditLog = { record: vi.fn() }
    const service = createService(prisma, auditLog)

    await expect(service.register({
      email: "U@example.com",
      password: "StrongPassword123!",
    }, "203.0.113.26"))
      .rejects
      .toThrow("邮箱已注册。")

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "u@example.com",
      action: "user.register.failure",
      targetType: "user",
      targetId: "unknown",
      detail: { reason: "duplicate_email" },
      ipAddress: "203.0.113.26",
    })
  })

  it("requests a password reset without exposing unknown users", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValue(null)
    const auditLog = { record: vi.fn() }
    const service = createService(prisma, auditLog)

    await expect(service.requestPasswordReset({
      email: "Missing@example.com",
      publicAppUrl: "https://app.example.com",
    }, "203.0.113.40"))
      .resolves
      .toEqual({ ok: true })

    expect(prisma.userPasswordResetToken.create).not.toHaveBeenCalled()
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "missing@example.com",
      action: "user.password_reset.request_ignored",
      targetType: "user",
      targetId: "unknown",
      ipAddress: "203.0.113.40",
    })
  })

  it("creates a development password reset URL for active users", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "u@example.com",
      status: "active",
    })
    const auditLog = { record: vi.fn() }
    const service = createService(prisma, auditLog)

    const result = await service.requestPasswordReset({
      email: "U@example.com",
      publicAppUrl: "https://app.example.com/",
    }, "203.0.113.41")

    expect(result.ok).toBe(true)
    expect(result.resetUrl).toMatch(/^https:\/\/app\.example\.com\/dashboard\/reset-password\?token=/)
    expect(result.expiresAt).toEqual(expect.any(Date))
    const token = new URL(result.resetUrl!).searchParams.get("token")
    expect(prisma.userPasswordResetToken.create).toHaveBeenCalledWith({
      data: {
        tokenHash: hashToken(token!),
        userId: "user-1",
        expiresAt: result.expiresAt,
      },
    })
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "u@example.com",
      action: "user.password_reset.request",
      targetType: "user",
      targetId: "user-1",
      ipAddress: "203.0.113.41",
    })
  })

  it("does not return password reset URLs when disabled by options", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "u@example.com",
      status: "active",
    })
    const service = createService(prisma, undefined, { exposePasswordResetUrl: false })

    await expect(service.requestPasswordReset({
      email: "u@example.com",
      publicAppUrl: "https://app.example.com",
    }))
      .resolves
      .toEqual({ ok: true })

    expect(prisma.userPasswordResetToken.create).toHaveBeenCalledTimes(1)
  })

  it("resets a password, consumes tokens, and revokes sessions", async () => {
    const prisma = createPrismaMock()
    const token = "reset-token"
    prisma.userPasswordResetToken.findUnique.mockResolvedValue({
      id: "reset-1",
      tokenHash: hashToken(token),
      userId: "user-1",
      expiresAt: new Date("2999-01-01T00:00:00.000Z"),
      usedAt: null,
      user: { id: "user-1", email: "u@example.com", status: "active" },
    })
    const auditLog = { record: vi.fn() }
    const service = createService(prisma, auditLog)

    await expect(service.resetPassword({
      token,
      password: "NewPassword123!",
    }, "203.0.113.42"))
      .resolves
      .toEqual({ ok: true })

    expect(prisma.__tx.userPasswordResetToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: "reset-1",
        usedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: { usedAt: expect.any(Date) },
    })
    expect(prisma.__tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        passwordHash: expect.any(String),
        passwordChangedAt: expect.any(Date),
      },
    })
    expect(prisma.__tx.userSession.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
    expect(prisma.__tx.userPasswordResetToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", usedAt: null },
      data: { usedAt: expect.any(Date) },
    })
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "u@example.com",
      action: "user.password_reset.success",
      targetType: "user",
      targetId: "user-1",
      ipAddress: "203.0.113.42",
    })
  })

  it("rejects expired or reused password reset tokens", async () => {
    const prisma = createPrismaMock()
    prisma.userPasswordResetToken.findUnique.mockResolvedValue({
      id: "reset-1",
      userId: "user-1",
      expiresAt: new Date("2000-01-01T00:00:00.000Z"),
      usedAt: null,
      user: { id: "user-1", email: "u@example.com", status: "active" },
    })
    const auditLog = { record: vi.fn() }
    const service = createService(prisma, auditLog)

    await expect(service.resetPassword({
      token: "expired-token",
      password: "NewPassword123!",
    }, "203.0.113.43"))
      .rejects
      .toThrow("重置链接无效或已过期。")

    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "u@example.com",
      action: "user.password_reset.failure",
      targetType: "user",
      targetId: "user-1",
      ipAddress: "203.0.113.43",
    })
  })

  it("rejects refresh when another request already rotated the session token", async () => {
    const prisma = createPrismaMock()
    prisma.userSession.findUnique.mockResolvedValue({
      id: "session-1",
      refreshTokenHash: hashToken("refresh-token"),
      revokedAt: null,
      expiresAt: new Date("2999-01-01T00:00:00.000Z"),
      user: {
        id: "user-1",
        email: "u@example.com",
        status: "active",
      },
    })
    prisma.userSession.updateMany.mockResolvedValue({ count: 0 })
    const auditLog = { record: vi.fn() }
    const service = createService(prisma, auditLog)

    await expect(service.refresh({ refreshToken: "refresh-token" }, "203.0.113.27"))
      .rejects
      .toThrow("未登录或登录已过期。")

    expect(prisma.userSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "session-1",
        refreshTokenHash: hashToken("refresh-token"),
        revokedAt: null,
      },
    }))
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "u@example.com",
      action: "user.refresh.race_lost",
      targetType: "user",
      targetId: "user-1",
      ipAddress: "203.0.113.27",
    })
  })

  it("records invalid refresh token attempts with the request ip", async () => {
    const prisma = createPrismaMock()
    prisma.userSession.findUnique.mockResolvedValue(null)
    const auditLog = { record: vi.fn() }
    const service = createService(prisma, auditLog)

    await expect(service.refresh({ refreshToken: "invalid-token" }, "203.0.113.28"))
      .rejects
      .toThrow("未登录或登录已过期。")

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "unknown",
      action: "user.refresh.invalid",
      targetType: "user",
      targetId: "unknown",
      ipAddress: "203.0.113.28",
    })
    expect(prisma.userSession.updateMany).not.toHaveBeenCalled()
  })

  it("records revoked refresh token attempts with the request ip", async () => {
    const prisma = createPrismaMock()
    prisma.userSession.findUnique.mockResolvedValue({
      id: "session-1",
      refreshTokenHash: hashToken("refresh-token"),
      revokedAt: new Date("2026-05-24T00:00:00.000Z"),
      expiresAt: new Date("2999-01-01T00:00:00.000Z"),
      user: {
        id: "user-1",
        email: "u@example.com",
        status: "active",
      },
    })
    const auditLog = { record: vi.fn() }
    const service = createService(prisma, auditLog)

    await expect(service.refresh({ refreshToken: "refresh-token" }, "203.0.113.29"))
      .rejects
      .toThrow("未登录或登录已过期。")

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "u@example.com",
      action: "user.refresh.revoked",
      targetType: "user",
      targetId: "user-1",
      ipAddress: "203.0.113.29",
    })
    expect(prisma.userSession.updateMany).not.toHaveBeenCalled()
  })

  it("records expired refresh token attempts with the request ip", async () => {
    const prisma = createPrismaMock()
    prisma.userSession.findUnique.mockResolvedValue({
      id: "session-1",
      refreshTokenHash: hashToken("refresh-token"),
      revokedAt: null,
      expiresAt: new Date("2000-01-01T00:00:00.000Z"),
      user: {
        id: "user-1",
        email: "u@example.com",
        status: "active",
      },
    })
    const auditLog = { record: vi.fn() }
    const service = createService(prisma, auditLog)

    await expect(service.refresh({ refreshToken: "refresh-token" }, "203.0.113.30"))
      .rejects
      .toThrow("未登录或登录已过期。")

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "u@example.com",
      action: "user.refresh.expired",
      targetType: "user",
      targetId: "user-1",
      ipAddress: "203.0.113.30",
    })
    expect(prisma.userSession.updateMany).not.toHaveBeenCalled()
  })

  it("records disabled user refresh attempts with the request ip", async () => {
    const prisma = createPrismaMock()
    prisma.userSession.findUnique.mockResolvedValue({
      id: "session-1",
      refreshTokenHash: hashToken("refresh-token"),
      revokedAt: null,
      expiresAt: new Date("2999-01-01T00:00:00.000Z"),
      user: {
        id: "user-1",
        email: "u@example.com",
        status: "disabled",
      },
    })
    const auditLog = { record: vi.fn() }
    const service = createService(prisma, auditLog)

    await expect(service.refresh({ refreshToken: "refresh-token" }, "203.0.113.26"))
      .rejects
      .toThrow("账号已停用。")

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "u@example.com",
      action: "user.refresh.disabled",
      targetType: "user",
      targetId: "user-1",
      ipAddress: "203.0.113.26",
    })
    expect(prisma.userSession.updateMany).not.toHaveBeenCalled()
  })

  it("cleans expired sessions and desktop login codes", async () => {
    const prisma = createPrismaMock()
    prisma.userSession.deleteMany.mockResolvedValue({ count: 3 })
    prisma.desktopLoginCode.deleteMany.mockResolvedValue({ count: 2 })
    prisma.userPasswordResetToken.deleteMany.mockResolvedValue({ count: 1 })
    const service = createService(prisma)
    const now = new Date("2026-05-23T12:00:00.000Z")

    await expect(service.cleanupExpiredSessions(now)).resolves.toBe(6)

    expect(prisma.userSession.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { revokedAt: { lt: new Date("2026-05-16T12:00:00.000Z") } },
        ],
      },
    })
    expect(prisma.desktopLoginCode.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { usedAt: { not: null } },
        ],
      },
    })
    expect(prisma.userPasswordResetToken.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { usedAt: { not: null } },
        ],
      },
    })
  })

  it("returns the current user and team membership shape without roles or permissions", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      id: "user-1",
      email: "u@example.com",
      status: "active",
      displayName: "Ada",
      memberships: [
        {
          id: "membership-1",
          role: "owner",
          team: { id: "team-1", name: "Team One" },
        },
        {
          id: "membership-2",
          role: "member",
          team: { id: "team-2", name: "Team Two" },
        },
      ],
    })
    const service = createService(prisma)

    const expected: UserMeResponse = {
      user: { id: "user-1", email: "u@example.com", status: "active", displayName: "Ada" },
      teams: [
        {
          id: "team-1",
          name: "Team One",
          membershipId: "membership-1",
          membershipRole: "owner",
        },
        {
          id: "team-2",
          name: "Team Two",
          membershipId: "membership-2",
          membershipRole: "member",
        },
      ],
    }

    await expect(service.getMe("user-1")).resolves.toEqual(expected)

    expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: {
        id: true,
        email: true,
        status: true,
        displayName: true,
        memberships: {
          select: {
            id: true,
            role: true,
            team: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    })
  })

  it("updates the current user display name", async () => {
    const prisma = createPrismaMock()
    prisma.user.update.mockResolvedValue({
      id: "user-1",
      email: "u@example.com",
      status: "active",
      displayName: "Grace Hopper",
      memberships: [],
    })
    const auditLog = { record: vi.fn() }
    const service = createService(prisma, auditLog)

    await expect(service.updateMyProfile("user-1", {
      displayName: "  Grace Hopper  ",
    }, "203.0.113.80")).resolves.toEqual({
      user: {
        id: "user-1",
        email: "u@example.com",
        status: "active",
        displayName: "Grace Hopper",
      },
      teams: [],
    })

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { displayName: "Grace Hopper" },
      select: {
        id: true,
        email: true,
        status: true,
        displayName: true,
        memberships: {
          select: {
            id: true,
            role: true,
            team: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    })
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "u@example.com",
      action: "user.profile.update",
      targetType: "user",
      targetId: "user-1",
      detail: { fields: ["displayName"] },
      ipAddress: "203.0.113.80",
    })
  })

  it("rejects empty current user display names", async () => {
    const prisma = createPrismaMock()
    const service = createService(prisma)

    await expect(service.updateMyProfile("user-1", {
      displayName: "   ",
    })).rejects.toThrow("displayName is required.")

    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it("rejects over length current user display names", async () => {
    const prisma = createPrismaMock()
    const service = createService(prisma)

    await expect(service.updateMyProfile("user-1", {
      displayName: "a".repeat(41),
    })).rejects.toThrow("displayName must be at most 40 characters.")

    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it("rejects access tokens issued before a password change", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUnique
      .mockResolvedValueOnce({
        id: "user-1",
        email: "u@example.com",
        passwordHash: await hashPassword("StrongPassword123!"),
        status: "active",
      })
      .mockResolvedValueOnce({
        id: "user-1",
        email: "u@example.com",
        status: "active",
        passwordChangedAt: new Date(Date.now() + 2000),
      })
    const service = createService(prisma)

    const tokens = await service.login({
      email: "u@example.com",
      password: "StrongPassword123!",
    })

    await expect(service.verifyAccessToken(tokens.accessToken))
      .rejects
      .toThrow("未登录或登录已过期。")
  })

  it("rejects access tokens issued in the same second as a password change", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "u@example.com",
      passwordHash: await hashPassword("StrongPassword123!"),
      status: "active",
    })
    const service = createService(prisma)

    const tokens = await service.login({
      email: "u@example.com",
      password: "StrongPassword123!",
    })
    const payload = new JwtService().decode(tokens.accessToken) as { iat: number }
    prisma.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "u@example.com",
      status: "active",
      passwordChangedAt: new Date((payload.iat * 1000) + 900),
    })

    await expect(service.verifyAccessToken(tokens.accessToken))
      .rejects
      .toThrow("未登录或登录已过期。")
  })
})
