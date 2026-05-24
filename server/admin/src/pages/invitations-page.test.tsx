import { afterEach, describe, expect, it, vi } from "vitest"
import { adminApi } from "@/lib/api"
import { formatDate } from "@/lib/format"
import { render, waitFor } from "@/test/render"
import { InvitationsPage } from "./invitations-page"

vi.mock("@/lib/api", () => ({
  adminApi: {
    createSignupInvitation: vi.fn(),
    deleteInvitation: vi.fn(),
    deleteInvitations: vi.fn(),
    listInvitations: vi.fn(),
  },
}))

describe("InvitationsPage", () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it("shows invitation type, related team, creator, and used time", async () => {
    vi.mocked(adminApi.listInvitations).mockResolvedValue({
      data: [
        {
          id: "invite-1",
          type: "user_signup",
          expiresAt: "2026-06-10T00:00:00.000Z",
          usedAt: "2026-06-01T01:02:00.000Z",
          acceptedByUser: { email: "used@example.com" },
          createdByAdmin: { email: "admin@example.com" },
          createdByUser: null,
          team: null,
          createdAt: "2026-05-20T00:00:00.000Z",
        },
        {
          id: "invite-2",
          type: "team_join",
          expiresAt: "2026-06-11T00:00:00.000Z",
          usedAt: null,
          acceptedByUser: null,
          createdByAdmin: null,
          createdByUser: { email: "owner@example.com" },
          team: { name: "研发组" },
          createdAt: "2026-05-20T00:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    } as never)

    const result = await render(<InvitationsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("invite-1")
    })

    expect(result.container.textContent).toContain("admin@example.com")
    expect(result.container.textContent).toContain("used@example.com")
    expect(result.container.textContent).toContain(formatDate("2026-06-01T01:02:00.000Z"))
    expect(result.container.textContent).toContain("用户注册")
    expect(result.container.textContent).toContain("团队加入")
    expect(result.container.textContent).toContain("研发组")
    expect(result.container.textContent).toContain("owner@example.com")
  })

  it("loads the next invitations page", async () => {
    vi.mocked(adminApi.listInvitations)
      .mockResolvedValueOnce({
        data: [
          {
            id: "invite-1",
            type: "user_signup",
            expiresAt: "2026-06-10T00:00:00.000Z",
            usedAt: null,
            acceptedByUser: null,
            createdByAdmin: { email: "admin@example.com" },
            createdByUser: null,
            team: null,
            createdAt: "2026-05-20T00:00:00.000Z",
          },
        ],
        total: 21,
        page: 1,
        pageSize: 20,
      } as never)
      .mockResolvedValueOnce({
        data: [
          {
            id: "invite-2",
            type: "user_signup",
            expiresAt: "2026-06-11T00:00:00.000Z",
            usedAt: null,
            acceptedByUser: null,
            createdByAdmin: { email: "admin@example.com" },
            createdByUser: null,
            team: null,
            createdAt: "2026-05-21T00:00:00.000Z",
          },
        ],
        total: 21,
        page: 2,
        pageSize: 20,
      } as never)

    const result = await render(<InvitationsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("invite-1")
    })
    Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "下一页")
      ?.click()

    await waitFor(() => {
      expect(adminApi.listInvitations).toHaveBeenLastCalledWith({ page: 2 })
      expect(result.container.textContent).toContain("invite-2")
    })
  })

  it("deletes an invitation and reloads the list", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true))
    vi.mocked(adminApi.listInvitations)
      .mockResolvedValueOnce({
        data: [
          {
            id: "invite-1",
            type: "user_signup",
            expiresAt: "2026-06-10T00:00:00.000Z",
            usedAt: null,
            acceptedByUser: null,
            createdByAdmin: { email: "admin@example.com" },
            createdByUser: null,
            team: null,
            createdAt: "2026-05-20T00:00:00.000Z",
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      } as never)
      .mockResolvedValueOnce({
        data: [],
        total: 0,
        page: 1,
        pageSize: 20,
      } as never)
    vi.mocked(adminApi.deleteInvitation).mockResolvedValue({ ok: true })
    const result = await render(<InvitationsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("invite-1")
    })
    result.container.querySelector<HTMLButtonElement>("[aria-label='删除邀请 invite-1']")?.click()

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledWith("确定删除邀请 invite-1？")
      expect(adminApi.deleteInvitation).toHaveBeenCalledWith("invite-1")
      expect(result.container.textContent).toContain("暂无邀请")
    })
  })

  it("shows an action error when deleting an invitation fails", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true))
    vi.mocked(adminApi.listInvitations).mockResolvedValue({
      data: [
        {
          id: "invite-1",
          type: "user_signup",
          expiresAt: "2026-06-10T00:00:00.000Z",
          usedAt: null,
          acceptedByUser: null,
          createdByAdmin: { email: "admin@example.com" },
          createdByUser: null,
          team: null,
          createdAt: "2026-05-20T00:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    } as never)
    vi.mocked(adminApi.deleteInvitation).mockRejectedValue(new Error("邀请不存在。"))
    const result = await render(<InvitationsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("invite-1")
    })
    result.container.querySelector<HTMLButtonElement>("[aria-label='删除邀请 invite-1']")?.click()

    await waitFor(() => {
      expect(adminApi.deleteInvitation).toHaveBeenCalledWith("invite-1")
      expect(result.container.textContent).toContain("邀请不存在。")
    })
    expect(adminApi.listInvitations).toHaveBeenCalledTimes(1)
  })

  it("does not delete an invitation when confirmation is cancelled", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false))
    vi.mocked(adminApi.listInvitations).mockResolvedValue({
      data: [
        {
          id: "invite-1",
          type: "user_signup",
          expiresAt: "2026-06-10T00:00:00.000Z",
          usedAt: null,
          acceptedByUser: null,
          createdByAdmin: { email: "admin@example.com" },
          createdByUser: null,
          team: null,
          createdAt: "2026-05-20T00:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    } as never)
    const result = await render(<InvitationsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("invite-1")
    })
    result.container.querySelector<HTMLButtonElement>("[aria-label='删除邀请 invite-1']")?.click()

    expect(adminApi.deleteInvitation).not.toHaveBeenCalled()
  })

  it("copies an invitation link from the list", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    vi.mocked(adminApi.listInvitations).mockResolvedValue({
      data: [
        {
          id: "invite-1",
          type: "user_signup",
          inviteUrl: "https://app.example.com/dashboard/signup?invite=plain-token",
          expiresAt: "2026-06-10T00:00:00.000Z",
          usedAt: null,
          acceptedByUser: null,
          createdByAdmin: { email: "admin@example.com" },
          createdByUser: null,
          team: null,
          createdAt: "2026-05-20T00:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    } as never)
    const result = await render(<InvitationsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("invite-1")
    })
    result.container.querySelector<HTMLButtonElement>("[aria-label='复制邀请链接 invite-1']")?.click()

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://app.example.com/dashboard/signup?invite=plain-token")
    })
  })

  it("deletes selected invitations in bulk after confirmation", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true))
    vi.mocked(adminApi.listInvitations)
      .mockResolvedValueOnce({
        data: [
          {
            id: "invite-1",
            type: "user_signup",
            expiresAt: "2026-06-10T00:00:00.000Z",
            usedAt: null,
            acceptedByUser: null,
            createdByAdmin: { email: "admin@example.com" },
            createdByUser: null,
            team: null,
            createdAt: "2026-05-20T00:00:00.000Z",
          },
          {
            id: "invite-2",
            type: "team_join",
            expiresAt: "2026-06-11T00:00:00.000Z",
            usedAt: null,
            acceptedByUser: null,
            createdByAdmin: null,
            createdByUser: { email: "owner@example.com" },
            team: { name: "研发组" },
            createdAt: "2026-05-20T00:00:00.000Z",
          },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      } as never)
      .mockResolvedValueOnce({
        data: [],
        total: 0,
        page: 1,
        pageSize: 20,
      } as never)
    vi.mocked(adminApi.deleteInvitations).mockResolvedValue({ ok: true, count: 2 })
    const result = await render(<InvitationsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("invite-2")
    })
    result.container.querySelector<HTMLButtonElement>("[aria-label='选择全部邀请']")?.click()
    const deleteSelectedButton = Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "删除所选")
    await waitFor(() => {
      expect(deleteSelectedButton?.disabled).toBe(false)
    })
    deleteSelectedButton?.click()

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledWith("确定删除所选 2 个邀请？")
      expect(adminApi.deleteInvitations).toHaveBeenCalledWith(["invite-1", "invite-2"])
      expect(result.container.textContent).toContain("暂无邀请")
    })
  })

  it("deletes invitations selected across pages", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true))
    vi.mocked(adminApi.listInvitations)
      .mockResolvedValueOnce({
        data: [
          {
            id: "invite-1",
            type: "user_signup",
            expiresAt: "2026-06-10T00:00:00.000Z",
            usedAt: null,
            acceptedByUser: null,
            createdByAdmin: { email: "admin@example.com" },
            createdByUser: null,
            team: null,
            createdAt: "2026-05-20T00:00:00.000Z",
          },
        ],
        total: 21,
        page: 1,
        pageSize: 20,
      } as never)
      .mockResolvedValueOnce({
        data: [
          {
            id: "invite-21",
            type: "team_join",
            expiresAt: "2026-06-11T00:00:00.000Z",
            usedAt: null,
            acceptedByUser: null,
            createdByAdmin: null,
            createdByUser: { email: "owner@example.com" },
            team: { name: "研发组" },
            createdAt: "2026-05-21T00:00:00.000Z",
          },
        ],
        total: 21,
        page: 2,
        pageSize: 20,
      } as never)
      .mockResolvedValueOnce({
        data: [],
        total: 19,
        page: 2,
        pageSize: 20,
      } as never)
    vi.mocked(adminApi.deleteInvitations).mockResolvedValue({ ok: true, count: 2 })

    const result = await render(<InvitationsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("invite-1")
    })
    result.container.querySelector<HTMLButtonElement>("[aria-label='选择邀请 invite-1']")?.click()
    await waitFor(() => {
      expect(Array.from(result.container.querySelectorAll("button"))
        .find((button) => button.textContent === "删除所选")
        ?.disabled).toBe(false)
    })
    Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "下一页")
      ?.click()

    await waitFor(() => {
      expect(result.container.textContent).toContain("invite-21")
    })
    result.container.querySelector<HTMLButtonElement>("[aria-label='选择邀请 invite-21']")?.click()
    await waitFor(() => {
      expect(result.container.querySelector<HTMLButtonElement>("[aria-label='选择邀请 invite-21']")?.dataset.state)
        .toBe("checked")
    })
    Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "删除所选")
      ?.click()

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledWith("确定删除所选 2 个邀请？")
      expect(adminApi.deleteInvitations).toHaveBeenCalledWith(["invite-1", "invite-21"])
      expect(result.container.textContent).toContain("暂无邀请")
    })
  })

  it("shows an action error when bulk deletion fails", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true))
    vi.mocked(adminApi.listInvitations).mockResolvedValue({
      data: [
        {
          id: "invite-1",
          type: "user_signup",
          expiresAt: "2026-06-10T00:00:00.000Z",
          usedAt: null,
          acceptedByUser: null,
          createdByAdmin: { email: "admin@example.com" },
          createdByUser: null,
          team: null,
          createdAt: "2026-05-20T00:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    } as never)
    vi.mocked(adminApi.deleteInvitations).mockRejectedValue(new Error("删除失败"))
    const result = await render(<InvitationsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("invite-1")
    })
    result.container.querySelector<HTMLButtonElement>("[aria-label='选择全部邀请']")?.click()
    const deleteSelectedButton = Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "删除所选")
    await waitFor(() => {
      expect(deleteSelectedButton?.disabled).toBe(false)
    })
    deleteSelectedButton?.click()

    await waitFor(() => {
      expect(adminApi.deleteInvitations).toHaveBeenCalledWith(["invite-1"])
      expect(result.container.textContent).toContain("删除失败")
    })
    expect(adminApi.listInvitations).toHaveBeenCalledTimes(1)
  })

  it("does not delete selected invitations when confirmation is cancelled", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false))
    vi.mocked(adminApi.listInvitations).mockResolvedValue({
      data: [
        {
          id: "invite-1",
          type: "user_signup",
          expiresAt: "2026-06-10T00:00:00.000Z",
          usedAt: null,
          acceptedByUser: null,
          createdByAdmin: { email: "admin@example.com" },
          createdByUser: null,
          team: null,
          createdAt: "2026-05-20T00:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    } as never)
    const result = await render(<InvitationsPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("invite-1")
    })
    result.container.querySelector<HTMLButtonElement>("[aria-label='选择全部邀请']")?.click()
    const deleteSelectedButton = Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent === "删除所选")
    await waitFor(() => {
      expect(deleteSelectedButton?.disabled).toBe(false)
    })
    deleteSelectedButton?.click()

    expect(adminApi.deleteInvitations).not.toHaveBeenCalled()
  })
})
