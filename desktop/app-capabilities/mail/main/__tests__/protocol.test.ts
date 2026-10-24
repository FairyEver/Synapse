import { afterEach, describe, expect, it, vi } from "vitest"
import { ImapFlow } from "imapflow"
import { ImapSession, imapOptions } from "../protocol/imap"
import { smtpOptions } from "../protocol/smtp"
import { aliyunConfig, providerPolicy } from "../protocol/aliyun-policy"
import { normalizeProtocolError } from "../protocol/types"

afterEach(() => vi.useRealTimers())

it("preserves server receipt time separately from the sender date", async () => {
  const client = new ImapFlow(imapOptions(aliyunConfig("me@example.com", "Work"), "fixture"))
  vi.spyOn(client, "getMailboxLock").mockResolvedValue({ path: "INBOX", release: vi.fn() })
  vi.spyOn(client, "fetchAll").mockResolvedValue([{ uid: 1, seq: 1, envelope: { date: new Date("2026-10-20T00:00:00Z") }, internalDate: new Date("2026-10-24T03:00:00Z") }])
  const result = await new ImapSession(client).fetchHeaders("INBOX", [1], new AbortController().signal)
  expect(result[0]).toMatchObject({ date: "2026-10-20T00:00:00.000Z", receivedAt: "2026-10-24T03:00:00.000Z" })
})

function idleRig() {
  const client = new ImapFlow(imapOptions(aliyunConfig("me@example.com", "Work"), "fixture"))
  client.usable = true
  const controller = new AbortController(), release = vi.fn(), changed = vi.fn()
  let finish!: (value: boolean) => void
  const pending = new Promise<boolean>(resolve => { finish = resolve })
  vi.spyOn(client, "getMailboxLock").mockResolvedValue({ path: "INBOX", release })
  vi.spyOn(client, "idle").mockImplementation(() => pending)
  const close = vi.spyOn(client, "close").mockImplementation(() => { client.usable = false; finish(false); client.emit("close") })
  const session = new ImapSession(client)
  return { client, controller, release, changed, close, session, finish }
}

it("keeps a quiet IDLE listener alive beyond ordinary request deadlines and cancels it cleanly", async () => {
  vi.useFakeTimers()
  const r = idleRig()
  const result = r.session.idle("INBOX", r.controller.signal, r.changed).then(() => "completed", error => error.code)
  let settled = false
  void result.then(() => { settled = true })
  try {
    await vi.advanceTimersByTimeAsync(90_000)
    expect(settled).toBe(false)
    r.client.emit("exists", { path: "INBOX", count: 2, prevCount: 1 })
    expect(r.changed).toHaveBeenCalledTimes(1)
    expect(r.close).not.toHaveBeenCalled()
  } finally { r.controller.abort(); await result }
  expect(await result).toBe("CANCELLED")
  expect(r.release).toHaveBeenCalledTimes(1)
  for (const event of ["exists", "flags", "expunge"]) expect(r.client.listenerCount(event)).toBe(0)
})

it.each(["error", "close"] as const)("surfaces a real IDLE %s and releases its listeners and lock", async event => {
  const r = idleRig()
  const result = r.session.idle("INBOX", r.controller.signal, r.changed).catch(error => error.code)
  await vi.waitFor(() => expect(r.client.listenerCount("exists")).toBe(1))
  if (event === "error") r.client.emit("error", new Error("socket failed"))
  else r.client.close()
  expect(await result).toBe("NETWORK_ERROR")
  expect(r.release).toHaveBeenCalledTimes(1)
  for (const name of ["exists", "flags", "expunge"]) expect(r.client.listenerCount(name)).toBe(0)
})

it("releases IDLE resources on cancellation even if the SDK has not settled its wait", async () => {
  const r = idleRig()
  r.close.mockImplementation(() => { r.client.usable = false })
  const result = r.session.idle("INBOX", r.controller.signal).catch(error => error.code)
  try {
    await vi.waitFor(() => expect(r.client.listenerCount("exists")).toBe(1))
    r.controller.abort()
    expect(await result).toBe("CANCELLED")
    expect(r.release).toHaveBeenCalledTimes(1)
    for (const event of ["exists", "flags", "expunge"]) expect(r.client.listenerCount(event)).toBe(0)
  } finally { r.controller.abort(); r.finish(false); await result }
})

it("still times out when selecting the mailbox for IDLE gets stuck", async () => {
  vi.useFakeTimers()
  const r = idleRig()
  let unlock!: (lock: { path: string; release: () => void }) => void
  vi.mocked(r.client.getMailboxLock).mockImplementation(() => new Promise(resolve => { unlock = resolve }))
  const result = r.session.idle("INBOX", r.controller.signal).catch(error => error.code)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(await result).toBe("NETWORK_TIMEOUT")
  unlock({ path: "INBOX", release: r.release })
  await vi.advanceTimersByTimeAsync(0)
  expect(r.release).toHaveBeenCalledTimes(1)
})

it("releases a just-acquired IDLE mailbox lock when cancellation wins the same turn", async () => {
  const r = idleRig()
  let unlock!: (lock: { path: string; release: () => void }) => void
  vi.mocked(r.client.getMailboxLock).mockImplementation(() => new Promise(resolve => { unlock = resolve }))
  const result = r.session.idle("INBOX", r.controller.signal).catch(error => error.code)
  unlock({ path: "INBOX", release: r.release })
  r.controller.abort()
  expect(await result).toBe("CANCELLED")
  expect(r.release).toHaveBeenCalledTimes(1)
  for (const event of ["exists", "flags", "expunge"]) expect(r.client.listenerCount(event)).toBe(0)
})

it("keeps ordinary IMAP requests bounded by their deadline", async () => {
  vi.useFakeTimers()
  const r = idleRig()
  let finish!: () => void
  vi.spyOn(r.client, "search").mockImplementation(() => new Promise(resolve => { finish = () => resolve([]) }))
  const result = r.session.searchUids("INBOX", { all: true }, r.controller.signal).catch(error => error.code)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(await result).toBe("NETWORK_TIMEOUT")
  finish()
  await vi.advanceTimersByTimeAsync(0)
  expect(r.release).toHaveBeenCalledTimes(1)
})

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

it("preserves Sender separately from From and recipient display names", async () => {
  const client = new ImapFlow(imapOptions(aliyunConfig("me@example.com", "Work"), "fixture"))
  vi.spyOn(client, "getMailboxLock").mockResolvedValue({ path: "INBOX", release: vi.fn() })
  const from = [{ name: "作者", address: "author@example.com" }], sender = [{ name: "作者", address: "relay@wecom.work" }]
  const cc = [{ name: "设计中心 · 16", address: "opaque_party_rd_dm@wecom.work" }]
  vi.spyOn(client, "fetchAll").mockResolvedValue([{ uid: 1, seq: 1, envelope: { from, sender, cc } }, { uid: 2, seq: 2 }])
  const result = await new ImapSession(client).fetchHeaders("INBOX", [1, 2], new AbortController().signal)
  expect(result[0]).toMatchObject({ from, sender, cc })
  expect(result[1].sender).toEqual([])
})
