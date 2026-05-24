import type { ExecutionContext } from "@nestjs/common"
import { UnauthorizedException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { TeamsAuthGuard } from "./teams-auth.guard"

function createContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext
}

describe("TeamsAuthGuard", () => {
  it("accepts bearer auth scheme case-insensitively", async () => {
    const userAuth = { verifyAccessToken: vi.fn().mockResolvedValue({ userId: "user-1" }) }
    const dashboardAuth = { verifyDashboardSession: vi.fn() }
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const guard = new TeamsAuthGuard(userAuth as never, dashboardAuth as never, auditLog as never)
    const request = {
      method: "POST",
      path: "/api/teams",
      ip: "203.0.113.32",
      headers: { authorization: "bearer access-token" },
    }

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true)

    expect(userAuth.verifyAccessToken).toHaveBeenCalledWith("access-token")
    expect(request).toMatchObject({ user: { id: "user-1" } })
    expect(auditLog.record).not.toHaveBeenCalled()
  })

  it("records audit logs when a dashboard cookie is not a user session", async () => {
    const userAuth = { verifyAccessToken: vi.fn() }
    const dashboardAuth = {
      verifyDashboardSession: vi.fn().mockResolvedValue({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin",
      }),
    }
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const guard = new TeamsAuthGuard(userAuth as never, dashboardAuth as never, auditLog as never)

    await expect(guard.canActivate(createContext({
      method: "POST",
      path: "/api/teams",
      ip: "203.0.113.32",
      headers: {},
      cookies: { synapse_admin: "admin-token" },
    }))).rejects.toThrow(UnauthorizedException)

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "unknown",
      action: "teams.auth.verify.failed",
      targetType: "auth",
      targetId: "unknown",
      detail: {
        method: "POST",
        path: "/api/teams",
        tokenPresent: true,
      },
      ipAddress: "203.0.113.32",
    })
  })
})
