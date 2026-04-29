import { describe, expect, it } from "vitest"
import { AdminAuthService } from "./admin-auth.service"

describe("AdminAuthService", () => {
  it("accepts the configured administrator password", async () => {
    const service = await AdminAuthService.createForTest({
      email: "admin@example.com",
      password: "change-me-now",
      jwtSecret: "local-dev-admin-secret",
    })

    const result = await service.login("admin@example.com", "change-me-now")

    expect(result.email).toBe("admin@example.com")
    expect(result.token.length).toBeGreaterThan(20)
  })

  it("rejects a wrong password", async () => {
    const service = await AdminAuthService.createForTest({
      email: "admin@example.com",
      password: "change-me-now",
      jwtSecret: "local-dev-admin-secret",
    })

    await expect(service.login("admin@example.com", "wrong-password"))
      .rejects
      .toThrow("Invalid admin credentials")
  })
})
