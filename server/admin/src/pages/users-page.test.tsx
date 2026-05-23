import { afterEach, describe, expect, it, vi } from "vitest"
import { adminApi, type AdminUserRow } from "@/lib/api"
import { render, waitFor } from "@/test/render"
import { UsersPage } from "./users-page"

vi.mock("@/lib/api", () => ({
  adminApi: {
    createSignupInvitation: vi.fn(),
    listUsers: vi.fn(),
    updateUserStatus: vi.fn(),
  },
}))

describe("UsersPage", () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
    vi.clearAllMocks()
  })

  it("shows an action error when status update fails", async () => {
    vi.mocked(adminApi.listUsers).mockResolvedValue({
      data: [
        {
          id: "user-1",
          email: "user@example.com",
          status: "active",
          memberships: [],
          createdAt: "2026-05-20T00:00:00.000Z",
          updatedAt: "2026-05-22T00:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    vi.mocked(adminApi.updateUserStatus).mockRejectedValue(new Error("用户不存在。"))

    const result = await render(<UsersPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("user@example.com")
    })
    Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "停用")
      ?.click()

    await waitFor(() => {
      expect(adminApi.updateUserStatus).toHaveBeenCalledWith("user-1", "disabled")
      expect(result.container.textContent).toContain("用户不存在。")
    })
    expect(adminApi.listUsers).toHaveBeenCalledTimes(1)
  })

  it("shows every team membership for each user", async () => {
    vi.mocked(adminApi.listUsers).mockResolvedValue({
      data: [
        {
          id: "user-1",
          email: "member@example.com",
          status: "active",
          memberships: [
            {
              role: "owner",
              team: { id: "team-1", name: "研发组" },
            },
            {
              role: "member",
              team: { id: "team-2", name: "测试组" },
            },
          ],
          createdAt: "2026-05-20T00:00:00.000Z",
          updatedAt: "2026-05-22T00:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })

    const result = await render(<UsersPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("member@example.com")
      expect(result.container.textContent).toContain("研发组 / 所有者")
      expect(result.container.textContent).toContain("测试组 / 成员")
      expect(result.container.textContent).toContain("更新时间")
      expect(result.container.textContent).toContain("2026年5月22日")
    })
  })

  it("disables the status button while an update is submitting", async () => {
    const updatedUser: AdminUserRow = {
      id: "user-1",
      email: "user@example.com",
      status: "disabled",
      memberships: [],
      createdAt: "2026-05-20T00:00:00.000Z",
      updatedAt: "2026-05-22T00:00:00.000Z",
    }
    let resolveUpdate: (value: AdminUserRow | PromiseLike<AdminUserRow>) => void = () => undefined
    vi.mocked(adminApi.listUsers).mockResolvedValue({
      data: [
        {
          id: "user-1",
          email: "user@example.com",
          status: "active",
          memberships: [],
          createdAt: "2026-05-20T00:00:00.000Z",
          updatedAt: "2026-05-22T00:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    vi.mocked(adminApi.updateUserStatus).mockReturnValue(new Promise((resolve) => {
      resolveUpdate = resolve
    }))

    const result = await render(<UsersPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("user@example.com")
    })
    const button = Array.from(result.container.querySelectorAll("button"))
      .find((item) => item.textContent === "停用")
    button?.click()

    await waitFor(() => {
      expect(button?.disabled).toBe(true)
    })
    button?.click()
    expect(adminApi.updateUserStatus).toHaveBeenCalledTimes(1)

    resolveUpdate(updatedUser)
  })

  it("asks for confirmation before disabling a team owner", async () => {
    vi.mocked(adminApi.listUsers).mockResolvedValue({
      data: [
        {
          id: "user-1",
          email: "owner@example.com",
          status: "active",
          memberships: [
            {
              role: "owner",
              team: { id: "team-1", name: "研发组" },
            },
          ],
          createdAt: "2026-05-20T00:00:00.000Z",
          updatedAt: "2026-05-22T00:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    })
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)

    const result = await render(<UsersPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("owner@example.com")
    })
    Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "停用")
      ?.click()

    expect(confirm).toHaveBeenCalledWith("停用团队所有者会使该团队无法继续邀请或管理成员。继续停用？")
    expect(adminApi.updateUserStatus).not.toHaveBeenCalled()
  })

  it("loads the next users page", async () => {
    vi.mocked(adminApi.listUsers)
      .mockResolvedValueOnce({
        data: [
          {
            id: "user-1",
            email: "first@example.com",
            status: "active",
            memberships: [],
            createdAt: "2026-05-20T00:00:00.000Z",
            updatedAt: "2026-05-22T00:00:00.000Z",
          },
        ],
        total: 21,
        page: 1,
        pageSize: 20,
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "user-2",
            email: "second@example.com",
            status: "active",
            memberships: [],
            createdAt: "2026-05-21T00:00:00.000Z",
            updatedAt: "2026-05-22T00:00:00.000Z",
          },
        ],
        total: 21,
        page: 2,
        pageSize: 20,
      })

    const result = await render(<UsersPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("first@example.com")
    })
    Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "下一页")
      ?.click()

    await waitFor(() => {
      expect(adminApi.listUsers).toHaveBeenLastCalledWith({ page: 2 })
      expect(result.container.textContent).toContain("second@example.com")
    })
  })
})
