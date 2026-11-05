import { describe, expect, it, vi } from "vitest"
import { ProfileAvatarController, PublicAvatarController } from "./profile-avatar.controller"

const throttleLimitMetadata = "THROTTLER:LIMITdefault"
const throttleTtlMetadata = "THROTTLER:TTLdefault"

describe("ProfileAvatarController", () => {
  it("retains the stricter upload limit", () => {
    expect(Reflect.getMetadata(throttleLimitMetadata, ProfileAvatarController.prototype.upload)).toBe(10)
    expect(Reflect.getMetadata(throttleTtlMetadata, ProfileAvatarController.prototype.upload)).toBe(60_000)
  })

  it("randomizes the current user avatar and returns the updated profile", async () => {
    const avatars = { randomize: vi.fn().mockResolvedValue(undefined) }
    const auth = { getMe: vi.fn().mockResolvedValue({ user: { id: "user-1", avatarUrl: "/api/avatars/system/next" } }) }
    const controller = new ProfileAvatarController(avatars as never, auth as never)

    await expect(controller.random({
      user: { id: "user-1" },
      ip: "203.0.113.8",
    } as never)).resolves.toMatchObject({ user: { avatarUrl: "/api/avatars/system/next" } })

    expect(avatars.randomize).toHaveBeenCalledWith("user-1", "203.0.113.8")
  })
})

describe("PublicAvatarController", () => {
  it("returns immutable cache and content headers for a head request", async () => {
    const avatars = {
      resolveSystemAvatar: vi.fn().mockResolvedValue({
        storageKey: "avatars/system/avatar.webp",
        mimeType: "image/webp",
        size: 4096n,
        etag: "etag-1",
      }),
    }
    const controller = new PublicAvatarController(avatars as never)
    const response = createResponse()
    const request = { method: "HEAD", headers: { "if-none-match": "etag-1" } }

    await controller.headSystemAvatar("avatar", request as never, response as never)

    expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "public, max-age=31536000, immutable")
    expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "image/webp")
    expect(response.setHeader).toHaveBeenCalledWith("Content-Length", "4096")
    expect(response.setHeader).toHaveBeenCalledWith("Cross-Origin-Resource-Policy", "cross-origin")
    expect(response.status).toHaveBeenCalledWith(304)
  })

  it("returns 404 without caching missing avatars", async () => {
    const avatars = { resolveCustomAvatar: vi.fn().mockResolvedValue(null) }
    const controller = new PublicAvatarController(avatars as never)
    const response = createResponse()

    await controller.headUserAvatar("missing", { method: "HEAD", headers: {} } as never, response as never)

    expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store")
    expect(response.status).toHaveBeenCalledWith(404)
    expect(response.send).toHaveBeenCalledWith("Not Found")
  })
})

function createResponse() {
  const response = {
    headersSent: false,
    destroyed: false,
    setHeader: vi.fn(),
    status: vi.fn(),
    end: vi.fn(),
    send: vi.fn(),
    destroy: vi.fn(),
  }
  response.status.mockReturnValue(response)
  return response
}
