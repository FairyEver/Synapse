import { afterEach, describe, expect, it, vi } from "vitest"
import { adminApi } from "@/lib/api"
import { changeInput, render, waitFor } from "@/test/render"
import { AUDIT_ACTION_FILTER_OPTIONS, AuditLogsPage } from "./audit-logs-page"

vi.mock("@/lib/api", () => ({
  adminApi: {
    exportAuditLogs: vi.fn(),
    listAuditLogs: vi.fn(),
  },
}))

function createDeferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Promise has not been initialized.")
  }
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

describe("AuditLogsPage", () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
    vi.clearAllMocks()
  })

  it("offers known audit actions in the filter", () => {
    expect(AUDIT_ACTION_FILTER_OPTIONS).toEqual(expect.arrayContaining([
      { value: "all", label: "全部操作" },
      { value: "admin.auth.verify.failed", label: "admin.auth.verify.failed" },
      { value: "admin.invitation.create", label: "admin.invitation.create" },
      { value: "admin.invitation.delete.not_found", label: "admin.invitation.delete.not_found" },
      { value: "admin.logout", label: "admin.logout" },
      { value: "admin.user.status_update", label: "admin.user.status_update" },
      { value: "admin.team_entitlements.update", label: "admin.team_entitlements.update" },
      { value: "admin.team_permissions.update", label: "admin.team_permissions.update" },
      { value: "admin.team_role_permissions.update", label: "admin.team_role_permissions.update" },
      { value: "admin.team_member_access_roles.replace", label: "admin.team_member_access_roles.replace" },
      { value: "admin.team_member_access_role.assign", label: "admin.team_member_access_role.assign" },
      { value: "admin.team_member_access_role.remove", label: "admin.team_member_access_role.remove" },
      { value: "user.dashboard_login.disabled", label: "user.dashboard_login.disabled" },
      { value: "dashboard.login.disabled", label: "dashboard.login.disabled" },
      { value: "user.login.disabled", label: "user.login.disabled" },
      { value: "user.refresh.invalid", label: "user.refresh.invalid" },
      { value: "user.refresh.revoked", label: "user.refresh.revoked" },
      { value: "user.refresh.expired", label: "user.refresh.expired" },
      { value: "user.refresh.disabled", label: "user.refresh.disabled" },
      { value: "user.refresh.race_lost", label: "user.refresh.race_lost" },
      { value: "user.logout.success", label: "user.logout.success" },
      { value: "user.dashboard_logout", label: "user.dashboard_logout" },
      { value: "team.create", label: "team.create" },
      { value: "team.dissolve", label: "team.dissolve" },
      { value: "backup.download", label: "backup.download" },
      { value: "backup.post.failed", label: "backup.post.failed" },
      { value: "backup.delete.failed", label: "backup.delete.failed" },
      { value: "backup.scheduled", label: "backup.scheduled" },
      { value: "backup.cleanup.delete", label: "backup.cleanup.delete" },
      { value: "backup.cleanup.failed", label: "backup.cleanup.failed" },
      { value: "logs.download", label: "logs.download" },
      { value: "logs.cleanup", label: "logs.cleanup" },
    ]))
    expect(AUDIT_ACTION_FILTER_OPTIONS.length).toBeGreaterThan(1)
  })

  it("resets to the first page when date filters change", async () => {
    vi.mocked(adminApi.listAuditLogs)
      .mockResolvedValueOnce(createAuditPage({ page: 1, id: "log-1", total: 21 }))
      .mockResolvedValueOnce(createAuditPage({ page: 2, id: "log-2", total: 21 }))
      .mockResolvedValueOnce(createAuditPage({ page: 1, id: "log-filtered", total: 1 }))

    const result = await render(<AuditLogsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("log-1")
    })
    Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "下一页")
      ?.click()

    await waitFor(() => {
      expect(adminApi.listAuditLogs).toHaveBeenLastCalledWith({
        action: undefined,
        from: undefined,
        to: undefined,
        page: 2,
      })
      expect(result.container.textContent).toContain("log-2")
    })

    const fromInput = result.container.querySelector<HTMLInputElement>("input[type='date']")
    if (!fromInput) throw new Error("missing from input")
    changeInput(fromInput, "2026-05-23")

    await waitFor(() => {
      expect(adminApi.listAuditLogs).toHaveBeenLastCalledWith({
        action: undefined,
        from: "2026-05-23",
        to: undefined,
        page: 1,
      })
      expect(result.container.textContent).toContain("log-filtered")
    })
  })

  it("uses the response page size for pagination", async () => {
    vi.mocked(adminApi.listAuditLogs)
      .mockResolvedValueOnce(createAuditPage({ page: 1, id: "log-1", total: 60, pageSize: 50 }))
      .mockResolvedValueOnce(createAuditPage({ page: 2, id: "log-2", total: 60, pageSize: 50 }))

    const result = await render(<AuditLogsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("log-1")
    })
    Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "下一页")
      ?.click()

    await waitFor(() => {
      expect(adminApi.listAuditLogs).toHaveBeenLastCalledWith({
        action: undefined,
        from: undefined,
        to: undefined,
        page: 2,
      })
      expect(result.container.textContent).toContain("log-2")
    })
    const nextButton = Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "下一页")
    expect(nextButton?.disabled).toBe(true)
  })

  it("shows export failures without clearing the audit list", async () => {
    vi.mocked(adminApi.listAuditLogs).mockResolvedValue(createAuditPage({ page: 1, id: "log-1", total: 1 }))
    vi.mocked(adminApi.exportAuditLogs).mockRejectedValue(new Error("导出超过上限"))

    const result = await render(<AuditLogsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("log-1")
    })
    Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "导出 CSV")
      ?.click()

    await waitFor(() => {
      expect(result.container.textContent).toContain("导出超过上限")
      expect(result.container.textContent).toContain("log-1")
    })
  })

  it("opens formatted audit details from the table", async () => {
    vi.mocked(adminApi.listAuditLogs).mockResolvedValue(createAuditPage({
      page: 1,
      id: "log-1",
      total: 1,
      detail: { status: "disabled", ids: ["invite-1"], count: 1 },
    }))

    const result = await render(<AuditLogsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("log-1")
    })
    Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "详情")
      ?.click()

    await waitFor(() => {
      expect(document.body.textContent).toContain("审计详情")
      expect(document.body.textContent).toContain('"status": "disabled"')
      expect(document.body.textContent).toContain('"ids"')
    })
  })

  it("disables export while the CSV download is running", async () => {
    const exportRequest = createDeferred<void>()
    vi.mocked(adminApi.listAuditLogs).mockResolvedValue(createAuditPage({ page: 1, id: "log-1", total: 1 }))
    vi.mocked(adminApi.exportAuditLogs).mockReturnValue(exportRequest.promise)

    const result = await render(<AuditLogsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("log-1")
    })
    const exportButton = Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "导出 CSV")

    exportButton?.click()

    await waitFor(() => {
      expect(exportButton?.disabled).toBe(true)
      expect(exportButton?.textContent).toBe("导出中…")
    })
    exportRequest.resolve(undefined)

    await waitFor(() => {
      expect(exportButton?.disabled).toBe(false)
      expect(exportButton?.textContent).toBe("导出 CSV")
    })
  })
})

function createAuditPage(input: { page: number; id: string; total: number; pageSize?: number; detail?: unknown }) {
  return {
    data: [
      {
        id: input.id,
        adminEmail: "admin@example.com",
        action: "admin.user.status_update",
        targetType: "user",
        targetId: input.id,
        detail: input.detail ?? null,
        ipAddress: "127.0.0.1",
        createdAt: "2026-05-23T00:00:00.000Z",
      },
    ],
    total: input.total,
    page: input.page,
    pageSize: input.pageSize ?? 20,
  }
}
