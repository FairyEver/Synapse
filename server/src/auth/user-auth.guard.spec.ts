import type { ExecutionContext } from "@nestjs/common"
import { UnauthorizedException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { UserAuthGuard } from "./user-auth.guard"

function createContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext
}

describe("UserAuthGuard", () => {
  it("records audit logs when a bearer token cannot be verified", async () => {
    const auth = { verifyAccessToken: vi.fn().mockRejectedValue(new UnauthorizedException("未登录或登录已过期。")) }
    const dashboardAuth = { verifyDashboardSession: vi.fn() }
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const guard = new UserAuthGuard(auth as never, dashboardAuth as never, auditLog as never)

    await expect(guard.canActivate(createContext({
      method: "GET",
      path: "/api/auth/me",
      ip: "203.0.113.31",
      headers: { authorization: "Bearer invalid-token" },
    }))).rejects.toThrow(UnauthorizedException)

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "unknown",
      action: "user.auth.verify.failed",
      targetType: "auth",
      targetId: "unknown",
      detail: {
        method: "GET",
        path: "/api/auth/me",
        tokenPresent: true,
      },
      ipAddress: "203.0.113.31",
    })
  })

  it("accepts dashboard user cookies for /api/auth/me", async () => {
    const auth = { verifyAccessToken: vi.fn() }
    const dashboardAuth = {
      verifyDashboardSession: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "user@example.com",
        role: "user",
      }),
    }
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const guard = new UserAuthGuard(auth as never, dashboardAuth as never, auditLog as never)
    const request = {
      method: "GET",
      path: "/api/auth/me",
      ip: "203.0.113.32",
      headers: {},
      cookies: { synapse_admin: "dashboard-cookie" },
    }

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true)

    expect(dashboardAuth.verifyDashboardSession).toHaveBeenCalledWith("dashboard-cookie")
    expect(request).toMatchObject({ user: { id: "user-1" } })
    expect(auditLog.record).not.toHaveBeenCalled()
  })

  it("rejects dashboard admin cookies for user auth routes", async () => {
    const auth = { verifyAccessToken: vi.fn() }
    const dashboardAuth = {
      verifyDashboardSession: vi.fn().mockResolvedValue({
        id: "admin-1",
        email: "admin@example.com",
        role: "admin",
      }),
    }
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const guard = new UserAuthGuard(auth as never, dashboardAuth as never, auditLog as never)

    await expect(guard.canActivate(createContext({
      method: "GET",
      path: "/api/auth/me",
      ip: "203.0.113.33",
      headers: {},
      cookies: { synapse_admin: "admin-cookie" },
    }))).rejects.toThrow(UnauthorizedException)

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "unknown",
      action: "user.auth.verify.failed",
      targetType: "auth",
      targetId: "unknown",
      detail: {
        method: "GET",
        path: "/api/auth/me",
        tokenPresent: true,
      },
      ipAddress: "203.0.113.33",
    })
  })
})
