import type { ExecutionContext } from "@nestjs/common"
import { UnauthorizedException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { UserAuthGuard } from "./user-auth.guard"

function context(request: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as never
}

describe("UserAuthGuard", () => {
  it("keeps cloud Console path parameters out of failed-auth audit warnings", async () => {
    const auth = { verifyWebSession: vi.fn().mockResolvedValue(null) }
    const audit = { recordWithClient: vi.fn().mockRejectedValue(new Error("audit unavailable")) }
    const logger = { warn: vi.fn() }
    const guard = new UserAuthGuard(auth as never, audit as never, logger as never)
    const request = { headers: {}, cookies: { synapse_user_session: "expired" }, method: "GET", path: "/api/console/tables/PRIVATE_TABLE/records/PRIVATE_RECORD", ip: "127.0.0.1" }
    await expect(guard.canActivate(context(request), {} as never, "/api/console/tables")).rejects.toBeInstanceOf(UnauthorizedException)
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("PRIVATE_")
    expect(audit.recordWithClient).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ detail: expect.objectContaining({ path: "/api/console/tables" }) }))
  })
  it("keeps desktop bearer access-token authentication unchanged", async () => {
    const auth = { verifyAccessToken: vi.fn().mockResolvedValue({ userId: "user-1" }) }
    const guard = new UserAuthGuard(auth as never)
    const request = { headers: { authorization: "bearer access-token" } }

    await expect(guard.canActivate(context(request))).resolves.toBe(true)
    expect(auth.verifyAccessToken).toHaveBeenCalledWith("access-token")
    expect(request).toHaveProperty("user.id", "user-1")
  })

  it("accepts only the ordinary-user Web session cookie", async () => {
    const auth = { verifyWebSession: vi.fn().mockResolvedValue({ userId: "user-1", sessionId: "session-1" }) }
    const guard = new UserAuthGuard(auth as never)
    const request = { headers: {}, cookies: { synapse_user_session: "user-token" } }

    await expect(guard.canActivate(context(request))).resolves.toBe(true)
    expect(auth.verifyWebSession).toHaveBeenCalledWith("user-token")
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
