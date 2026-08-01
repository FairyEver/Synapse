import "reflect-metadata"
import { BadRequestException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { UserAuthController } from "./user-auth.controller"
import type { UserAuthService } from "./user-auth.service"

const throttleLimitMetadata = "THROTTLER:LIMITdefault"
const throttleTtlMetadata = "THROTTLER:TTLdefault"

describe("UserAuthController", () => {
  it("applies stricter throttling to public auth endpoints", () => {
    expect(Reflect.getMetadata(throttleLimitMetadata, UserAuthController.prototype.register)).toBe(5)
    expect(Reflect.getMetadata(throttleTtlMetadata, UserAuthController.prototype.register)).toBe(60000)
    expect(Reflect.getMetadata(throttleLimitMetadata, UserAuthController.prototype.login)).toBe(5)
    expect(Reflect.getMetadata(throttleTtlMetadata, UserAuthController.prototype.login)).toBe(60000)
    expect(Reflect.getMetadata(throttleLimitMetadata, UserAuthController.prototype.requestPasswordReset)).toBe(5)
    expect(Reflect.getMetadata(throttleTtlMetadata, UserAuthController.prototype.requestPasswordReset)).toBe(60000)
    expect(Reflect.getMetadata(throttleLimitMetadata, UserAuthController.prototype.resetPassword)).toBe(5)
    expect(Reflect.getMetadata(throttleTtlMetadata, UserAuthController.prototype.resetPassword)).toBe(60000)
    expect(Reflect.getMetadata(throttleLimitMetadata, UserAuthController.prototype.refresh)).toBe(5)
    expect(Reflect.getMetadata(throttleTtlMetadata, UserAuthController.prototype.refresh)).toBe(60000)
    expect(Reflect.getMetadata(throttleLimitMetadata, UserAuthController.prototype.logout)).toBe(5)
    expect(Reflect.getMetadata(throttleTtlMetadata, UserAuthController.prototype.logout)).toBe(60000)
    expect(Reflect.getMetadata(throttleLimitMetadata, UserAuthController.prototype.authorizeDesktop)).toBe(10)
    expect(Reflect.getMetadata(throttleTtlMetadata, UserAuthController.prototype.authorizeDesktop)).toBe(60000)
    expect(Reflect.getMetadata(throttleLimitMetadata, UserAuthController.prototype.issueDesktopToken)).toBe(10)
    expect(Reflect.getMetadata(throttleTtlMetadata, UserAuthController.prototype.issueDesktopToken)).toBe(60000)
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
      register: vi.fn().mockResolvedValue({ ok: true }),
    }
    const controller = new UserAuthController(auth as unknown as UserAuthService)

    controller.register({
      email: "user@example.com",
      handle: "liyang",
      password: "password",
    }, { ip: "203.0.113.21" } as never)

    expect(auth.register).toHaveBeenCalledWith({
      email: "user@example.com",
      handle: "liyang",
      password: "password",
    }, "203.0.113.21")
  })

  it("passes password reset requests with the configured public app URL", () => {
    const auth = {
      requestPasswordReset: vi.fn().mockResolvedValue({ ok: true }),
    }
    const controller = new UserAuthController(auth as unknown as UserAuthService)

    vi.stubEnv("APP_PUBLIC_URL", "https://app.example.com")
    try {
      controller.requestPasswordReset(
        { email: "user@example.com" },
        {
          ip: "203.0.113.30",
          protocol: "https",
          headers: { host: "evil.example.com" },
          get: (name: string) => (name === "host" ? "evil.example.com" : undefined),
        } as never,
      )
    } finally {
      vi.unstubAllEnvs()
    }

    expect(auth.requestPasswordReset).toHaveBeenCalledWith({
      email: "user@example.com",
      publicAppUrl: "https://app.example.com",
    }, "203.0.113.30")
  })

  it("rejects password reset URL generation when APP_PUBLIC_URL is missing", () => {
    const auth = {
      requestPasswordReset: vi.fn(),
    }
    const controller = new UserAuthController(auth as unknown as UserAuthService)

    vi.stubEnv("APP_PUBLIC_URL", "")
    try {
      expect(() => controller.requestPasswordReset(
        { email: "user@example.com" },
        {
          ip: "203.0.113.30",
          protocol: "https",
          headers: { host: "evil.example.com" },
          get: (name: string) => (name === "host" ? "evil.example.com" : undefined),
        } as never,
      )).toThrow("APP_PUBLIC_URL 未配置，无法生成公开链接。")
    } finally {
      vi.unstubAllEnvs()
    }

    expect(auth.requestPasswordReset).not.toHaveBeenCalled()
  })

  it("passes valid password reset confirmations with the request ip", () => {
    const auth = {
      resetPassword: vi.fn().mockResolvedValue({ ok: true }),
    }
    const controller = new UserAuthController(auth as unknown as UserAuthService)

    controller.resetPassword({
      token: "reset-token",
      password: "NewPassword123!",
    }, { ip: "203.0.113.31" } as never)

    expect(auth.resetPassword).toHaveBeenCalledWith({
      token: "reset-token",
      password: "NewPassword123!",
    }, "203.0.113.31")
  })

  it("rejects invalid password reset confirmations before calling the service", () => {
    const auth = {
      resetPassword: vi.fn(),
    }
    const controller = new UserAuthController(auth as unknown as UserAuthService)

    expect(() => controller.resetPassword({
      token: "",
      password: "short",
    }, { ip: "203.0.113.31" } as never))
      .toThrow(BadRequestException)
    expect(auth.resetPassword).not.toHaveBeenCalled()
  })

  it("rejects unknown register request fields", () => {
    const auth = {
      register: vi.fn(),
    }
    const controller = new UserAuthController(auth as unknown as UserAuthService)

    expect(() => controller.register({
      email: "user@example.com",
      handle: "liyang",
      password: "password",
      unexpected: true,
    }, { ip: "203.0.113.21" } as never))
      .toThrow(BadRequestException)
    expect(auth.register).not.toHaveBeenCalled()
  })

  it("returns field details for invalid register requests", () => {
    const auth = {
      register: vi.fn(),
    }
    const controller = new UserAuthController(auth as unknown as UserAuthService)

    expect(() => controller.register({
      email: "not-an-email",
      handle: "",
      password: "short",
    }, { ip: "203.0.113.21" } as never))
      .toThrow("注册请求无效：email 格式无效；handle 至少 1 个字符；password 至少 8 个字符")
    expect(auth.register).not.toHaveBeenCalled()
  })

  it("passes valid refresh requests with the request ip to the service", () => {
    const auth = {
      refresh: vi.fn().mockResolvedValue({ accessToken: "access", refreshToken: "refresh" }),
    }
    const controller = new UserAuthController(auth as unknown as UserAuthService)

    controller.refresh({ refreshToken: "refresh-token" }, { ip: "203.0.113.22" } as never)

    expect(auth.refresh).toHaveBeenCalledWith({ refreshToken: "refresh-token" }, "203.0.113.22")
  })

  it("passes valid logout requests with the request ip to the service", () => {
    const auth = {
      logout: vi.fn().mockResolvedValue({ ok: true }),
    }
    const controller = new UserAuthController(auth as unknown as UserAuthService)

    controller.logout({ refreshToken: "refresh-token" }, { ip: "203.0.113.23" } as never)

    expect(auth.logout).toHaveBeenCalledWith({ refreshToken: "refresh-token" }, "203.0.113.23")
  })

  it("passes valid desktop authorize requests to the service", () => {
    const auth = {
      authorizeDesktopLogin: vi.fn().mockResolvedValue({
        code: "desktop-code",
        deepLinkUrl: "synapse://auth/desktop/callback?code=desktop-code&state=state-1234567890",
        expiresAt: new Date("2999-01-01T00:00:00.000Z"),
      }),
    }
    const controller = new UserAuthController(auth as unknown as UserAuthService)

    controller.authorizeDesktop(
      {
        clientId: "synapse-desktop",
        redirectUri: "synapse://auth/desktop/callback",
        state: "state-1234567890",
        codeChallenge: "challenge-1234567890",
        codeChallengeMethod: "S256",
      },
      {
        ip: "203.0.113.24",
        headers: { "user-agent": "vitest" },
        user: { id: "user-1" },
      } as never,
    )

    expect(auth.authorizeDesktopLogin).toHaveBeenCalledWith({
      userId: "user-1",
      clientId: "synapse-desktop",
      redirectUri: "synapse://auth/desktop/callback",
      state: "state-1234567890",
      codeChallenge: "challenge-1234567890",
      codeChallengeMethod: "S256",
      ipAddress: "203.0.113.24",
      userAgent: "vitest",
    })
  })

  it("passes valid desktop token requests to the service", () => {
    const auth = {
      exchangeDesktopLoginToken: vi.fn().mockResolvedValue({ accessToken: "access", refreshToken: "refresh" }),
    }
    const controller = new UserAuthController(auth as unknown as UserAuthService)

    controller.issueDesktopToken(
      {
        code: "desktop-code",
        state: "state-1234567890",
        codeVerifier: "desktop-code-verifier-1234567890",
      },
      { ip: "203.0.113.25" } as never,
    )

    expect(auth.exchangeDesktopLoginToken).toHaveBeenCalledWith({
      code: "desktop-code",
      state: "state-1234567890",
      codeVerifier: "desktop-code-verifier-1234567890",
      ipAddress: "203.0.113.25",
    })
  })

  it("rejects invalid desktop authorize state before calling the service", () => {
    const auth = {
      authorizeDesktopLogin: vi.fn(),
    }
    const controller = new UserAuthController(auth as unknown as UserAuthService)

    expect(() => controller.authorizeDesktop(
      {
        clientId: "synapse-desktop",
        redirectUri: "synapse://auth/desktop/callback",
        state: "short",
        codeChallenge: "challenge-1234567890",
        codeChallengeMethod: "S256",
      },
      {
        ip: "203.0.113.24",
        headers: { "user-agent": "vitest" },
        user: { id: "user-1" },
      } as never,
    ))
      .toThrow(BadRequestException)
    expect(auth.authorizeDesktopLogin).not.toHaveBeenCalled()
  })
})
