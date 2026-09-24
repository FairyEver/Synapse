import { describe, expect, it, vi } from "vitest"
import { PATH_METADATA } from "@nestjs/common/constants"
import { userNicknameMaxLength } from "@synapse/shared"
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
          handle: "ada",
          nickname: "Ada L.",
        },
      }),
    }
    const controller = new DashboardController(auth as never)

    await expect(controller.me({ user: { id: "user-1" } } as never)).resolves.toEqual({
      user: {
        id: "user-1",
        email: "user@example.com",
        status: "active",
        handle: "ada",
        nickname: "Ada L.",
      },
    })
    expect(auth.getMe).toHaveBeenCalledWith("user-1")
  })

  it("updates the normal user dashboard handle", async () => {
    const auth = {
      updateMyProfile: vi.fn().mockResolvedValue({
        user: {
          id: "user-1",
          email: "user@example.com",
          status: "active",
          handle: "ada-lovelace",
          nickname: "Ada L.",
        },
      }),
    }
    const controller = new DashboardController(auth as never)

    await expect(controller.updateMe({
      handle: "ada-lovelace",
    }, {
      ip: "203.0.113.90",
      user: { id: "user-1" },
    } as never)).resolves.toEqual({
      user: {
        id: "user-1",
        email: "user@example.com",
        status: "active",
        handle: "ada-lovelace",
        nickname: "Ada L.",
      },
    })
    expect(auth.updateMyProfile).toHaveBeenCalledWith(
      "user-1",
      { handle: "ada-lovelace" },
      "203.0.113.90",
    )
  })

  it("updates the normal user dashboard nickname", async () => {
    const auth = {
      updateMyProfile: vi.fn().mockResolvedValue({
        user: {
          id: "user-1",
          email: "user@example.com",
          status: "active",
          handle: "ada",
          nickname: "李 阳",
        },
      }),
    }
    const controller = new DashboardController(auth as never)

    await expect(controller.updateMe({
      nickname: "李 阳",
    }, {
      ip: "203.0.113.91",
      user: { id: "user-1" },
    } as never)).resolves.toEqual({
      user: {
        id: "user-1",
        email: "user@example.com",
        status: "active",
        handle: "ada",
        nickname: "李 阳",
      },
    })
    expect(auth.updateMyProfile).toHaveBeenCalledWith(
      "user-1",
      { nickname: "李 阳" },
      "203.0.113.91",
    )
  })

  it("accepts nicknames at the shared limit and rejects longer ones", async () => {
    const atLimit = "名".repeat(userNicknameMaxLength)
    const auth = {
      updateMyProfile: vi.fn().mockResolvedValue({
        user: {
          id: "user-1",
          email: "user@example.com",
          status: "active",
          handle: "ada",
          nickname: atLimit,
        },
      }),
    }
    const controller = new DashboardController(auth as never)

    await expect(controller.updateMe({
      nickname: atLimit,
    }, {
      ip: "203.0.113.92",
      user: { id: "user-1" },
    } as never)).resolves.toEqual({
      user: {
        id: "user-1",
        email: "user@example.com",
        status: "active",
        handle: "ada",
        nickname: atLimit,
      },
    })
    expect(auth.updateMyProfile).toHaveBeenCalledWith(
      "user-1",
      { nickname: atLimit },
      "203.0.113.92",
    )

    auth.updateMyProfile.mockClear()
    await expect(controller.updateMe({
      nickname: `${atLimit}名`,
    }, {
      user: { id: "user-1" },
    } as never)).rejects.toThrow("Profile update request is invalid")
    expect(auth.updateMyProfile).not.toHaveBeenCalled()
  })

  it("rejects profile update bodies without any known field", async () => {
    const auth = { updateMyProfile: vi.fn() }
    const controller = new DashboardController(auth as never)

    await expect(controller.updateMe({}, {
      user: { id: "user-1" },
    } as never)).rejects.toThrow("Profile update request is invalid")
    expect(auth.updateMyProfile).not.toHaveBeenCalled()
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
