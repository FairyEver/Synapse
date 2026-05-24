import "reflect-metadata"
import { describe, expect, it, vi } from "vitest"
import { UserAuthController } from "./user-auth.controller"
import type { UserAuthService } from "./user-auth.service"

const throttleLimitMetadata = "THROTTLER:LIMITdefault"
const throttleTtlMetadata = "THROTTLER:TTLdefault"

describe("UserAuthController", () => {
  it("applies stricter throttling to register, login, and refresh", () => {
    expect(Reflect.getMetadata(throttleLimitMetadata, UserAuthController.prototype.register)).toBe(5)
    expect(Reflect.getMetadata(throttleTtlMetadata, UserAuthController.prototype.register)).toBe(60000)
    expect(Reflect.getMetadata(throttleLimitMetadata, UserAuthController.prototype.login)).toBe(5)
    expect(Reflect.getMetadata(throttleTtlMetadata, UserAuthController.prototype.login)).toBe(60000)
    expect(Reflect.getMetadata(throttleLimitMetadata, UserAuthController.prototype.refresh)).toBe(5)
    expect(Reflect.getMetadata(throttleTtlMetadata, UserAuthController.prototype.refresh)).toBe(60000)
  })

  it("passes valid login requests to the service", () => {
    const auth = {
      login: vi.fn().mockResolvedValue({ accessToken: "access", refreshToken: "refresh" }),
    }
    const controller = new UserAuthController(auth as unknown as UserAuthService)

    controller.login({ email: "user@example.com", password: "password" }, { ip: "203.0.113.20" } as never)

    expect(auth.login).toHaveBeenCalledWith({ email: "user@example.com", password: "password" }, "203.0.113.20")
  })

  it("passes valid register requests with the request ip to the service", () => {
    const auth = {
      register: vi.fn().mockResolvedValue({ accessToken: "access", refreshToken: "refresh" }),
    }
    const controller = new UserAuthController(auth as unknown as UserAuthService)

    controller.register({
      invitationToken: "invite-token",
      email: "user@example.com",
      password: "password",
    }, { ip: "203.0.113.21" } as never)

    expect(auth.register).toHaveBeenCalledWith({
      invitationToken: "invite-token",
      email: "user@example.com",
      password: "password",
    }, "203.0.113.21")
  })

  it("passes valid refresh requests with the request ip to the service", () => {
    const auth = {
      refresh: vi.fn().mockResolvedValue({ accessToken: "access", refreshToken: "refresh" }),
    }
    const controller = new UserAuthController(auth as unknown as UserAuthService)

    controller.refresh({ refreshToken: "refresh-token" }, { ip: "203.0.113.22" } as never)

    expect(auth.refresh).toHaveBeenCalledWith({ refreshToken: "refresh-token" }, "203.0.113.22")
  })
})
