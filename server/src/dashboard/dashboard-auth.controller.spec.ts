import { afterEach, describe, expect, it, vi } from "vitest"
import { userSessionCookieName } from "../auth/user-web-session"
import { DashboardAuthController } from "./dashboard-auth.controller"

describe("DashboardAuthController", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("sets API and Drive-scoped user cookies on login", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const auth = {
      loginWeb: vi.fn().mockResolvedValue({
        token: "opaque-token",
        sessionId: "session-1",
        user: { email: "user@example.com", handle: "user" },
      }),
    }
    const controller = new DashboardAuthController(auth as never)
    const response = { cookie: vi.fn(), clearCookie: vi.fn() }

    const result = await controller.login(
      { email: "user@example.com", password: "secret" },
      { ip: "127.0.0.1" } as never,
      response as never,
    )

    expect(result).not.toHaveProperty("token")
    expect(response.cookie).toHaveBeenNthCalledWith(1, userSessionCookieName, "opaque-token", expect.objectContaining({
      httpOnly: true,
      path: "/api",
      sameSite: "lax",
      secure: true,
    }))
    expect(response.cookie).toHaveBeenNthCalledWith(2, userSessionCookieName, "opaque-token", expect.objectContaining({
      httpOnly: true,
      path: "/drive",
      sameSite: "lax",
      secure: true,
    }))
  })

  it("refreshes the Drive-scoped cookie for an existing session", async () => {
    const auth = {
      verifyWebSession: vi.fn().mockResolvedValue({ userId: "user-1", sessionId: "session-1" }),
      getMe: vi.fn().mockResolvedValue({
        user: { email: "user@example.com", handle: "user" },
      }),
    }
    const controller = new DashboardAuthController(auth as never)
    const response = { cookie: vi.fn(), clearCookie: vi.fn() }

    await controller.session(
      { cookies: { [userSessionCookieName]: "opaque-token" } } as never,
      response as never,
    )

    expect(response.cookie).toHaveBeenCalledWith(userSessionCookieName, "opaque-token", expect.objectContaining({
      path: "/drive",
    }))
  })

  it("clears API and Drive-scoped user cookies on logout", async () => {
    const auth = { logoutWeb: vi.fn().mockResolvedValue(undefined) }
    const controller = new DashboardAuthController(auth as never)
    const response = { cookie: vi.fn(), clearCookie: vi.fn() }

    await controller.logout(
      { cookies: { [userSessionCookieName]: "opaque-token" }, ip: "127.0.0.1" } as never,
      response as never,
    )

    expect(response.clearCookie).toHaveBeenCalledWith(userSessionCookieName, expect.objectContaining({ path: "/api" }))
    expect(response.clearCookie).toHaveBeenCalledWith(userSessionCookieName, expect.objectContaining({ path: "/drive" }))
  })
})
