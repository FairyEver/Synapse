import { UnauthorizedException } from "@nestjs/common"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AdminAuthController, adminSessionCookieName } from "./admin-auth.controller"

describe("AdminAuthController", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("sets only the scoped admin cookie and never returns the token", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    const auth = {
      createSession: vi.fn().mockResolvedValue({
        token: "opaque-token",
        session: { sessionId: "session-1", expiresAt: new Date("2026-08-01T00:00:00Z") },
      }),
    }
    const controller = new AdminAuthController(auth as never)
    const response = { cookie: vi.fn(), clearCookie: vi.fn() }

    const result = await controller.createSession(
      { accessSecret: "secret" },
      { ip: "127.0.0.1", method: "POST", get: () => "https://synapse.test" } as never,
      response as never,
    )

    expect(result).not.toHaveProperty("token")
    expect(response.cookie).toHaveBeenCalledWith(adminSessionCookieName, "opaque-token", expect.objectContaining({
      httpOnly: true,
      path: "/api/admin",
      sameSite: "strict",
    }))
  })

  it("uses the same external response for an invalid secret", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    const controller = new AdminAuthController({ createSession: vi.fn().mockResolvedValue(null) } as never)

    await expect(controller.createSession(
      { accessSecret: "wrong" },
      { ip: "127.0.0.1", method: "POST", get: () => "https://synapse.test" } as never,
      { cookie: vi.fn(), clearCookie: vi.fn() } as never,
    )).rejects.toEqual(new UnauthorizedException("密钥无效。"))
  })
})
