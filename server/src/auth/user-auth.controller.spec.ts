import "reflect-metadata"
import { describe, expect, it, vi } from "vitest"
import { UserAuthController } from "./user-auth.controller"
import type { UserAuthService } from "./user-auth.service"

const throttleLimitMetadata = "THROTTLER:LIMITdefault"
const throttleTtlMetadata = "THROTTLER:TTLdefault"

describe("UserAuthController", () => {
  it("applies stricter throttling to register and login", () => {
    expect(Reflect.getMetadata(throttleLimitMetadata, UserAuthController.prototype.register)).toBe(5)
    expect(Reflect.getMetadata(throttleTtlMetadata, UserAuthController.prototype.register)).toBe(60000)
    expect(Reflect.getMetadata(throttleLimitMetadata, UserAuthController.prototype.login)).toBe(5)
    expect(Reflect.getMetadata(throttleTtlMetadata, UserAuthController.prototype.login)).toBe(60000)
  })

  it("passes valid login requests to the service", () => {
    const auth = {
      login: vi.fn().mockResolvedValue({ accessToken: "access", refreshToken: "refresh" }),
    }
    const controller = new UserAuthController(auth as unknown as UserAuthService)

    controller.login({ email: "user@example.com", password: "password" })

    expect(auth.login).toHaveBeenCalledWith({ email: "user@example.com", password: "password" })
  })
})
