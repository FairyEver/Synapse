import { afterEach, describe, expect, it, vi } from "vitest"
import { adminApi } from "@/lib/api"
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
