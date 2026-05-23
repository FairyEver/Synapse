import type { ExecutionContext } from "@nestjs/common"
import { describe, expect, it, vi } from "vitest"
import { of, lastValueFrom } from "rxjs"
import { AuditLogInterceptor } from "./audit-log.interceptor"

function createContext(body: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method: "POST",
        path: "/api/admin/login",
        params: {},
        body,
        ip: "127.0.0.1",
      }),
    }),
  } as unknown as ExecutionContext
}

describe("AuditLogInterceptor", () => {
  it("redacts sensitive request body fields before recording audit details", async () => {
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const auth = { getEmail: vi.fn().mockResolvedValue("admin@example.com") }
    const interceptor = new AuditLogInterceptor(auditLog as never, auth as never)

    await lastValueFrom(interceptor.intercept(
      createContext({
        email: "admin@example.com",
        password: "plain-password",
        nested: { refreshToken: "refresh-token" },
      }),
      { handle: () => of({ id: "session-1" }) },
    ))

    await vi.waitFor(() => {
      expect(auditLog.record).toHaveBeenCalled()
    })
    const detail = auditLog.record.mock.calls[0]?.[0].detail
    expect(detail.body).toEqual({
      email: "admin@example.com",
      password: "[REDACTED]",
      nested: { refreshToken: "[REDACTED]" },
    })
    expect(JSON.stringify(detail)).not.toContain("plain-password")
    expect(JSON.stringify(detail)).not.toContain("refresh-token")
  })
})
