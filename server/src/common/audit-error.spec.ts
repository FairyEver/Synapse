import { describe, expect, it } from "vitest"
import { formatAuditError } from "./audit-error"

describe("formatAuditError", () => {
  it("redacts token key variants in assignments and JSON fields", () => {
    const output = formatAuditError(new Error([
      "accessToken=access-secret",
      "refreshToken=refresh-secret",
      "sessionToken=session-secret",
      "authToken=auth-secret",
      "token=plain-secret",
      "apiKey=api-secret",
      "{\"refreshToken\":\"json-refresh-secret\",\"accessToken\":\"json-access-secret\"}",
      "Authorization: Bearer authorization-secret",
      "Bearer bearer-secret",
    ].join(" ")))

    expect(output).toContain("accessToken=[REDACTED]")
    expect(output).toContain("refreshToken=[REDACTED]")
    expect(output).toContain("sessionToken=[REDACTED]")
    expect(output).toContain("authToken=[REDACTED]")
    expect(output).toContain("token=[REDACTED]")
    expect(output).toContain("apiKey=[REDACTED]")
    expect(output).toContain('"refreshToken":"[REDACTED]"')
    expect(output).toContain('"accessToken":"[REDACTED]"')
    expect(output).toContain("Authorization: [REDACTED]")
    expect(output).toContain("Bearer [REDACTED]")
    expect(output).not.toContain("access-secret")
    expect(output).not.toContain("refresh-secret")
    expect(output).not.toContain("session-secret")
    expect(output).not.toContain("auth-secret")
    expect(output).not.toContain("plain-secret")
    expect(output).not.toContain("api-secret")
    expect(output).not.toContain("json-refresh-secret")
    expect(output).not.toContain("json-access-secret")
    expect(output).not.toContain("authorization-secret")
    expect(output).not.toContain("bearer-secret")
  })
})
