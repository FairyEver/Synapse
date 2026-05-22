import { JwtService } from "@nestjs/jwt"
import { describe, expect, it, vi } from "vitest"
import { hashPassword } from "../auth/password"
import { AdminAuthService } from "./admin-auth.service"

async function createTestService() {
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
    service: new AdminAuthService(jwt, prisma as never),
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

  it("rejects a disabled administrator", async () => {
    const { service, prisma } = await createTestService()
    prisma.adminUser.findFirst.mockResolvedValueOnce({
      id: "admin-1",
      email: "admin@d2.com",
      passwordHash: await hashPassword("admin@pwd1234!"),
      status: "disabled",
    })

    await expect(service.login("admin@d2.com", "admin@pwd1234!"))
      .rejects
      .toThrow("邮箱或密码错误。")
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
