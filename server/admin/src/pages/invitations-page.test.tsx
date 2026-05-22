import { afterEach, describe, expect, it, vi } from "vitest"
import { adminApi } from "@/lib/api"
import { formatDate } from "@/lib/format"
import { render, waitFor } from "@/test/render"
import { InvitationsPage } from "./invitations-page"

vi.mock("@/lib/api", () => ({
  adminApi: {
    createSignupInvitation: vi.fn(),
    listInvitations: vi.fn(),
  },
}))

describe("InvitationsPage", () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
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
})
