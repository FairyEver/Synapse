import { afterEach, describe, expect, it, vi } from "vitest"
import { adminApi } from "./api"

describe("adminApi", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("uses /api/admin for admin session and dashboard data", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "Content-Type": "application/json" }),
      json: () => Promise.resolve({ email: "admin@synapse.com" }),
    })
    vi.stubGlobal("fetch", fetchMock)

    await adminApi.getSession()
    await adminApi.login({ email: "admin@synapse.com", password: "password" })
    await adminApi.logout()
    await adminApi.listBackups()
    await adminApi.triggerBackup()
    await adminApi.deleteBackup("synapse-backup.tar.gz")
    await adminApi.updateUserStatus("user-1", "disabled")

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/admin/session",
      expect.objectContaining({ credentials: "include" }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/admin/login",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/admin/logout",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/admin/backup/list",
      expect.objectContaining({ credentials: "include" }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "/api/admin/backup",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      "/api/admin/backup/synapse-backup.tar.gz",
      expect.objectContaining({ method: "DELETE", credentials: "include" }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      7,
      "/api/admin/users/user-1/status",
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        body: JSON.stringify({ status: "disabled" }),
      }),
    )
  })

  it("opens admin exports under /api/admin", () => {
    const openMock = vi.fn()
    vi.stubGlobal("open", openMock)

    adminApi.exportAuditLogs({ action: "users.post" })
    adminApi.downloadLogs({ from: "2026-05-01" })
    adminApi.downloadBackup("synapse backup.tar.gz")

    expect(openMock).toHaveBeenNthCalledWith(
      1,
      "/api/admin/audit-logs/export?action=users.post",
      "_blank",
    )
    expect(openMock).toHaveBeenNthCalledWith(
      2,
      "/api/admin/logs/download?from=2026-05-01",
      "_blank",
    )
    expect(openMock).toHaveBeenNthCalledWith(
      3,
      "/api/admin/backup/download/synapse%20backup.tar.gz",
      "_blank",
    )
  })
})
