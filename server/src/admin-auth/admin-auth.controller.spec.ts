import { describe, expect, it, vi } from "vitest"
import { AdminAuthController } from "./admin-auth.controller"
import type { AdminRequest } from "./admin-auth.guard"

describe("AdminAuthController", () => {
  it("records administrator logout in audit logs", async () => {
    const auth = {
      verify: vi.fn().mockResolvedValue({ id: "admin-1", email: "admin@example.com" }),
    }
    const auditLog = { record: vi.fn() }
    const controller = new AdminAuthController(auth as never, auditLog as never)
    const response = { clearCookie: vi.fn() }
    const request = {
      cookies: { synapse_admin: "admin-token" },
      ip: "203.0.113.12",
    } as unknown as AdminRequest

    await controller.logout(response as never, request)

    expect(response.clearCookie).toHaveBeenCalledWith("synapse_admin")
    expect(auth.verify).toHaveBeenCalledWith("admin-token")
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.logout",
      targetType: "admin",
      targetId: "admin-1",
      ipAddress: "203.0.113.12",
    })
  })
})
