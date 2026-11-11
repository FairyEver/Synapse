import { afterEach, describe, expect, it, vi } from "vitest"
describe("production host-bound sessions", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
  it("uses secure root-path host-prefixed cookies and never authenticates an injected legacy cookie", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("APP_PUBLIC_URL", "https://synapse.d2.pub"); vi.resetModules()
    const { userSessionCookieName } = await import("./user-web-session.js")
    const { UserAuthGuard } = await import("./user-auth.guard.js")
    const { DashboardAuthController } = await import("../dashboard/dashboard-auth.controller.js")
    const { AdminAuthController, adminSessionCookieName } = await import("../admin-auth/admin-auth.controller.js")
    expect(userSessionCookieName).toBe("__Host-synapse_user_session")
    expect(adminSessionCookieName).toBe("__Host-synapse_admin_session")
    const verifyWebSession = vi.fn(async () => ({ userId: "attacker", sessionId: "s" }))
    await expect(new UserAuthGuard({ verifyWebSession } as never).canActivate({ switchToHttp: () => ({ getRequest: () => ({ method: "GET", headers: {}, cookies: { synapse_user_session: "injected" } }) }) } as never)).rejects.toMatchObject({ status: 401 })
    expect(verifyWebSession).not.toHaveBeenCalled()
    const response = { cookie: vi.fn(), clearCookie: vi.fn() }, request = { method: "POST", headers: { origin: "https://synapse.d2.pub" }, get: () => "https://synapse.d2.pub", ip: "127.0.0.1" }
    const user = new DashboardAuthController({ loginWeb: async () => ({ user: { id: "u" }, token: "test", sessionId: "s", expiresAt: new Date(Date.now() + 60000) }) } as never)
    await user.login({ email: "user@example.test", password: "password" }, request as never, response as never)
    expect(response.cookie).toHaveBeenCalledWith(userSessionCookieName, "test", expect.objectContaining({ path: "/", secure: true, httpOnly: true }))
    expect(response.cookie.mock.calls.every(([, , options]) => !Object.hasOwn(options, "domain"))).toBe(true)
    const admin = new AdminAuthController({ createSession: async () => ({ token: "admin", session: { sessionId: "s", expiresAt: new Date() } }) } as never)
    await admin.createSession({ accessSecret: "fixture" }, request as never, response as never)
    expect(response.cookie).toHaveBeenCalledWith(adminSessionCookieName, "admin", expect.objectContaining({ path: "/", secure: true, httpOnly: true }))
  })
})
