import type { ExecutionContext } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { of, lastValueFrom, throwError } from "rxjs"
import { AuditLogInterceptor } from "./audit-log.interceptor"

function createContext(options: {
  readonly method?: string
  readonly path?: string
  readonly params?: Record<string, string>
  readonly query?: Record<string, string>
  readonly body?: unknown
  readonly admin?: { id: string; email: string }
}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method: options.method ?? "POST",
        path: options.path ?? "/api/admin/login",
        params: options.params ?? {},
        query: options.query ?? {},
        body: options.body,
        ip: "127.0.0.1",
        admin: options.admin,
      }),
    }),
  } as unknown as ExecutionContext
}

describe("AuditLogInterceptor", () => {
  it("waits for successful audit writes before completing audited responses", async () => {
    let resolveRecord: (() => void) | undefined
    const recordPromise = new Promise<void>((resolve) => {
      resolveRecord = resolve
    })
    const auditLog = { record: vi.fn(() => recordPromise) }
    const auth = { getEmail: vi.fn().mockResolvedValue("admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    let completed = false
    const resultPromise = lastValueFrom(interceptor.intercept(
      createContext({ method: "GET", path: "/api/admin/backup/list" }),
      { handle: () => of([]) },
    )).then((result) => {
      completed = true
      return result
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(auditLog.record).toHaveBeenCalled()
    expect(completed).toBe(false)

    resolveRecord?.()

    await expect(resultPromise).resolves.toEqual([])
    expect(completed).toBe(true)
  })

  it("waits for failed operation audit writes before rethrowing the original error", async () => {
    let resolveRecord: (() => void) | undefined
    const recordPromise = new Promise<void>((resolve) => {
      resolveRecord = resolve
    })
    const auditLog = { record: vi.fn(() => recordPromise) }
    const auth = { getEmail: vi.fn().mockResolvedValue("admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)
    const sourceError = new Error("COS unavailable")

    let rejected = false
    const resultPromise = lastValueFrom(interceptor.intercept(
      createContext({
        method: "DELETE",
        path: "/api/admin/backup/synapse-backup.tar.gz",
        params: { filename: "synapse-backup.tar.gz" },
      }),
      { handle: () => throwError(() => sourceError) },
    ))
    resultPromise.catch(() => undefined)
    let rejection: unknown
    const observedPromise = resultPromise.catch((error) => {
      rejected = true
      rejection = error
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(auditLog.record).toHaveBeenCalled()
    expect(rejected).toBe(false)

    resolveRecord?.()

    await observedPromise
    expect(rejection).toBe(sourceError)
    expect(rejected).toBe(true)
  })

  it("preserves the original operation error when failed audit writing fails", async () => {
    const auditError = new Error("审计日志写入失败。")
    const auditLog = { record: vi.fn().mockRejectedValue(auditError) }
    const logger = { warn: vi.fn() }
    const interceptor = new AuditLogInterceptor(auditLog as never, logger as never)
    const sourceError = new Error("用户不存在。")

    await expect(lastValueFrom(interceptor.intercept(
      createContext({
        method: "PATCH",
        path: "/api/admin/users/user-1/status",
        params: { id: "user-1" },
        body: { status: "disabled" },
        admin: { id: "admin-1", email: "current-admin@example.com" },
      }),
      { handle: () => throwError(() => sourceError) },
    ))).rejects.toBe(sourceError)

    expect(auditLog.record).toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: auditError,
        action: "admin.user.status_update.failed",
        originalErrorName: "Error",
      }),
      "Failed to record audit log from interceptor",
    )
  })

  it("redacts sensitive request body fields before recording audit details", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await lastValueFrom(interceptor.intercept(
      createContext({
        path: "/api/admin/backup",
        body: {
          email: "admin@example.com",
          apiKey: "plain-api-key",
          "api-key": "plain-api-key-kebab",
          authorization: "Bearer plain-authorization",
          cookie: "sid=plain-cookie",
          password: "plain-password",
          adminNote: "private customer context",
          nested: {
            refreshToken: "refresh-token",
            headers: {
              Authorization: "Bearer nested-authorization",
              "x-api-key": "nested-api-key",
              value: "visible",
            },
          },
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
      apiKey: "[REDACTED]",
      "api-key": "[REDACTED]",
      authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      password: "[REDACTED]",
      adminNote: "[REDACTED]",
      nested: {
        refreshToken: "[REDACTED]",
        headers: {
          Authorization: "[REDACTED]",
          "x-api-key": "[REDACTED]",
          value: "visible",
        },
      },
    })
    expect(JSON.stringify(detail)).not.toContain("plain-password")
    expect(JSON.stringify(detail)).not.toContain("refresh-token")
    expect(JSON.stringify(detail)).not.toContain("plain-api-key")
    expect(JSON.stringify(detail)).not.toContain("plain-authorization")
    expect(JSON.stringify(detail)).not.toContain("plain-cookie")
    expect(JSON.stringify(detail)).not.toContain("nested-authorization")
    expect(JSON.stringify(detail)).not.toContain("private customer context")
  })

  it("does not audit non-admin write endpoints", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("first-admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await lastValueFrom(interceptor.intercept(
      createContext({
        method: "POST",
        path: "/api/auth/logout",
      }),
      { handle: () => of({ ok: true }) },
    ))

    expect(auditLog.record).not.toHaveBeenCalled()
  })

  it("records successful authenticated admin write operations as fallback audits", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("first-admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await lastValueFrom(interceptor.intercept(
      createContext({
        method: "POST",
        path: "/api/admin/settings",
        body: { displayName: "Synapse" },
        admin: { id: "admin-1", email: "current-admin@example.com" },
      }),
      { handle: () => of({ id: "settings" }) },
    ))

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "current-admin@example.com",
      action: "settings.post",
      targetType: "settings",
      targetId: "settings",
      detail: {
        method: "POST",
        path: "/api/admin/settings",
        body: { displayName: "Synapse" },
      },
      ipAddress: "127.0.0.1",
    })
  })

  it("records password reset link generation without exposing the link", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const interceptor = new AuditLogInterceptor(auditLog as never)

    await lastValueFrom(interceptor.intercept(
      createContext({
        method: "POST",
        path: "/api/admin/users/user-1/password-reset-link",
        params: { id: "user-1" },
        admin: { id: "admin-1", email: "current-admin@example.com" },
      }),
      { handle: () => of({ resetUrl: "https://app.example.com/console/reset-password?token=secret-token" }) },
    ))

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "current-admin@example.com",
      action: "admin.user.password_reset_link_create",
      targetType: "user",
      targetId: "user-1",
      detail: {
        method: "POST",
        path: "/api/admin/users/user-1/password-reset-link",
        body: undefined,
      },
      ipAddress: "127.0.0.1",
    })
    expect(JSON.stringify(auditLog.record.mock.calls)).not.toContain("secret-token")
  })

  it("does not fallback-audit successful authenticated admin read operations", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("first-admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await lastValueFrom(interceptor.intercept(
      createContext({
        method: "GET",
        path: "/api/admin/users",
        admin: { id: "admin-1", email: "current-admin@example.com" },
      }),
      { handle: () => of({ data: [], total: 0 }) },
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
        method: "PATCH",
        path: "/api/admin/users/user-1/status",
        params: { id: "user-1" },
      }),
      { handle: () => of({ ok: true }) },
    ))

    expect(auditLog.record).not.toHaveBeenCalled()
  })

  it("leaves successful admin note audits to the service", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const interceptor = new AuditLogInterceptor(auditLog as never)

    await lastValueFrom(interceptor.intercept(
      createContext({
        method: "PATCH",
        path: "/api/admin/users/user-1/admin-note",
        params: { id: "user-1" },
        body: { adminNote: "private customer context" },
        admin: { id: "admin-1", email: "current-admin@example.com" },
      }),
      { handle: () => of({ ok: true }) },
    ))

    expect(auditLog.record).not.toHaveBeenCalled()
  })

  it("redacts admin note bodies from failed operation audits", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const interceptor = new AuditLogInterceptor(auditLog as never)

    await expect(lastValueFrom(interceptor.intercept(
      createContext({
        method: "PATCH",
        path: "/api/admin/users/user-1/admin-note",
        params: { id: "user-1" },
        body: { adminNote: "private customer context" },
        admin: { id: "admin-1", email: "current-admin@example.com" },
      }),
      { handle: () => throwError(() => new Error("用户不存在。")) },
    ))).rejects.toThrow("用户不存在。")

    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "admin.user.admin_note_update.failed",
      targetType: "user",
      targetId: "user-1",
      detail: expect.objectContaining({
        body: { adminNote: "[REDACTED]" },
      }),
    }))
    expect(JSON.stringify(auditLog.record.mock.calls)).not.toContain("private customer context")
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

  it("redacts sensitive failed operation errors before recording audit details", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("first-admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)
    const rawError = [
      "COS failed Authorization: Bearer secret-bearer",
      "token=plain-token",
      "apiKey=plain-api-key",
      "https://user:password@internal.example.com/bucket/key",
      "/Users/liyang/private/backup.sql",
    ].join(" ")

    await expect(lastValueFrom(interceptor.intercept(
      createContext({
        method: "GET",
        path: "/api/admin/logs/recent",
        admin: { id: "admin-1", email: "current-admin@example.com" },
      }),
      { handle: () => throwError(() => new Error(rawError)) },
    ))).rejects.toThrow(rawError)

    await vi.waitFor(() => {
      expect(auditLog.record).toHaveBeenCalled()
    })
    const detail = auditLog.record.mock.calls[0]?.[0].detail
    expect(detail.error).toContain("[REDACTED]")
    expect(JSON.stringify(detail)).not.toContain("secret-bearer")
    expect(JSON.stringify(detail)).not.toContain("plain-token")
    expect(JSON.stringify(detail)).not.toContain("plain-api-key")
    expect(JSON.stringify(detail)).not.toContain("internal.example.com")
    expect(JSON.stringify(detail)).not.toContain("/Users/liyang/private")
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

  it("uses cleanup query dates as failed log cleanup audit targets", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("first-admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await expect(lastValueFrom(interceptor.intercept(
      createContext({
        method: "DELETE",
        path: "/api/admin/logs/cleanup",
        query: { before: "2026-06-04" },
        admin: { id: "admin-1", email: "current-admin@example.com" },
      }),
      { handle: () => throwError(() => new Error("部分日志清理失败，请检查系统日志。")) },
    ))).rejects.toThrow("部分日志清理失败，请检查系统日志。")

    await vi.waitFor(() => {
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
        adminEmail: "current-admin@example.com",
        action: "logs.cleanup.failed",
        targetType: "logs",
        targetId: "2026-06-04",
      }))
    })
  })

  it("uses download query ranges as failed log download audit targets", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("first-admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await expect(lastValueFrom(interceptor.intercept(
      createContext({
        method: "GET",
        path: "/api/admin/logs/download",
        query: { from: "2026-05-01", to: "2026-05-23" },
        admin: { id: "admin-1", email: "current-admin@example.com" },
      }),
      { handle: () => throwError(() => new Error("zip stream failed")) },
    ))).rejects.toThrow("zip stream failed")

    await vi.waitFor(() => {
      expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
        adminEmail: "current-admin@example.com",
        action: "logs.download.failed",
        targetType: "logs",
        targetId: "logs-2026-05-01-2026-05-23.zip",
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
