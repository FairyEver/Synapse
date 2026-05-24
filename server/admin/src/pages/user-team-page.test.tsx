import { afterEach, describe, expect, it, vi } from "vitest"
import { userDashboardApi, type MyTeam } from "@/lib/api"
import { render, waitFor } from "@/test/render"
import { UserTeamPage } from "./user-team-page"

vi.mock("@/lib/api", () => ({
  userDashboardApi: {
    createInvitation: vi.fn(),
    createTeam: vi.fn(),
    getMyTeam: vi.fn(),
    leaveTeam: vi.fn(),
    removeMember: vi.fn(),
  },
}))

const team: MyTeam = {
  id: "membership-owner",
  teamId: "team-1",
  userId: "owner-1",
  role: "owner",
  team: {
    id: "team-1",
    name: "Core Team",
    createdByUserId: "owner-1",
    memberships: [
      {
        id: "membership-owner",
        userId: "owner-1",
        teamId: "team-1",
        role: "owner",
        createdAt: "2026-05-22T00:00:00.000Z",
        user: { id: "owner-1", email: "owner@example.com", status: "active" },
      },
      {
        id: "membership-member",
        userId: "user-2",
        teamId: "team-1",
        role: "member",
        createdAt: "2026-05-22T00:00:00.000Z",
        user: { id: "user-2", email: "member@example.com", status: "active" },
      },
    ],
  },
}

const singleOwnerTeam: MyTeam = {
  ...team,
  team: {
    ...team.team,
    memberships: [team.team.memberships[0]],
  },
}

describe("UserTeamPage", () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it("asks for dissolution confirmation when the owner is the only member", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true))
    vi.mocked(userDashboardApi.getMyTeam).mockResolvedValue(singleOwnerTeam)
    vi.mocked(userDashboardApi.leaveTeam).mockImplementation(() => new Promise(() => undefined))

    const result = await render(<UserTeamPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("Core Team")
    })
    const leaveButton = Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("退出团队"))

    leaveButton?.click()

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledWith("退出后团队将被解散。继续退出？")
      expect(leaveButton?.disabled).toBe(true)
      expect(userDashboardApi.leaveTeam).toHaveBeenCalledTimes(1)
    })
    leaveButton?.click()
    expect(userDashboardApi.leaveTeam).toHaveBeenCalledTimes(1)
  })

  it("does not show dissolution confirmation while other members remain", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true))
    vi.mocked(userDashboardApi.getMyTeam).mockResolvedValue(team)

    const result = await render(<UserTeamPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("Core Team")
    })
    Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("退出团队"))
      ?.click()

    expect(window.confirm).not.toHaveBeenCalled()
    expect(userDashboardApi.leaveTeam).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(result.container.textContent).toContain("请先移除其他成员。")
    })
  })

  it("disables member removal while the request is pending", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true))
    vi.mocked(userDashboardApi.getMyTeam).mockResolvedValue(team)
    vi.mocked(userDashboardApi.removeMember).mockImplementation(() => new Promise(() => undefined))

    const result = await render(<UserTeamPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("member@example.com")
    })
    const removeButton = Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("移除"))

    removeButton?.click()

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalledWith("确定移除 member@example.com？")
      expect(removeButton?.disabled).toBe(true)
      expect(userDashboardApi.removeMember).toHaveBeenCalledTimes(1)
    })
    removeButton?.click()
    expect(userDashboardApi.removeMember).toHaveBeenCalledTimes(1)
  })

  it("does not leave the team when confirmation is cancelled", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false))
    vi.mocked(userDashboardApi.getMyTeam).mockResolvedValue(singleOwnerTeam)

    const result = await render(<UserTeamPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("Core Team")
    })
    Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("退出团队"))
      ?.click()

    expect(userDashboardApi.leaveTeam).not.toHaveBeenCalled()
  })

  it("does not remove a member when confirmation is cancelled", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false))
    vi.mocked(userDashboardApi.getMyTeam).mockResolvedValue(team)

    const result = await render(<UserTeamPage />)
    cleanup = result.unmount

    await waitFor(() => {
      expect(result.container.textContent).toContain("member@example.com")
    })
    Array.from(result.container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("移除"))
      ?.click()

    expect(userDashboardApi.removeMember).not.toHaveBeenCalled()
  })
})
