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
      .toThrow("管理员账号或密码错误。")
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
      .toThrow("管理员账号或密码错误。")
  })
})
