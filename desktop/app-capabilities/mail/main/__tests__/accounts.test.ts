import { describe, expect, it, vi } from "vitest"
import { createMailTestRig } from "./helpers"
import { aliyunConfig } from "../protocol/aliyun-policy"

describe("local mail account lifecycle", () => {
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
