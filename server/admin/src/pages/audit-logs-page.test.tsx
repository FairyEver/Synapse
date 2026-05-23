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
      { value: "admin.invitation.create", label: "admin.invitation.create" },
      { value: "admin.user.status_update", label: "admin.user.status_update" },
      { value: "dashboard.login.disabled", label: "dashboard.login.disabled" },
      { value: "team.create", label: "team.create" },
      { value: "backup.download", label: "backup.download" },
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
})

function createAuditPage(input: { page: number; id: string; total: number; pageSize?: number }) {
  return {
    data: [
      {
        id: input.id,
        adminEmail: "admin@example.com",
        action: "admin.user.status_update",
        targetType: "user",
        targetId: input.id,
        detail: null,
        ipAddress: "127.0.0.1",
        createdAt: "2026-05-23T00:00:00.000Z",
      },
    ],
    total: input.total,
    page: input.page,
    pageSize: input.pageSize ?? 20,
  }
}
