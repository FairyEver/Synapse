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
    await adminApi.cleanupLogs("2026-05-01")
    await adminApi.updateUserStatus("user-1", "disabled")
    await adminApi.listTeamAccessRoles("team-1")
    await adminApi.replaceTeamPermissions("team-1", {
      permissionKeys: ["database.use"],
      rolePermissions: [{ roleId: "role-1", permissionKeys: ["database.use"] }],
    })
    await adminApi.replaceTeamRolePermissions("team-1", "role-1", ["database.use"])
    await adminApi.listMemberAccessRoles("team-1", "membership-1")
    await adminApi.assignMemberAccessRole("team-1", "membership-1", "role-1")
    await adminApi.removeMemberAccessRole("team-1", "membership-1", "role-1")

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
      "/api/admin/logs/cleanup?before=2026-05-01",
      expect.objectContaining({ method: "DELETE", credentials: "include" }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      8,
      "/api/admin/users/user-1/status",
      expect.objectContaining({
        method: "PATCH",
        credentials: "include",
        body: JSON.stringify({ status: "disabled" }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      9,
      "/api/admin/teams/team-1/access-roles",
      expect.objectContaining({ credentials: "include" }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      10,
      "/api/admin/teams/team-1/permissions",
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        body: JSON.stringify({
          permissionKeys: ["database.use"],
          rolePermissions: [{ roleId: "role-1", permissionKeys: ["database.use"] }],
        }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      11,
      "/api/admin/teams/team-1/access-roles/role-1/permissions",
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        body: JSON.stringify({ permissionKeys: ["database.use"] }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      12,
      "/api/admin/teams/team-1/members/membership-1/access-roles",
      expect.objectContaining({ credentials: "include" }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      13,
      "/api/admin/teams/team-1/members/membership-1/access-roles",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ roleId: "role-1" }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      14,
      "/api/admin/teams/team-1/members/membership-1/access-roles/role-1",
      expect.objectContaining({ method: "DELETE", credentials: "include" }),
    )
  })

  it("starts admin downloads under /api/admin without opening popups", () => {
    const openMock = vi.fn()
    vi.stubGlobal("open", openMock)
    const clicked: Array<{ readonly href: string | null; readonly download: string }> = []
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click(this: HTMLAnchorElement) {
      clicked.push({
        href: this.getAttribute("href"),
        download: this.download,
      })
    })

    adminApi.exportAuditLogs({ action: "users.post" })
    adminApi.downloadLogs({ from: "2026-05-01" })
    adminApi.downloadBackup("synapse backup.tar.gz")

    expect(openMock).not.toHaveBeenCalled()
    expect(clicked).toEqual([
      { href: "/api/admin/audit-logs/export?action=users.post", download: "audit-logs.csv" },
      { href: "/api/admin/logs/download?from=2026-05-01", download: "logs.zip" },
      { href: "/api/admin/backup/download/synapse%20backup.tar.gz", download: "synapse backup.tar.gz" },
    ])
  })
})
