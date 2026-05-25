import { describe, expect, it, vi } from "vitest"
import { DashboardController } from "./dashboard.controller"

describe("DashboardController", () => {
  it("returns the normal user dashboard profile", async () => {
    const auth = {
      getMe: vi.fn().mockResolvedValue({
        user: { id: "user-1", email: "user@example.com", status: "active" },
        teams: [{ id: "team-1", name: "Team", membershipId: "membership-1", membershipRole: "owner" }],
      }),
    }
    const controller = new DashboardController(auth as never)

    await expect(controller.me({ user: { id: "user-1" } } as never)).resolves.toEqual({
      user: { id: "user-1", email: "user@example.com", status: "active" },
      teams: [{ id: "team-1", name: "Team", membershipId: "membership-1", membershipRole: "owner" }],
    })
    expect(auth.getMe).toHaveBeenCalledWith("user-1")
  })
})
