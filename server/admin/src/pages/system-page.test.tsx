import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { adminApi } from "@/lib/api"
import { render, waitFor } from "@/test/render"
import { SystemPage } from "./system-page"

vi.mock("@/lib/api", () => ({
  adminApi: {
    getSystemOverview: vi.fn(),
  },
}))

describe("SystemPage", () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
    vi.clearAllMocks()
  })

  it("renders RBAC permission system counts", async () => {
    vi.mocked(adminApi.getSystemOverview).mockResolvedValue({
      serverTime: "2026-05-23T00:00:00.000Z",
      counts: {
        auditLogs: 2,
        users: 3,
        teams: 1,
        invitations: 4,
        teamEntitlements: 14,
        teamAccessRoles: 2,
        teamAccessRolePermissions: 25,
        teamMemberAccessRoles: 3,
      },
    })

    const result = await render(<SystemPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("团队许可")
    })

    expect(result.container.textContent).toContain("14")
    expect(result.container.textContent).toContain("访问角色")
    expect(result.container.textContent).toContain("角色权限")
    expect(result.container.textContent).toContain("成员角色")
  })
})
