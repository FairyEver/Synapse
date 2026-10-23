import SMTPConnection from "nodemailer/lib/smtp-connection"
import { afterEach, expect, it, vi } from "vitest"
import { connectSmtp } from "../protocol/smtp"
import { aliyunConfig } from "../protocol/aliyun-policy"
import type { MailContext } from "../../shared/types"
afterEach(() => vi.restoreAllMocks())
for (const phase of ["connect", "login", "data", "verify"] as const) it(`closes the actual SMTP connection when cancelled during ${phase}`, async () => {
  let late: (() => void) | undefined
  const connect = vi.spyOn(SMTPConnection.prototype, "connect").mockImplementation(function (callback) {
    if (phase === "connect" || phase === "verify") late = () => callback?.(); else callback?.()
  })
  const login = vi.spyOn(SMTPConnection.prototype, "login").mockImplementation(function (_auth, callback) {
    if (phase === "login") late = () => callback(null); else callback(null)
  })
  const send = vi.spyOn(SMTPConnection.prototype, "send").mockImplementation(() => undefined)
  const close = vi.spyOn(SMTPConnection.prototype, "close")
  const controller = new AbortController(), ctx: MailContext = { ownerId: "owner", generation: 1, actor: "ui", signal: controller.signal }
  const smtp = await connectSmtp(ctx, aliyunConfig("me@example.com", "Work"), "fixture", vi.fn(async () => undefined))
  const pending = phase === "verify" ? smtp.verify(controller.signal) : smtp.submit({ raw: Buffer.from("Subject: test\r\n\r\nBody"), from: "me@example.com", to: ["to@example.com"], messageId: "<fixture@example.com>" }, controller.signal)
  const outcome = pending.catch(error => error)
  for (let i = 0; i < 5; i++) await new Promise<void>(resolve => setImmediate(resolve))
  expect(connect).toHaveBeenCalledTimes(1)
  controller.abort()
  expect(await outcome).toMatchObject({ code: "CANCELLED" })
  expect(close).toHaveBeenCalled()
  late?.()
  if (phase === "connect" || phase === "verify") expect(login).not.toHaveBeenCalled()
  if (phase !== "data") expect(send).not.toHaveBeenCalled()
  smtp.close()
})
it("authenticates and submits the frozen bytes through the owned connection", async () => {
  vi.spyOn(SMTPConnection.prototype, "connect").mockImplementation(callback => callback?.())
  const login = vi.spyOn(SMTPConnection.prototype, "login").mockImplementation((_auth, callback) => callback(null))
  const send = vi.spyOn(SMTPConnection.prototype, "send").mockImplementation((_envelope, _raw, callback) => callback(null, { accepted: ["to@example.com"], rejected: ["other@example.com"], response: "250 accepted" } as SMTPConnection.SentMessageInfo))
  const ctx: MailContext = { ownerId: "owner", generation: 1, actor: "ui", signal: new AbortController().signal }
  const smtp = await connectSmtp(ctx, aliyunConfig("me@example.com", "Work"), "fixture", vi.fn(async () => undefined))
  const snapshot = { raw: Buffer.from("Subject: frozen\r\n\r\nBody"), from: "me@example.com", to: ["to@example.com", "other@example.com"], messageId: "<frozen@example.com>" }
  expect(await smtp.submit(snapshot, ctx.signal)).toEqual({ accepted: ["to@example.com"], rejected: ["other@example.com"], messageId: snapshot.messageId })
  expect(login).toHaveBeenCalledWith({ user: "me@example.com", pass: "fixture" }, expect.any(Function))
  expect(send).toHaveBeenCalledWith({ from: snapshot.from, to: snapshot.to }, snapshot.raw, expect.any(Function))
  smtp.close()
})
