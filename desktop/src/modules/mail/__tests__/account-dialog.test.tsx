/** @vitest-environment jsdom */
import { mocks, mount, flush } from "./harness"
import { act } from "react"
import { expect, it, vi } from "vitest"
import { useMailAccounts } from "../use-mail-accounts"
let accounts: ReturnType<typeof useMailAccounts>
function Harness() { accounts = useMailAccounts("user", () => undefined); return null }
it("defaults Alibaba to verified TLS settings and clears submitted credentials", async () => {
  mocks.api.accountConfigure = vi.fn().mockResolvedValue({ id: "ma_one", revision: 1 })
  mount(<Harness />); await flush()
  act(() => { accounts.begin(); accounts.change({ email: "me@example.com", credential: "private-password" }) })
  await act(async () => { await accounts.connect() })
  expect(mocks.api.accountConfigure).toHaveBeenCalledWith(expect.objectContaining({ provider: "aliyun", email: "me@example.com", imap: expect.objectContaining({ port: 993, security: "tls" }), smtp: expect.objectContaining({ port: 465, security: "tls" }) }))
  expect(accounts.form.credential).toBe(""); expect(accounts.dialogOpen).toBe(false)
})
it("retains configurable custom endpoints and clears a rejected secret without closing", async () => {
  mocks.api.accountConfigure = vi.fn().mockRejectedValue(new Error("认证失败"))
  mount(<Harness />); await flush()
  act(() => { accounts.begin(); accounts.change({ provider: "custom", email: "me@example.com", credential: "bad", imap: { host: "imap.example.com", port: 143, security: "starttls" }, smtp: { host: "smtp.example.com", port: 587, security: "starttls" } }) })
  await act(async () => { await accounts.connect() })
  expect(accounts.dialogOpen).toBe(true); expect(accounts.error).toBe("认证失败"); expect(accounts.form.credential).toBe("")
  expect(mocks.api.accountConfigure.mock.calls[0][0].smtp.port).toBe(587)
})
it.each([
  [{ email: "invalid-address" }, "邮箱地址格式无效"],
  [{ imap: { host: "imap.example.com", port: 0, security: "tls" as const } }, "IMAP 端口须为 1–65535 的整数"],
] as const)("explains invalid account fields before connecting", async (patch, message) => {
  mocks.api.accountConfigure = vi.fn()
  mount(<Harness />); await flush()
  act(() => { accounts.begin(); accounts.change({ email: "me@example.com", credential: "test-secret", ...patch }) })
  await act(async () => { await accounts.connect() })
  expect(accounts.error).toBe(message)
  expect(mocks.api.accountConfigure).not.toHaveBeenCalled()
  expect(accounts.form.credential).toBe("")
  act(() => accounts.change({ email: "corrected@example.com" }))
  expect(accounts.error).toBeNull()
})
it("rejects invalid aliases before submitting account settings", async () => {
  mocks.api.accountUpdate = vi.fn().mockResolvedValue({})
  mount(<Harness />); await flush()
  const account = { id: "ma_one", revision: 2 } as import("../../../../app-capabilities/mail/shared/types").AccountSummary
  await act(async () => { await accounts.update(account, { aliases: ["invalid-alias"] }) })
  expect(accounts.error).toBe("其他邮箱地址格式无效，多个地址用逗号或分号分隔")
  expect(mocks.api.accountUpdate).not.toHaveBeenCalled()
})
it("keeps pause, resume and removal acknowledgements explicit", async () => {
  const account = { id: "ma_one", revision: 2, paused: false } as import("../../../../app-capabilities/mail/shared/types").AccountSummary
  mocks.api.accountPause = vi.fn().mockResolvedValue(account); mocks.api.accountResume = vi.fn().mockResolvedValue({ jobId: "mj_sync" }); mocks.api.accountDelete = vi.fn().mockRejectedValue(Object.assign(new Error("需要核对草稿"), { code: "REMOVAL_REVIEW_REQUIRED" }))
  mount(<Harness />); await flush()
  await act(async () => { await accounts.pause(account); await accounts.pause({ ...account, paused: true }) })
  expect(mocks.api.accountPause).toHaveBeenCalledTimes(1); expect(mocks.api.accountResume).toHaveBeenCalledTimes(1)
  await act(async () => { await accounts.remove(account, false, false) })
  expect(accounts.error).toBe("需要核对草稿")
  expect(mocks.api.accountDelete).toHaveBeenCalledWith({ accountId: "ma_one", expectedRevision: 2, discardLocalDrafts: false, acknowledgeUnknownOperations: false })
})
