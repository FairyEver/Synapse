import "reflect-metadata"
import { describe, expect, it, vi } from "vitest"
import { Logger } from "@nestjs/common"
import { PATH_METADATA } from "@nestjs/common/constants"
import { hashToken } from "../auth/token"
import { AdminAuthController } from "./admin-auth.controller"
import type { AdminRequest } from "./admin-auth.guard"

const throttleLimitMetadata = "THROTTLER:LIMITdefault"
const throttleTtlMetadata = "THROTTLER:TTLdefault"

describe("AdminAuthController", () => {
  it("mounts console and legacy dashboard auth routes", () => {
    expect(Reflect.getMetadata(PATH_METADATA, AdminAuthController)).toEqual([
      "/api/console",
      "/api/dashboard",
    ])
    expect(Reflect.getMetadata(PATH_METADATA, AdminAuthController.prototype.getSession)).toBe("/session")
  })

  it("applies stricter throttling to dashboard login and logout", () => {
    expect(Reflect.getMetadata(throttleLimitMetadata, AdminAuthController.prototype.login)).toBe(5)
    expect(Reflect.getMetadata(throttleTtlMetadata, AdminAuthController.prototype.login)).toBe(60000)
    expect(Reflect.getMetadata(throttleLimitMetadata, AdminAuthController.prototype.logout)).toBe(5)
    expect(Reflect.getMetadata(throttleTtlMetadata, AdminAuthController.prototype.logout)).toBe(60000)
  })

  it("sets dashboard session cookies with shared options", async () => {
    const auth = {
      login: vi.fn().mockResolvedValue({
        email: "user@example.com",
        handle: "ada",
        role: "user",
        token: "dashboard-token",
      }),
    }
    const controller = new AdminAuthController(auth as never)
    const response = { cookie: vi.fn() }
    const request = { ip: "203.0.113.11" } as unknown as AdminRequest

    await expect(controller.login({
      email: "user@example.com",
      password: "secret",
    }, request, response as never)).resolves.toEqual({
      email: "user@example.com",
      handle: "ada",
      role: "user",
      sessionId: hashToken("dashboard-token"),
    })

    expect(response.cookie).toHaveBeenCalledWith("synapse_admin", "dashboard-token", {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    })
  })

  it("rejects admin login bodies with unknown fields", async () => {
    const auth = {
      login: vi.fn(),
    }
    const controller = new AdminAuthController(auth as never)

    await expect(controller.login({
      email: "admin@example.com",
      password: "secret",
      extraField: "ignored",
    }, { ip: "203.0.113.11" } as unknown as AdminRequest, { cookie: vi.fn() } as never))
      .rejects
      .toThrow("登录请求无效：包含不支持的字段：extraField")
    expect(auth.login).not.toHaveBeenCalled()
  })

  it("rejects invalid admin login fields with field details", async () => {
    const auth = {
      login: vi.fn(),
    }
    const controller = new AdminAuthController(auth as never)

    await expect(controller.login({
      email: "not-an-email",
      password: "",
    }, { ip: "203.0.113.11" } as unknown as AdminRequest, { cookie: vi.fn() } as never))
      .rejects
      .toThrow("登录请求无效：email 格式无效；password 至少 1 个字符")
    expect(auth.login).not.toHaveBeenCalled()
  })

  it("records administrator logout in audit logs", async () => {
    const auth = {
      revokeDashboardSession: vi.fn().mockResolvedValue(undefined),
      verifyDashboardSession: vi.fn().mockResolvedValue({ id: "admin-1", email: "admin@example.com", role: "admin" }),
    }
    const auditLog = { record: vi.fn() }
    const controller = new AdminAuthController(auth as never, auditLog as never)
    const response = { clearCookie: vi.fn() }
    const request = {
      cookies: { synapse_admin: "admin-token" },
      ip: "203.0.113.12",
    } as unknown as AdminRequest

    await controller.logout(response as never, request)

    expect(response.clearCookie).toHaveBeenCalledWith("synapse_admin", {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    })
    expect(auth.verifyDashboardSession).toHaveBeenCalledWith("admin-token")
    expect(auth.revokeDashboardSession).toHaveBeenCalledWith("admin-token")
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.logout",
      targetType: "admin",
      targetId: "admin-1",
      ipAddress: "203.0.113.12",
    })
  })

  it("clears dashboard cookies when session revocation fails", async () => {
    const auth = {
      verifyDashboardSession: vi.fn().mockResolvedValue({ id: "admin-1", email: "admin@example.com", role: "admin" }),
      revokeDashboardSession: vi.fn().mockRejectedValue(new Error("database unavailable")),
    }
    const auditLog = { record: vi.fn() }
    const response = { cookie: vi.fn(), clearCookie: vi.fn() }
    const controller = new AdminAuthController(auth as never, auditLog as never)

    await expect(controller.logout(response as never, {
      ip: "203.0.113.10",
      cookies: { synapse_admin: "admin-token" },
    } as unknown as AdminRequest)).rejects.toThrow("database unavailable")

    expect(response.clearCookie).toHaveBeenCalledWith("synapse_admin", {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    })
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "admin.logout",
      targetType: "admin",
      targetId: "admin-1",
      ipAddress: "203.0.113.10",
    })
  })

  it("clears dashboard cookies and revokes sessions when logout audit fails", async () => {
    const warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined)
    const auth = {
      verifyDashboardSession: vi.fn().mockResolvedValue({ id: "admin-1", email: "admin@example.com", role: "admin" }),
      revokeDashboardSession: vi.fn().mockResolvedValue(undefined),
    }
    const auditLog = { record: vi.fn().mockRejectedValue(new Error("audit unavailable token=secret-value")) }
    const response = { clearCookie: vi.fn() }
    const controller = new AdminAuthController(auth as never, auditLog as never)

    try {
      await expect(controller.logout(response as never, {
        ip: "203.0.113.10",
        cookies: { synapse_admin: "admin-token" },
      } as unknown as AdminRequest)).resolves.toEqual({ ok: true })

      expect(auth.revokeDashboardSession).toHaveBeenCalledWith("admin-token")
      expect(response.clearCookie).toHaveBeenCalledWith("synapse_admin", {
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      })
      expect(warnSpy).toHaveBeenCalledWith({
        action: "admin.logout",
        targetType: "admin",
        targetId: "admin-1",
        error: "audit unavailable token=[REDACTED]",
      }, "Failed to record dashboard logout audit log")
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("secret-value")
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("records dashboard user logout in audit logs", async () => {
    const auth = {
      revokeDashboardSession: vi.fn().mockResolvedValue(undefined),
      verifyDashboardSession: vi.fn().mockResolvedValue({ id: "user-1", email: "user@example.com", role: "user" }),
    }
    const auditLog = { record: vi.fn() }
    const controller = new AdminAuthController(auth as never, auditLog as never)
    const response = { clearCookie: vi.fn() }
    const request = {
      cookies: { synapse_admin: "user-token" },
      ip: "203.0.113.12",
    } as unknown as AdminRequest

    await controller.logout(response as never, request)

    expect(auth.revokeDashboardSession).toHaveBeenCalledWith("user-token")
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "user@example.com",
      action: "user.dashboard_logout",
      targetType: "user",
      targetId: "user-1",
      ipAddress: "203.0.113.12",
    })
  })

  it("returns a stable dashboard session id for the current cookie", async () => {
    const auth = {
      verifyDashboardSession: vi.fn().mockResolvedValue({
        id: "user-1",
        email: "user@example.com",
        handle: "ada",
        role: "user",
      }),
    }
    const controller = new AdminAuthController(auth as never)

    await expect(controller.getSession({
      cookies: { synapse_admin: "dashboard-token" },
    } as unknown as AdminRequest)).resolves.toEqual({
      email: "user@example.com",
      handle: "ada",
      role: "user",
      sessionId: hashToken("dashboard-token"),
    })
  })
})
