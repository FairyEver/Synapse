import { describe, expect, it, vi } from "vitest"
import { AdminAuthController } from "./admin-auth.controller"
import type { AdminRequest } from "./admin-auth.guard"

describe("AdminAuthController", () => {
  it("sets administrator session cookies with shared options", async () => {
    const auth = {
      login: vi.fn().mockResolvedValue({
        email: "admin@example.com",
        role: "admin",
        token: "admin-token",
      }),
    }
    const controller = new AdminAuthController(auth as never)
    const response = { cookie: vi.fn() }
    const request = { ip: "203.0.113.11" } as unknown as AdminRequest

    await expect(controller.login({
      email: "admin@example.com",
      password: "secret",
    }, request, response as never)).resolves.toEqual({
      email: "admin@example.com",
      role: "admin",
    })

    expect(response.cookie).toHaveBeenCalledWith("synapse_admin", "admin-token", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    })
  })

  it("records administrator logout in audit logs", async () => {
    const auth = {
      revokeDashboardSession: vi.fn().mockResolvedValue(undefined),
      verifyDashboardSession: vi.fn().mockResolvedValue({ id: "admin-1", email: "admin@example.com", role: "admin" }),
    }
    const auditLog = { record: vi.fn() }
    const controller = new AdminAuthController(auth as never, auditLog as never)
    const response = { clearCookie: vi.fn() }
    const request = {
      cookies: { synapse_admin: "admin-token" },
      ip: "203.0.113.12",
    } as unknown as AdminRequest

    await controller.logout(response as never, request)

    expect(response.clearCookie).toHaveBeenCalledWith("synapse_admin", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    })
    expect(auth.verifyDashboardSession).toHaveBeenCalledWith("admin-token")
    expect(auth.revokeDashboardSession).toHaveBeenCalledWith("admin-token")
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.logout",
      targetType: "admin",
      targetId: "admin-1",
      ipAddress: "203.0.113.12",
    })
  })

  it("records dashboard user logout in audit logs", async () => {
    const auth = {
      revokeDashboardSession: vi.fn().mockResolvedValue(undefined),
      verifyDashboardSession: vi.fn().mockResolvedValue({ id: "user-1", email: "user@example.com", role: "user" }),
    }
    const auditLog = { record: vi.fn() }
    const controller = new AdminAuthController(auth as never, auditLog as never)
    const response = { clearCookie: vi.fn() }
    const request = {
      cookies: { synapse_admin: "user-token" },
      ip: "203.0.113.12",
    } as unknown as AdminRequest

    await controller.logout(response as never, request)

    expect(auth.revokeDashboardSession).toHaveBeenCalledWith("user-token")
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "user@example.com",
      action: "user.dashboard_logout",
      targetType: "user",
      targetId: "user-1",
      ipAddress: "203.0.113.12",
    })
  })
})
