import { describe, expect, it, vi } from "vitest"
import { recordAuthGuardFailure } from "./auth-guard-audit"

function forgeJwtPayload(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "invalid-signature",
  ].join(".")
}

describe("recordAuthGuardFailure", () => {
  it("does not trust unverified JWT claims for audit attribution", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const token = forgeJwtPayload({
      email: "victim@example.com",
      sub: "user-victim",
      type: "access",
    })

    await recordAuthGuardFailure({
      action: "teams.auth.verify.failed",
      auditLog: auditLog as never,
      request: {
        method: "GET",
        path: "/api/teams/me",
        ip: "203.0.113.44",
      },
      token,
    })

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "unknown",
      action: "teams.auth.verify.failed",
      targetType: "auth",
      targetId: "unknown",
      detail: {
        method: "GET",
        path: "/api/teams/me",
        tokenPresent: true,
      },
      ipAddress: "203.0.113.44",
    })
    expect(JSON.stringify(auditLog.record.mock.calls)).not.toContain("victim@example.com")
    expect(JSON.stringify(auditLog.record.mock.calls)).not.toContain("user-victim")
  })

  it("does not propagate audit write failures to auth guards", async () => {
    const auditError = new Error("audit database unavailable")
    const auditLog = { record: vi.fn().mockRejectedValue(auditError) }
    const logger = { warn: vi.fn() }

    await expect(recordAuthGuardFailure({
      action: "admin.auth.verify.failed",
      auditLog: auditLog as never,
      logger: logger as never,
      request: {
        method: "GET",
        path: "/api/admin/system",
        ip: "203.0.113.44",
      },
      token: "invalid-token",
    })).resolves.toBeUndefined()

    expect(logger.warn).toHaveBeenCalledWith({
      err: auditError,
      action: "admin.auth.verify.failed",
      method: "GET",
      path: "/api/admin/system",
      tokenPresent: true,
    }, "Failed to record auth guard audit log")
  })
})
