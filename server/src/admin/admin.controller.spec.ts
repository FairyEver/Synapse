import { describe, expect, it, vi } from "vitest"
import { AdminController } from "./admin.controller"
import type { AdminService } from "./admin.service"
import type { AuditLogService } from "../common/audit-log.service"

function createController(
  service: Partial<AdminService>,
  auditLog: Partial<AuditLogService> = {},
) {
  return new AdminController(service as AdminService, auditLog as AuditLogService)
}

describe("AdminController", () => {
  it("returns system overview from the service", async () => {
    const getSystemOverview = vi.fn().mockResolvedValue({
      serverTime: "2026-05-21T00:00:00.000Z",
      counts: { auditLogs: 3 },
    })
    const controller = createController({ getSystemOverview })

    await expect(controller.getSystemOverview()).resolves.toMatchObject({
      counts: { auditLogs: 3 },
    })
  })

  it("passes audit log filters to the audit service", async () => {
    const list = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 20 })
    const controller = createController({}, { list })

    await controller.listAuditLogs({
      action: "admin.login",
      from: "2026-05-01",
      to: "2026-05-21",
    })

    expect(list).toHaveBeenCalledWith({
      action: "admin.login",
      from: "2026-05-01",
      to: "2026-05-21",
      query: {
        action: "admin.login",
        from: "2026-05-01",
        to: "2026-05-21",
      },
    })
  })

  it("creates signup invitations through the service", async () => {
    const createSignupInvitation = vi.fn().mockResolvedValue({ token: "plain-token" })
    const controller = createController({ createSignupInvitation } as never)

    await expect(controller.createSignupInvitation({ admin: { id: "admin-1", email: "admin@example.com" } } as never))
      .resolves
      .toEqual({ token: "plain-token" })
  })

  it("rejects invalid user status", async () => {
    const controller = createController({ updateUserStatus: vi.fn() } as never)

    await expect(controller.updateUserStatus("user-1", { status: "bad" }))
      .rejects
      .toThrow("用户状态无效。")
  })
})
