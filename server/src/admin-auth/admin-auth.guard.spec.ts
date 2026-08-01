import { ForbiddenException, UnauthorizedException } from "@nestjs/common"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AdminAuthGuard } from "./admin-auth.guard"

function contextFor(request: unknown) {
  return { switchToHttp: () => ({ getRequest: () => request }) } as never
}

describe("AdminAuthGuard", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("accepts only an active admin session cookie", async () => {
    const auth = { verifySession: vi.fn().mockResolvedValue({ status: "active", session: { sessionId: "session-1" } }) }
    const guard = new AdminAuthGuard(auth as never)
    const request = { method: "GET", cookies: { synapse_admin_session: "token" }, ip: "127.0.0.1" }

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true)
    expect(request).toHaveProperty("admin.sessionId", "session-1")
  })

  it("rejects ordinary-user and legacy cookies", async () => {
    const auth = { recordRejectedSession: vi.fn() }
    const guard = new AdminAuthGuard(auth as never)
    const request = { method: "GET", cookies: { synapse_user_session: "user", synapse_admin: "legacy" }, ip: "127.0.0.1" }

    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it("rejects write requests without the configured trusted origin", async () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    const guard = new AdminAuthGuard({} as never)
    const request = { method: "POST", get: () => undefined }

    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(ForbiddenException)
  })
})
