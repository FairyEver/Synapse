import { describe, expect, it, vi } from "vitest"
import { createMailTestRig } from "./helpers"
import { aliyunConfig } from "../protocol/aliyun-policy"

describe("local mail account lifecycle", () => {
  it("lists only the logged-in owner's accounts and rejects old contexts and foreign IDs", async () => {
    const rig = await createMailTestRig()
    try {
      const first = await rig.accounts.configure(rig.ctx, { ...aliyunConfig("first@example.com", "First"), credential: "test-secret" })
      rig.setOwner("second-owner")
      const secondCtx = rig.context.current("mcp")
      const second = await rig.accounts.configure(secondCtx, { ...aliyunConfig("second@example.com", "Second"), credential: "test-secret" })
      const secondPage = await rig.accounts.execute(secondCtx, "account.list", { limit: 20 })
      expect(secondPage.items.map(account => account.email)).toEqual(["second@example.com"])
      expect(secondPage.nextCursor).toBeNull()
      await expect(rig.accounts.execute(secondCtx, "account.get", { accountId: first.id })).rejects.toMatchObject({ code: "UNAVAILABLE" })
      await expect(rig.accounts.execute(rig.ctx, "account.list", { limit: 20 })).rejects.toMatchObject({ name: "AbortError" })
      rig.setOwner("test-owner")
      const firstCtx = rig.context.current("mcp")
      expect((await rig.accounts.execute(firstCtx, "account.list", { limit: 20 })).items.map(account => account.email)).toEqual(["first@example.com"])
      await expect(rig.accounts.execute(firstCtx, "account.get", { accountId: second.id })).rejects.toMatchObject({ code: "UNAVAILABLE" })
      rig.setOwner(null)
      expect(() => rig.context.current("mcp")).toThrow("请先登录")
      await expect(rig.accounts.execute(firstCtx, "account.list", { limit: 20 })).rejects.toMatchObject({ name: "AbortError" })
    } finally { await rig.close() }
  })

  it("checks both protocols without sending and never returns a credential", async () => {
    const rig = await createMailTestRig()
    try {
      const account = await rig.accounts.configure(rig.ctx, { ...aliyunConfig("me@example.com", "Work"), credential: "test-only-secret" })
      expect(account.state).toBe("connected")
      expect(JSON.stringify(account)).not.toContain("test-only-secret")
      expect(JSON.stringify(rig.access.mock.calls)).not.toContain("test-only-secret")
      expect(rig.smtp.submit).not.toHaveBeenCalled()
      expect(rig.smtp.verify).toHaveBeenCalledTimes(1)
      vi.mocked(rig.protocols.imap).mockRejectedValueOnce({ authenticationFailed: true })
      const checks = await rig.accounts.inspect(rig.ctx, account.id)
      expect(checks.imap).toEqual({ ok: false, code: "AUTH_FAILED" })
      expect(checks.smtp.ok).toBe(true)
      await rig.accounts.pause(rig.ctx, account.id)
      expect(rig.lifecycle.stop).toHaveBeenCalledWith(rig.ctx, account.id)
    } finally { await rig.close() }
  })
  it("requires acknowledgement of drafts and unknown sends before local removal", async () => {
    const rig = await createMailTestRig()
    try {
      const account = await rig.accounts.configure(rig.ctx, { ...aliyunConfig("me@example.com", "Work"), credential: "secret" })
      await rig.repo.save(rig.ctx, "drafts", "draft", account.id, { state: "editing" }, 0)
      await rig.repo.save(rig.ctx, "operations", "operation", account.id, { kind: "send", state: "unknown", recipient: "private@example.com" }, 0)
      const input = { accountId: account.id, expectedRevision: account.revision, discardLocalDrafts: false, acknowledgeUnknownOperations: false }
      await expect(rig.accounts.remove(rig.ctx, input)).rejects.toThrow("草稿")
      await rig.accounts.remove(rig.ctx, { ...input, discardLocalDrafts: true, acknowledgeUnknownOperations: true })
      expect(await rig.repo.find(rig.ctx, "accounts", account.id)).toBeNull()
      expect((await rig.repo.get(rig.ctx, "operations", "operation")).data).toEqual({ kind: "removed-account", state: "unknown" })
      expect(rig.session.uidExpunge).not.toHaveBeenCalled()
      expect(rig.session.deleteFolder).not.toHaveBeenCalled()
    } finally { await rig.close() }
  })
  it("does not persist a late connection after the SY identity changes", async () => {
    const rig = await createMailTestRig()
    try {
      let finish!: () => void
      let started!: () => void
      const waiting = new Promise<void>(r => { finish = r })
      const connecting = new Promise<void>(r => { started = r })
      vi.mocked(rig.protocols.imap).mockImplementationOnce(async () => { started(); await waiting; return rig.session })
      const configuring = rig.accounts.configure(rig.ctx, { ...aliyunConfig("me@example.com", "Work"), credential: "test-only-secret" })
      await connecting
      rig.setOwner("other")
      finish()
      await expect(configuring).rejects.toThrow()
      expect((await rig.repo.page(rig.context.current("ui"), "accounts", {})).items).toEqual([])
      expect(rig.lifecycle.start).not.toHaveBeenCalled()
    } finally { await rig.close() }
  })
})
it("requires a fresh connection check before using changed endpoints", async () => {
  const r = await createMailTestRig()
  try {
    const account = await r.accounts.configure(r.ctx, { ...aliyunConfig("me@example.com", "Work"), credential: "secret" })
    await r.accounts.update(r.ctx, { accountId: account.id, expectedRevision: account.revision, patch: { imap: { host: "other.example.com", port: 993, security: "tls" } } })
    await expect(r.accounts.credential(r.ctx, account.id)).rejects.toMatchObject({ code: "CONNECTION_CHECK_REQUIRED" })
    await r.accounts.inspect(r.ctx, account.id)
    await expect(r.accounts.credential(r.ctx, account.id)).resolves.toMatchObject({ config: { imap: { host: "other.example.com" } } })
  } finally { await r.close() }
})
it("requests lifecycle cancellation before waiting for the busy account queue", async () => {
  const r = await createMailTestRig()
  let release!: () => void
  let paused: Promise<unknown> | undefined, busy: Promise<unknown> | undefined
  try {
    const account = await r.accounts.configure(r.ctx, { ...aliyunConfig("me@example.com", "Work"), credential: "secret" })
    r.lifecycle.stop.mockClear()
    let started!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    busy = r.accounts.exclusive(r.ctx, account.id, async () => { started(); await new Promise<void>(resolve => { release = resolve }) })
    await entered
    paused = r.accounts.pause(r.ctx, account.id)
    await vi.waitFor(() => expect(r.lifecycle.stop).toHaveBeenCalledTimes(1))
  } finally { release?.(); await busy; await paused; await r.close() }
})
