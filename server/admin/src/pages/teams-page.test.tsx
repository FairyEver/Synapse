import { afterEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { adminApi } from "@/lib/api"
import { render, waitFor } from "@/test/render"
import { TeamsPage } from "./teams-page"

vi.mock("@/lib/api", () => ({
  adminApi: {
    listPermissions: vi.fn(),
    listTeams: vi.fn(),
    listTeamEntitlements: vi.fn(),
    replaceTeamEntitlements: vi.fn(),
  },
}))

describe("TeamsPage", () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
    vi.clearAllMocks()
  })

  it("loads the next teams page", async () => {
    vi.mocked(adminApi.listTeams)
      .mockResolvedValueOnce({
        data: [
          {
            id: "team-1",
            name: "一组",
            createdByUser: { email: "owner@example.com" },
            memberships: [],
            createdAt: "2026-05-20T00:00:00.000Z",
          },
        ],
        total: 21,
        page: 1,
        pageSize: 20,
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "team-2",
            name: "二组",
            createdByUser: { email: "owner@example.com" },
            memberships: [],
            createdAt: "2026-05-21T00:00:00.000Z",
          },
        ],
        total: 21,
        page: 2,
        pageSize: 20,
      })

    const result = await render(<TeamsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("一组")
    })
    Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "下一页")
      ?.click()

    await waitFor(() => {
      expect(adminApi.listTeams).toHaveBeenLastCalledWith({ page: 2 })
      expect(result.container.textContent).toContain("二组")
    })
  })

  it("renders member emails and role labels", async () => {
    vi.mocked(adminApi.listTeams).mockResolvedValue({
      data: [
        {
          id: "team-1",
          name: "一组",
          createdByUser: { email: "owner@example.com" },
          memberships: [
            {
              role: "owner",
              user: { email: "owner@example.com" },
              createdAt: "2026-05-20T00:00:00.000Z",
            },
            {
              role: "member",
              user: { email: "member@example.com" },
              createdAt: "2026-05-21T00:00:00.000Z",
            },
          ],
          createdAt: "2026-05-20T00:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })

    const result = await render(<TeamsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("owner@example.com")
    })

    expect(result.container.textContent).toContain("member@example.com")
    expect(result.container.textContent).toContain("所有者")
    expect(result.container.textContent).toContain("成员")
  })

  it("loads and saves team permissions", async () => {
    vi.mocked(adminApi.listTeams).mockResolvedValue({
      data: [
        {
          id: "team-1",
          name: "一组",
          createdByUser: { email: "owner@example.com" },
          memberships: [],
          createdAt: "2026-05-20T00:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    vi.mocked(adminApi.listPermissions).mockResolvedValue([
      {
        key: "database.use",
        label: "数据",
        group: "database",
        level: "module",
        status: "active",
        clientVisibility: "visible",
      },
      {
        key: "workflow.use",
        label: "工作流",
        group: "automation",
        level: "module",
        status: "active",
        clientVisibility: "visible",
      },
    ])
    vi.mocked(adminApi.listTeamEntitlements).mockResolvedValue({ permissionKeys: ["database.use"] })
    vi.mocked(adminApi.replaceTeamEntitlements).mockResolvedValue({ permissionKeys: ["database.use", "workflow.use"] })

    const result = await render(<TeamsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("一组")
    })
    act(() => {
      Array.from(result.container.querySelectorAll("button"))
        .find((button) => button.textContent === "权限")
        ?.click()
    })

    await waitFor(() => {
      expect(adminApi.listPermissions).toHaveBeenCalledWith()
      expect(adminApi.listTeamEntitlements).toHaveBeenCalledWith("team-1")
      expect(document.body.textContent).toContain("工作流")
    })

    const workflow = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button[role='checkbox']"))
      .find((checkbox) => checkbox.getAttribute("aria-label") === "开通 工作流")
    act(() => {
      workflow?.click()
    })
    act(() => {
      Array.from(document.body.querySelectorAll("button"))
        .find((button) => button.textContent === "保存")
        ?.click()
    })

    await waitFor(() => {
      expect(adminApi.replaceTeamEntitlements).toHaveBeenCalledWith(
        "team-1",
        ["database.use", "workflow.use"],
      )
    })
  })
})
