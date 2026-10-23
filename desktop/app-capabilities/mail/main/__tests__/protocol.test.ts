import { describe, expect, it, vi } from "vitest"
import { ImapFlow } from "imapflow"
import { ImapSession, imapOptions } from "../protocol/imap"
import { smtpOptions } from "../protocol/smtp"
import { aliyunConfig, providerPolicy } from "../protocol/aliyun-policy"
import { normalizeProtocolError } from "../protocol/types"

for (const exists of [true, false]) it(`checks whether the UID still exists when a part download is empty (${exists})`, async () => {
  const client = new ImapFlow(imapOptions(aliyunConfig("me@example.com", "Work"), "fixture"))
  const release = vi.fn()
  vi.spyOn(client, "getMailboxLock").mockResolvedValue({ path: "INBOX", release })
  vi.spyOn(client, "download").mockResolvedValue({})
  vi.spyOn(client, "fetchOne").mockResolvedValue(exists ? { uid: 42, seq: 1 } : false)
  const session = new ImapSession(client)
  await expect(session.fetchPart("INBOX", 42, "1", new AbortController().signal)).rejects.toMatchObject({ code: exists ? "BODY_UNAVAILABLE" : "STALE_TARGET" })
  expect(release).toHaveBeenCalledTimes(1)
})

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

it("retains only static pre-DATA rejection evidence without raw server transcripts", () => {
  const error = normalizeProtocolError({ code: "ECONNECTION", command: "CONN", message: "password=secret" })
  expect(error.details).toEqual({ definitelyNotSubmitted: true })
  expect(String(error)).not.toContain("secret")
})
