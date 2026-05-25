import type { ExecutionContext } from "@nestjs/common"
import { ForbiddenException, UnauthorizedException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { AdminAuthGuard } from "./admin-auth.guard"

function createContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext
}

describe("AdminAuthGuard", () => {
  it("records audit logs when an admin cookie cannot be verified", async () => {
    const auth = { verifyDashboardSession: vi.fn().mockResolvedValue(null) }
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const guard = new AdminAuthGuard(auth as never, auditLog as never)

    await expect(guard.canActivate(createContext({
      method: "GET",
      path: "/api/admin/system",
      ip: "203.0.113.30",
      cookies: { synapse_admin: "invalid-token" },
    }))).rejects.toThrow(UnauthorizedException)

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "unknown",
      action: "admin.auth.verify.failed",
      targetType: "auth",
      targetId: "unknown",
      detail: {
        method: "GET",
        path: "/api/admin/system",
        tokenPresent: true,
      },
      ipAddress: "203.0.113.30",
    })
  })

  it("rejects dashboard user cookies as forbidden without recording admin auth failure", async () => {
    const auth = {
      verifyDashboardSession: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "user@example.com",
        role: "user",
      }),
    }
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const guard = new AdminAuthGuard(auth as never, auditLog as never)

    await expect(guard.canActivate(createContext({
      method: "GET",
      path: "/api/admin/system",
      ip: "203.0.113.30",
      cookies: { synapse_admin: "user-token" },
    }))).rejects.toThrow(ForbiddenException)

    expect(auditLog.record).not.toHaveBeenCalled()
  })
})
