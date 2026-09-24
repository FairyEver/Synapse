import { describe, expect, it } from "vitest"
import { createApiKeySecret } from "../api-keys/api-key-token"
import { formatAuditError, redactSensitiveLogText } from "./audit-error"

describe("formatAuditError", () => {
  it("redacts a Synapse API key wherever it appears in a bare path", () => {
    // 用真实生成的密钥：密钥格式一旦变化，这条测试就会失败。
    const secret = createApiKeySecret()
    const output = formatAuditError(new Error(
      `GET /api/open/v1/notifications/${secret}/部署完成/生产环境已更新 failed`,
    ))

    expect(output).not.toContain(secret)
    // 后 43 位是随机部分，单独断言避免只打码掉前缀。
    expect(output).not.toContain(secret.slice("syn_sk_".length))
    expect(output).toContain("[REDACTED]")
  })

  it("redacts a key-shaped run longer than a real key instead of leaving its tail readable", () => {
    const output = redactSensitiveLogText(`key=${`syn_sk_${"A".repeat(80)}`}`)

    expect(output).not.toContain("A".repeat(40))
    expect(output).toContain("[REDACTED]")
  })

  it("still redacts a key inside a JSON field named key", () => {
    const output = redactSensitiveLogText(`{"key":"${createApiKeySecret()}","title":"部署完成"}`)

    expect(output).not.toContain("syn_sk_")
    expect(output).toContain('"title":"部署完成"')
  })

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

  it("redacts prefixed env-style sensitive keys", () => {
    const output = formatAuditError(new Error([
      "ANTHROPIC_API_KEY=env-api-secret",
      "SYNAPSE_SIDE_CHANNEL_TOKEN=env-token-secret",
      "{\"ANTHROPIC_API_KEY\":\"json-env-api-secret\"}",
    ].join(" ")))

    expect(output).toContain("ANTHROPIC_API_KEY=[REDACTED]")
    expect(output).toContain("SYNAPSE_SIDE_CHANNEL_TOKEN=[REDACTED]")
    expect(output).toContain('"ANTHROPIC_API_KEY":"[REDACTED]"')
    expect(output).not.toContain("env-api-secret")
    expect(output).not.toContain("env-token-secret")
    expect(output).not.toContain("json-env-api-secret")
  })
})

describe("redactSensitiveLogText", () => {
  it("redacts URLs, user paths, and sensitive values from log text", () => {
    const output = redactSensitiveLogText([
      "Authorization: Bearer authorization-secret",
      "https://example.com/invite?token=invite-secret",
      "/Users/alice/.claude/settings.json",
      "/home/bob/project/.env",
      "C:\\Users\\Bob\\AppData\\Roaming\\Synapse\\config.json",
      "{\"apiKey\":\"json-api-secret\"}",
    ].join(" "))

    expect(output).toContain("Authorization: [REDACTED]")
    expect(output).toContain("[URL]")
    expect(output).toContain("[PATH]")
    expect(output).toContain('"apiKey":"[REDACTED]"')
    expect(output).not.toContain("authorization-secret")
    expect(output).not.toContain("example.com")
    expect(output).not.toContain("invite-secret")
    expect(output).not.toContain("/Users/alice")
    expect(output).not.toContain("/home/bob")
    expect(output).not.toContain("C:\\Users\\Bob")
    expect(output).not.toContain("json-api-secret")
  })
})
