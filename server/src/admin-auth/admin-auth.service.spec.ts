import { JwtService } from "@nestjs/jwt"
import { describe, expect, it, vi } from "vitest"
import { hashPassword } from "../auth/password"
import { AdminAuthService } from "./admin-auth.service"

async function createTestService(auditLog?: { record: ReturnType<typeof vi.fn> }) {
  const jwt = new JwtService({ secret: "test-secret-at-least-32-chars-long!", signOptions: { expiresIn: "1h" } })
  const passwordHash = await hashPassword("admin@pwd1234!")
  const prisma = {
    adminUser: {
      findFirst: vi.fn().mockResolvedValue({
        id: "admin-1",
        email: "admin@d2.com",
        passwordHash,
        status: "active",
      }),
      findUnique: vi.fn().mockResolvedValue({
        id: "admin-1",
        email: "admin@d2.com",
        passwordHash,
        status: "active",
      }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  }
  return {
    service: new AdminAuthService(jwt, prisma as never, auditLog as never),
    prisma,
  }
}

describe("AdminAuthService", () => {
  it("accepts the configured administrator password", async () => {
    const { service } = await createTestService()
    const result = await service.login("admin@d2.com", "admin@pwd1234!")

    expect(result.email).toBe("admin@d2.com")
    expect(result.token.length).toBeGreaterThan(20)
  })

  it("rejects a wrong password", async () => {
    const { service } = await createTestService()

    await expect(service.login("admin@d2.com", "wrong-password"))
      .rejects
      .toThrow("邮箱或密码错误。")
  })

  it("does not attribute unknown email login failures to the first admin", async () => {
    const auditLog = { record: vi.fn() }
    const { service } = await createTestService(auditLog)

    await expect(service.login("random@evil.com", "wrong-password", "203.0.113.9"))
      .rejects
      .toThrow("邮箱或密码错误。")

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "random@evil.com",
      action: "dashboard.login.failure",
      targetType: "account",
      targetId: "unknown",
      ipAddress: "203.0.113.9",
    })
  })

  it("records the request ip for administrator login success", async () => {
    const auditLog = { record: vi.fn() }
    const { service } = await createTestService(auditLog)

    await service.login("admin@d2.com", "admin@pwd1234!", "203.0.113.10")

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@d2.com",
      action: "admin.login.success",
      targetType: "admin",
      targetId: "admin-1",
      ipAddress: "203.0.113.10",
    })
  })

  it("records disabled administrator login attempts separately from wrong passwords", async () => {
    const auditLog = { record: vi.fn() }
    const { service, prisma } = await createTestService(auditLog)
    prisma.adminUser.findFirst.mockResolvedValueOnce({
      id: "admin-1",
      email: "admin@d2.com",
      passwordHash: await hashPassword("admin@pwd1234!"),
      status: "disabled",
    })

    await expect(service.login("admin@d2.com", "admin@pwd1234!"))
      .rejects
      .toThrow("邮箱或密码错误。")

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@d2.com",
      action: "dashboard.login.disabled",
      targetType: "admin",
      targetId: "admin-1",
      ipAddress: "system",
    })
  })

  it("allows a same-email user to log in when the matching administrator is disabled", async () => {
    const auditLog = { record: vi.fn() }
    const { service, prisma } = await createTestService(auditLog)
    const sharedPasswordHash = await hashPassword("shared-password")
    prisma.adminUser.findFirst.mockResolvedValueOnce({
      id: "admin-1",
      email: "admin@d2.com",
      passwordHash: sharedPasswordHash,
      status: "disabled",
    })
    prisma.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "admin@d2.com",
      passwordHash: sharedPasswordHash,
      status: "active",
    })

    const result = await service.login("admin@d2.com", "shared-password", "203.0.113.12")

    expect(result).toMatchObject({ email: "admin@d2.com", role: "user" })
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@d2.com",
      action: "dashboard.login.disabled",
      targetType: "admin",
      targetId: "admin-1",
      ipAddress: "203.0.113.12",
    })
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@d2.com",
      action: "user.dashboard_login.success",
      targetType: "user",
      targetId: "user-1",
      ipAddress: "203.0.113.12",
    })
  })

  it("accepts normal user credentials for dashboard login", async () => {
    const { service, prisma } = await createTestService()
    prisma.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "user@example.com",
      passwordHash: await hashPassword("user-password"),
      status: "active",
    })

    const result = await service.login("user@example.com", "user-password")

    expect(result.email).toBe("user@example.com")
    expect(result.role).toBe("user")
    expect(result.token.length).toBeGreaterThan(20)
  })

  it("records disabled dashboard user login attempts separately from wrong passwords", async () => {
    const auditLog = { record: vi.fn() }
    const { service, prisma } = await createTestService(auditLog)
    prisma.user.findUnique.mockResolvedValueOnce({
      id: "user-1",
      email: "user@example.com",
      passwordHash: await hashPassword("user-password"),
      status: "disabled",
    })

    await expect(service.login("user@example.com", "user-password", "203.0.113.11"))
      .rejects
      .toThrow("账号已停用。")

    expect(auditLog.record).toHaveBeenCalledTimes(1)
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "user@example.com",
      action: "user.dashboard_login.disabled",
      targetType: "user",
      targetId: "user-1",
      ipAddress: "203.0.113.11",
    })
  })

  it("does not verify a normal user token as an administrator", async () => {
    const { service, prisma } = await createTestService()
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      passwordHash: await hashPassword("user-password"),
      status: "active",
    })

    const result = await service.login("user@example.com", "user-password")

    await expect(service.verify(result.token)).resolves.toBeNull()
  })

  it("verifies dashboard sessions with their role", async () => {
    const { service, prisma } = await createTestService()
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      passwordHash: await hashPassword("user-password"),
      status: "active",
    })

    const result = await service.login("user@example.com", "user-password")

    await expect(service.verifyDashboardSession(result.token)).resolves.toEqual({
      id: "user-1",
      email: "user@example.com",
      role: "user",
    })
  })
})
