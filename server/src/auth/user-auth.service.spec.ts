import { UnauthorizedException } from "@nestjs/common"
import { JwtService } from "@nestjs/jwt"
import { describe, expect, it, vi } from "vitest"
import { hashPassword } from "./password"
import { UserAuthService } from "./user-auth.service"

function createPrismaMock() {
  return {
    $transaction: vi.fn((callback) => callback({
      user: {
        create: vi.fn().mockResolvedValue({ id: "user-1", email: "u@example.com", status: "active" }),
      },
      userSession: {
        create: vi.fn().mockResolvedValue({ id: "session-1" }),
      },
    })),
    user: {
      findUnique: vi.fn(),
    },
    userSession: {
      create: vi.fn().mockResolvedValue({ id: "session-1" }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  }
}

describe("UserAuthService", () => {
  it("rejects login for unknown users", async () => {
    const prisma = createPrismaMock()
    prisma.user.findUnique.mockResolvedValue(null)
    const service = new UserAuthService(
      prisma as never,
      { consumeInvitation: vi.fn() } as never,
      new JwtService({ secret: "user-secret-at-least-32-characters!" }),
      { accessMinutes: 15, refreshDays: 30 },
    )

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
    const service = new UserAuthService(
      prisma as never,
      { consumeInvitation: vi.fn() } as never,
      new JwtService({ secret: "user-secret-at-least-32-characters!" }),
      { accessMinutes: 15, refreshDays: 30 },
      auditLog as never,
    )

    await expect(service.login({ email: "u@example.com", password: "StrongPassword123!" }, "203.0.113.22"))
      .rejects
      .toThrow("账号已停用。")
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
    const service = new UserAuthService(
      prisma as never,
      { consumeInvitation: vi.fn() } as never,
      new JwtService({ secret: "user-secret-at-least-32-characters!" }),
      { accessMinutes: 15, refreshDays: 30 },
      auditLog as never,
    )

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
    const service = new UserAuthService(
      prisma as never,
      { consumeInvitation: vi.fn() } as never,
      new JwtService({ secret: "user-secret-at-least-32-characters!" }),
      { accessMinutes: 15, refreshDays: 30 },
      auditLog as never,
    )

    await service.login({ email: "u@example.com", password: "StrongPassword123!" }, "203.0.113.24")

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "u@example.com",
      action: "user.login.success",
      targetType: "user",
      targetId: "user-1",
      ipAddress: "203.0.113.24",
    })
  })

  it("records registration success audits with the request ip", async () => {
    const prisma = createPrismaMock()
    const auditLog = { record: vi.fn() }
    const service = new UserAuthService(
      prisma as never,
      { consumeInvitation: vi.fn() } as never,
      new JwtService({ secret: "user-secret-at-least-32-characters!" }),
      { accessMinutes: 15, refreshDays: 30 },
      auditLog as never,
    )

    await service.register({
      invitationToken: "invite-token",
      email: "U@example.com",
      password: "StrongPassword123!",
    }, "203.0.113.25")

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "u@example.com",
      action: "user.register.success",
      targetType: "user",
      targetId: "user-1",
      ipAddress: "203.0.113.25",
    })
  })

  it("cleans expired and stale revoked sessions", async () => {
    const prisma = createPrismaMock()
    prisma.userSession.deleteMany.mockResolvedValue({ count: 3 })
    const service = new UserAuthService(
      prisma as never,
      { consumeInvitation: vi.fn() } as never,
      new JwtService({ secret: "user-secret-at-least-32-characters!" }),
      { accessMinutes: 15, refreshDays: 30 },
    )
    const now = new Date("2026-05-23T12:00:00.000Z")

    await expect(service.cleanupExpiredSessions(now)).resolves.toBe(3)

    expect(prisma.userSession.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { revokedAt: { lt: new Date("2026-05-16T12:00:00.000Z") } },
        ],
      },
    })
  })
})
