import type { ExecutionContext } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { of, lastValueFrom, throwError } from "rxjs"
import { AuditLogInterceptor } from "./audit-log.interceptor"

function createContext(options: {
  readonly method?: string
  readonly path?: string
  readonly params?: Record<string, string>
  readonly body?: unknown
  readonly admin?: { id: string; email: string }
}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method: options.method ?? "POST",
        path: options.path ?? "/api/admin/login",
        params: options.params ?? {},
        body: options.body,
        ip: "127.0.0.1",
        admin: options.admin,
      }),
    }),
  } as unknown as ExecutionContext
}

describe("AuditLogInterceptor", () => {
  it("redacts sensitive request body fields before recording audit details", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await lastValueFrom(interceptor.intercept(
      createContext({
        path: "/api/admin/backup",
        body: {
          email: "admin@example.com",
          password: "plain-password",
          nested: { refreshToken: "refresh-token" },
        },
      }),
      { handle: () => of({ id: "session-1" }) },
    ))

    await vi.waitFor(() => {
      expect(auditLog.record).toHaveBeenCalled()
    })
    const detail = auditLog.record.mock.calls[0]?.[0].detail
    expect(detail.body).toEqual({
      email: "admin@example.com",
      password: "[REDACTED]",
      nested: { refreshToken: "[REDACTED]" },
    })
    expect(JSON.stringify(detail)).not.toContain("plain-password")
    expect(JSON.stringify(detail)).not.toContain("refresh-token")
  })

  it("does not audit non-admin write endpoints", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("first-admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await lastValueFrom(interceptor.intercept(
      createContext({
        method: "POST",
        path: "/api/teams",
      }),
      { handle: () => of({ id: "team-1" }) },
    ))

    expect(auditLog.record).not.toHaveBeenCalled()
  })

  it("records backup list reads because backups are sensitive admin data", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await lastValueFrom(interceptor.intercept(
      createContext({ method: "GET", path: "/api/admin/backup/list" }),
      { handle: () => of([]) },
    ))

    await vi.waitFor(() => {
      expect(auditLog.record).toHaveBeenCalledWith({
        adminEmail: "admin@example.com",
        action: "backup.list",
        targetType: "backup",
        targetId: "unknown",
        detail: { method: "GET", path: "/api/admin/backup/list", body: undefined },
        ipAddress: "127.0.0.1",
      })
    })
  })

  it("attributes backup audits to the current request admin", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("first-admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await lastValueFrom(interceptor.intercept(
      createContext({
        method: "GET",
        path: "/api/admin/backup/list",
        admin: { id: "admin-2", email: "current-admin@example.com" },
      }),
      { handle: () => of([]) },
    ))

    await vi.waitFor(() => {
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
        adminEmail: "current-admin@example.com",
        action: "backup.list",
      }))
    })
    expect(auth.getEmail).not.toHaveBeenCalled()
  })

  it("records backup downloads because backup contents are sensitive", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await lastValueFrom(interceptor.intercept(
      createContext({
        method: "GET",
        path: "/api/admin/backup/download/synapse-backup.tar.gz",
        params: { filename: "synapse-backup.tar.gz" },
      }),
      { handle: () => of(Buffer.from("backup")) },
    ))

    await vi.waitFor(() => {
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
        action: "backup.download",
        targetType: "backup",
        targetId: "synapse-backup.tar.gz",
      }))
    })
  })

  it("uses backup result filenames as backup trigger audit targets", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await lastValueFrom(interceptor.intercept(
      createContext({
        method: "POST",
        path: "/api/admin/backup",
      }),
      { handle: () => of({ filename: "synapse-backup-20260523.tar.gz", status: "success" }) },
    ))

    await vi.waitFor(() => {
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
        action: "backup.post",
        targetType: "backup",
        targetId: "synapse-backup-20260523.tar.gz",
      }))
    })
  })

  it("does not duplicate admin service audit records", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("first-admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await lastValueFrom(interceptor.intercept(
      createContext({
        method: "DELETE",
        path: "/api/admin/invitations/invite-1",
        params: { id: "invite-1" },
      }),
      { handle: () => of({ ok: true }) },
    ))

    expect(auditLog.record).not.toHaveBeenCalled()
  })

  it("records failed authenticated admin operations without duplicating service success audits", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("first-admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await expect(lastValueFrom(interceptor.intercept(
      createContext({
        method: "PATCH",
        path: "/api/admin/users/user-1/status",
        params: { id: "user-1" },
        body: { status: "disabled" },
        admin: { id: "admin-1", email: "current-admin@example.com" },
      }),
      { handle: () => throwError(() => new Error("用户不存在。")) },
    ))).rejects.toThrow("用户不存在。")

    await vi.waitFor(() => {
      expect(auditLog.record).toHaveBeenCalledWith({
        adminEmail: "current-admin@example.com",
        action: "admin.user.status_update.failed",
        targetType: "user",
        targetId: "user-1",
        detail: {
          method: "PATCH",
          path: "/api/admin/users/user-1/status",
          body: { status: "disabled" },
          error: "用户不存在。",
        },
        ipAddress: "127.0.0.1",
      })
    })
    expect(auth.getEmail).not.toHaveBeenCalled()
  })

  it("records failed team role permission updates with the service audit action", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("first-admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await expect(lastValueFrom(interceptor.intercept(
      createContext({
        method: "PUT",
        path: "/api/admin/teams/team-1/access-roles/role-1/permissions",
        params: { teamId: "team-1", roleId: "role-1" },
        body: { permissionKeys: ["database.use"] },
        admin: { id: "admin-1", email: "current-admin@example.com" },
      }),
      { handle: () => throwError(() => new Error("角色不存在。")) },
    ))).rejects.toThrow("角色不存在。")

    await vi.waitFor(() => {
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
        adminEmail: "current-admin@example.com",
        action: "admin.team_role_permissions.update.failed",
        targetType: "team_access_role",
        targetId: "role-1",
      }))
    })
  })

  it("records failed atomic team permission replacements with the service audit action", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("first-admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await expect(lastValueFrom(interceptor.intercept(
      createContext({
        method: "PUT",
        path: "/api/admin/teams/team-1/permissions",
        params: { teamId: "team-1" },
        body: {
          permissionKeys: ["database.use"],
          rolePermissions: [{ roleId: "role-1", permissionKeys: ["database.use"] }],
        },
        admin: { id: "admin-1", email: "current-admin@example.com" },
      }),
      { handle: () => throwError(() => new Error("权限不存在。")) },
    ))).rejects.toThrow("权限不存在。")

    await vi.waitFor(() => {
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
        adminEmail: "current-admin@example.com",
        action: "admin.team_permissions.update.failed",
        targetType: "team",
        targetId: "team-1",
      }))
    })
  })

  it("records failed team member access role assignments with the service audit action", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("first-admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await expect(lastValueFrom(interceptor.intercept(
      createContext({
        method: "POST",
        path: "/api/admin/teams/team-1/members/membership-1/access-roles",
        params: { teamId: "team-1", membershipId: "membership-1" },
        body: { roleId: "role-1" },
        admin: { id: "admin-1", email: "current-admin@example.com" },
      }),
      { handle: () => throwError(() => new Error("成员不存在。")) },
    ))).rejects.toThrow("成员不存在。")

    await vi.waitFor(() => {
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
        adminEmail: "current-admin@example.com",
        action: "admin.team_member_access_role.assign.failed",
        targetType: "team_membership",
        targetId: "membership-1",
      }))
    })
  })

  it("records failed team member access role replacements with the service audit action", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("first-admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await expect(lastValueFrom(interceptor.intercept(
      createContext({
        method: "PUT",
        path: "/api/admin/teams/team-1/members/membership-1/access-roles",
        params: { teamId: "team-1", membershipId: "membership-1" },
        body: { roleIds: ["role-1"] },
        admin: { id: "admin-1", email: "current-admin@example.com" },
      }),
      { handle: () => throwError(() => new Error("成员不存在。")) },
    ))).rejects.toThrow("成员不存在。")

    await vi.waitFor(() => {
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
        adminEmail: "current-admin@example.com",
        action: "admin.team_member_access_roles.replace.failed",
        targetType: "team_membership",
        targetId: "membership-1",
      }))
    })
  })

  it("records failed team member access role removals with the service audit action", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("first-admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await expect(lastValueFrom(interceptor.intercept(
      createContext({
        method: "DELETE",
        path: "/api/admin/teams/team-1/members/membership-1/access-roles/role-1",
        params: { teamId: "team-1", membershipId: "membership-1", roleId: "role-1" },
        admin: { id: "admin-1", email: "current-admin@example.com" },
      }),
      { handle: () => throwError(() => new Error("成员角色不存在。")) },
    ))).rejects.toThrow("成员角色不存在。")

    await vi.waitFor(() => {
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
        adminEmail: "current-admin@example.com",
        action: "admin.team_member_access_role.remove.failed",
        targetType: "team_membership",
        targetId: "membership-1",
      }))
    })
  })

  it("keeps automatic audit records for backup writes", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await lastValueFrom(interceptor.intercept(
      createContext({
        method: "DELETE",
        path: "/api/admin/backup/synapse-backup.tar.gz",
        params: { filename: "synapse-backup.tar.gz" },
      }),
      { handle: () => of({ ok: true }) },
    ))

    await vi.waitFor(() => {
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
        action: "backup.delete",
        targetType: "backup",
        targetId: "synapse-backup.tar.gz",
      }))
    })
  })

  it("records failed backup operations", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await expect(lastValueFrom(interceptor.intercept(
      createContext({
        method: "DELETE",
        path: "/api/admin/backup/synapse-backup.tar.gz",
        params: { filename: "synapse-backup.tar.gz" },
      }),
      { handle: () => throwError(() => new Error("COS unavailable")) },
    ))).rejects.toThrow("COS unavailable")

    await vi.waitFor(() => {
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
        action: "backup.delete.failed",
        targetType: "backup",
        targetId: "synapse-backup.tar.gz",
        detail: {
          method: "DELETE",
          path: "/api/admin/backup/synapse-backup.tar.gz",
          body: undefined,
          error: "COS unavailable",
        },
      }))
    })
  })
})
