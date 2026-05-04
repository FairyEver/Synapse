import { JwtService } from "@nestjs/jwt"
import bcrypt from "bcryptjs"
import { describe, expect, it } from "vitest"
import { AdminAuthService } from "./admin-auth.service"

async function createTestService() {
  const jwt = new JwtService({ secret: "test-secret-at-least-32-chars-long!", signOptions: { expiresIn: "1h" } })
  const passwordHash = await bcrypt.hash("admin@pwd1234!", 10)
  return new AdminAuthService(jwt, "admin@d2.com", passwordHash)
}

describe("AdminAuthService", () => {
  it("accepts the configured administrator password", async () => {
    const service = await createTestService()
    const result = await service.login("admin@d2.com", "admin@pwd1234!")

    expect(result.email).toBe("admin@d2.com")
    expect(result.token.length).toBeGreaterThan(20)
  })

  it("rejects a wrong password", async () => {
    const service = await createTestService()

    await expect(service.login("admin@d2.com", "wrong-password"))
      .rejects
      .toThrow("管理员账号或密码错误。")
  })
})
