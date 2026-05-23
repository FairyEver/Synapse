import type { ExecutionContext } from "@nestjs/common"
import { UnauthorizedException } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { UserAuthGuard } from "./user-auth.guard"

function createContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext
}

describe("UserAuthGuard", () => {
  it("records audit logs when a bearer token cannot be verified", async () => {
    const auth = { verifyAccessToken: vi.fn().mockRejectedValue(new UnauthorizedException("未登录或登录已过期。")) }
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const guard = new UserAuthGuard(auth as never, auditLog as never)

    await expect(guard.canActivate(createContext({
      method: "GET",
      path: "/api/auth/me",
      ip: "203.0.113.31",
      headers: { authorization: "Bearer invalid-token" },
    }))).rejects.toThrow(UnauthorizedException)

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "unknown",
      action: "user.auth.verify.failed",
      targetType: "auth",
      targetId: "unknown",
      detail: {
        method: "GET",
        path: "/api/auth/me",
        tokenPresent: true,
      },
      ipAddress: "203.0.113.31",
    })
  })
})
