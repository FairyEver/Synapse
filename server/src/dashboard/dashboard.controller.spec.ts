import { describe, expect, it, vi } from "vitest"
import { PATH_METADATA } from "@nestjs/common/constants"
import { DashboardController } from "./dashboard.controller"

describe("DashboardController", () => {
  it("mounts console and legacy dashboard profile routes", () => {
    expect(Reflect.getMetadata(PATH_METADATA, DashboardController)).toEqual([
      "/api/console",
      "/api/dashboard",
    ])
  })

  it("returns the normal user dashboard profile", async () => {
    const auth = {
      getMe: vi.fn().mockResolvedValue({
        user: {
          id: "user-1",
          email: "user@example.com",
          status: "active",
          displayName: "Ada",
        },
        teams: [{ id: "team-1", name: "Team", membershipId: "membership-1", membershipRole: "owner" }],
      }),
    }
    const controller = new DashboardController(auth as never)

    await expect(controller.me({ user: { id: "user-1" } } as never)).resolves.toEqual({
      user: {
        id: "user-1",
        email: "user@example.com",
        status: "active",
        displayName: "Ada",
      },
      teams: [{ id: "team-1", name: "Team", membershipId: "membership-1", membershipRole: "owner" }],
    })
    expect(auth.getMe).toHaveBeenCalledWith("user-1")
  })

  it("updates the normal user dashboard profile", async () => {
    const auth = {
      updateMyProfile: vi.fn().mockResolvedValue({
        user: {
          id: "user-1",
          email: "user@example.com",
          status: "active",
          displayName: "Ada Lovelace",
        },
        teams: [],
      }),
    }
    const controller = new DashboardController(auth as never)

    await expect(controller.updateMe({
      displayName: "Ada Lovelace",
    }, {
      ip: "203.0.113.90",
      user: { id: "user-1" },
    } as never)).resolves.toEqual({
      user: {
        id: "user-1",
        email: "user@example.com",
        status: "active",
        displayName: "Ada Lovelace",
      },
      teams: [],
    })
    expect(auth.updateMyProfile).toHaveBeenCalledWith(
      "user-1",
      { displayName: "Ada Lovelace" },
      "203.0.113.90",
    )
  })

  it("passes handle updates to the profile service", async () => {
    const auth = {
      updateMyProfile: vi.fn().mockResolvedValue({
        user: { id: "user-1", email: "u@example.test", status: "active", displayName: "Liyang", handle: "liyang" },
        teams: [],
      }),
    }
    const controller = new DashboardController(auth as never)

    await controller.updateMe({ displayName: "Liyang", handle: "liyang" }, {
      ip: "127.0.0.1",
      user: { id: "user-1" },
    } as never)

    expect(auth.updateMyProfile).toHaveBeenCalledWith("user-1", { displayName: "Liyang", handle: "liyang" }, "127.0.0.1")
  })

  it("rejects invalid profile update bodies", async () => {
    const auth = { updateMyProfile: vi.fn() }
    const controller = new DashboardController(auth as never)

    await expect(controller.updateMe({
      displayName: "",
      extra: "no",
    }, {
      user: { id: "user-1" },
    } as never)).rejects.toThrow("Profile update request is invalid")
    expect(auth.updateMyProfile).not.toHaveBeenCalled()
  })
})
