import type { ExecutionContext } from "@nestjs/common"
import { UnauthorizedException } from "@nestjs/common"
import { afterEach, describe, expect, it, vi } from "vitest"
import { UserAuthGuard } from "./user-auth.guard"

function context(request: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as never
}

describe("UserAuthGuard", () => {
  afterEach(() => vi.unstubAllEnvs())
  it("still rejects cross-origin cookie writes after the tunnel runtime is disabled", async () => {
    vi.stubEnv("TUNNEL_ENABLED", "false"); vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    const guard = new UserAuthGuard({ verifyWebSession: async () => ({ userId: "u", sessionId: "s" }) } as never)
    await expect(guard.canActivate(context({ method: "POST", headers: { origin: "https://evil.tunnel.test" }, cookies: { synapse_user_session: "token" } }))).rejects.toMatchObject({ status: 403 })
  })
  it("keeps cloud Console path parameters out of failed-auth audit warnings", async () => {
    const auth = { verifyWebSession: vi.fn().mockResolvedValue(null) }
    const audit = { recordWithClient: vi.fn().mockRejectedValue(new Error("audit unavailable")) }
    const logger = { warn: vi.fn() }
    const guard = new UserAuthGuard(auth as never, audit as never, logger as never)
    const request = { method: "GET", headers: {}, cookies: { synapse_user_session: "expired" }, path: "/api/console/tables/PRIVATE_TABLE/records/PRIVATE_RECORD", ip: "127.0.0.1" }
    await expect(guard.canActivate(context(request), {} as never, "/api/console/tables")).rejects.toBeInstanceOf(UnauthorizedException)
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("PRIVATE_")
    expect(audit.recordWithClient).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ detail: expect.objectContaining({ path: "/api/console/tables" }) }))
  })
  it("keeps desktop bearer access-token authentication unchanged", async () => {
    const auth = { verifyAccessToken: vi.fn().mockResolvedValue({ userId: "user-1" }) }
    const guard = new UserAuthGuard(auth as never)
    const request = { method: "GET", headers: { authorization: "bearer access-token" } }

    await expect(guard.canActivate(context(request))).resolves.toBe(true)
    expect(auth.verifyAccessToken).toHaveBeenCalledWith("access-token")
    expect(request).toHaveProperty("user.id", "user-1")
  })

  it("accepts only the ordinary-user Web session cookie", async () => {
    const auth = { verifyWebSession: vi.fn().mockResolvedValue({ userId: "user-1", sessionId: "session-1" }) }
    const guard = new UserAuthGuard(auth as never)
    const request = { method: "GET", headers: {}, cookies: { synapse_user_session: "user-token" } }

    await expect(guard.canActivate(context(request))).resolves.toBe(true)
    expect(auth.verifyWebSession).toHaveBeenCalledWith("user-token")
  })

  it("binds a stale Hub Console request to the session that started it", async () => {
    const auth = { verifyWebSession: vi.fn().mockResolvedValue({ userId: "user-2", sessionId: "session-2" }) }
    const guard = new UserAuthGuard(auth as never)
    const request = { method: "GET", headers: { "x-skill-hub-session": "session-1" }, cookies: { synapse_user_session: "user-token" },
      path: "/api/skill-hub/skills" }
    await expect(guard.canActivate(context(request))).rejects.toMatchObject({ response: { code: "HUB_ACCOUNT_CHANGED" } })
    expect(request).not.toHaveProperty("user")
    request.headers["x-skill-hub-session"] = "session-2"
    await expect(guard.canActivate(context(request))).resolves.toBe(true)
    expect(request).toHaveProperty("user.id", "user-2")
  })

  it("does not accept admin or legacy dashboard cookies", async () => {
    const auth = { verifyWebSession: vi.fn() }
    const guard = new UserAuthGuard(auth as never)

    await expect(guard.canActivate(context({
      headers: {},
      cookies: { synapse_admin_session: "admin", synapse_admin: "legacy" },
    }))).rejects.toBeInstanceOf(UnauthorizedException)
    expect(auth.verifyWebSession).not.toHaveBeenCalled()
  })
})
