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

  it("records unauthenticated backup list reads without attributing them to the first admin", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("first-admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await lastValueFrom(interceptor.intercept(
      createContext({ method: "GET", path: "/api/admin/backup/list" }),
      { handle: () => of([]) },
    ))

    await vi.waitFor(() => {
      expect(auditLog.record).toHaveBeenCalledWith({
        adminEmail: "unauthenticated",
        action: "backup.list",
        targetType: "backup",
        targetId: "list",
        detail: { method: "GET", path: "/api/admin/backup/list", body: undefined },
        ipAddress: "127.0.0.1",
      })
    })
    expect(auth.getEmail).not.toHaveBeenCalled()
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

  it("leaves backup download audit records to the streaming controller", async () => {
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

    expect(auditLog.record).not.toHaveBeenCalled()
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

  it("uses backup failure filenames as backup trigger audit targets", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)
    const error = Object.assign(new Error("备份失败：COS unavailable"), {
      filename: "synapse-backup-20260523.tar.gz",
    })

    await expect(lastValueFrom(interceptor.intercept(
      createContext({
        method: "POST",
        path: "/api/admin/backup",
      }),
      { handle: () => throwError(() => error) },
    ))).rejects.toThrow("备份失败：COS unavailable")

    await vi.waitFor(() => {
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
        action: "backup.post.failed",
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

  it("records failed module permission updates with the module permission audit action", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("first-admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await expect(lastValueFrom(interceptor.intercept(
      createContext({
        method: "PUT",
        path: "/api/admin/users/user-1/module-permissions",
        params: { id: "user-1" },
        body: { permissionKeys: ["module.unknown"] },
        admin: { id: "admin-1", email: "current-admin@example.com" },
      }),
      { handle: () => throwError(() => new Error("用户模块权限无效。")) },
    ))).rejects.toThrow("用户模块权限无效。")

    await vi.waitFor(() => {
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
        adminEmail: "current-admin@example.com",
        action: "admin.user_module_permissions.replace.failed",
        targetType: "user",
        targetId: "user-1",
      }))
    })
  })

  it("records failed log file list reads with the controller audit action", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("first-admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await expect(lastValueFrom(interceptor.intercept(
      createContext({
        method: "GET",
        path: "/api/admin/logs/files",
        admin: { id: "admin-1", email: "current-admin@example.com" },
      }),
      { handle: () => throwError(() => new Error("日志目录不可读。")) },
    ))).rejects.toThrow("日志目录不可读。")

    await vi.waitFor(() => {
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
        adminEmail: "current-admin@example.com",
        action: "logs.list_files.failed",
        targetType: "logs",
        targetId: "files",
      }))
    })
  })

  it("records failed recent log reads with the controller audit action", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("first-admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await expect(lastValueFrom(interceptor.intercept(
      createContext({
        method: "GET",
        path: "/api/admin/logs/recent",
        admin: { id: "admin-1", email: "current-admin@example.com" },
      }),
      { handle: () => throwError(() => new Error("日志读取失败。")) },
    ))).rejects.toThrow("日志读取失败。")

    await vi.waitFor(() => {
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
        adminEmail: "current-admin@example.com",
        action: "logs.recent.failed",
        targetType: "logs",
        targetId: "recent",
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

  it("records failed unauthenticated backup operations without attributing them to the first admin", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("first-admin@example.com") }
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
        adminEmail: "unauthenticated",
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
    expect(auth.getEmail).not.toHaveBeenCalled()
  })
})
