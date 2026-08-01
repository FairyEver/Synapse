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
      action: "user.auth.verify.failed",
      auditLog: auditLog as never,
      request: {
        method: "GET",
        path: "/api/auth/me",
        ip: "203.0.113.44",
      },
      token,
    })

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
      ipAddress: "203.0.113.44",
    })
    expect(JSON.stringify(auditLog.record.mock.calls)).not.toContain("victim@example.com")
    expect(JSON.stringify(auditLog.record.mock.calls)).not.toContain("user-victim")
  })

  it("does not propagate or log raw audit write failures to auth guards", async () => {
    const auditError = Object.assign(new Error([
      "audit database unavailable",
      "Authorization: Bearer raw-bearer",
      "token=raw-token",
      "postgresql://user:db-password@db.local:5432/synapse",
      "/Users/liyang/project/.env",
    ].join(" ")), { code: "ECONNRESET" })
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
      action: "admin.auth.verify.failed",
      error: "audit database unavailable Authorization: [REDACTED] token=[REDACTED] [URL] [PATH]",
      errorName: "Error",
      errorCode: "ECONNRESET",
      method: "GET",
      path: "/api/admin/system",
      tokenPresent: true,
    }, "Failed to record auth guard audit log")
    const serializedWarning = JSON.stringify(logger.warn.mock.calls)
    expect(serializedWarning).not.toContain("raw-bearer")
    expect(serializedWarning).not.toContain("raw-token")
    expect(serializedWarning).not.toContain("db-password")
    expect(serializedWarning).not.toContain("/Users/liyang/project/.env")
  })
})
