import { describe, expect, it } from "vitest"
import { imapOptions } from "../protocol/imap"
import { smtpOptions } from "../protocol/smtp"
import { aliyunConfig, providerPolicy } from "../protocol/aliyun-policy"
import { normalizeProtocolError } from "../protocol/types"

describe("mail protocol safety", () => {
  it("uses verified TLS for Aliyun and requires STARTTLS for custom endpoints", () => {
    const config = aliyunConfig("me@example.com", "Work")
    expect(imapOptions(config, "secret")).toMatchObject({ host: "imap.qiye.aliyun.com", port: 993, secure: true, logger: false, tls: { rejectUnauthorized: true } })
    expect(smtpOptions(config, "secret")).toMatchObject({ host: "smtp.qiye.aliyun.com", port: 465, secure: true, logger: false, tls: { rejectUnauthorized: true } })
    const custom = { ...config, provider: "custom" as const, imap: { ...config.imap, security: "starttls" as const }, smtp: { ...config.smtp, security: "starttls" as const } }
    expect(imapOptions(custom, "secret").doSTARTTLS).toBe(true)
    expect(smtpOptions(custom, "secret").requireTLS).toBe(true)
    expect(providerPolicy(config).copyActsAsMove).toBe(true)
    expect(providerPolicy(custom).copyActsAsMove).toBe(false)
  })
  it("normalizes protocol failures without retaining secret-bearing messages", () => {
    const error = normalizeProtocolError(new Error("password=secret and server response"))
    expect(error.code).toBe("NETWORK_ERROR")
    expect(String(error)).not.toContain("secret")
  })
})
