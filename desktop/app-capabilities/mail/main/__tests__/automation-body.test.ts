import { Readable } from "node:stream"
import { expect, it, vi } from "vitest"
import { ManagedAssetStore } from "../../../../electron/runtime/data-repo/assets"
import { InMemoryAuditSink } from "../../../../electron/runtime/security"
import { syncRig, remoteHeader } from "./sync-fixtures"
import { MailService } from "../service"

it("hydrates the complete external body without Seen, attachment, or remote image requests", async () => {
  const rig = await syncRig()
  const audit = new InMemoryAuditSink()
  const service = new MailService({ storage: rig.storage, files: new ManagedAssetStore(`${rig.root}/assets`),
    permissionGuard: { registerPolicy: () => () => undefined, check: async () => ({ allowed: true }) }, auditSink: audit,
    resolveOwner: () => "test-owner", events: () => undefined, open: async () => undefined,
    notifications: { show: () => undefined }, diagnostic: () => undefined, protocols: rig.protocols })
  try {
    vi.mocked(rig.session.searchUids).mockResolvedValue([1])
    vi.mocked(rig.session.fetchHeaders).mockResolvedValue([{ ...remoteHeader(1), receivedAt: "2026-11-05T00:00:00Z", structure: { type: "text/plain", part: "1" } }])
    await rig.sync.runOnce(rig.ctx, rig.account.id)
    vi.mocked(rig.session.fetchPart).mockImplementation(async () => Readable.from(["完整正文\n", "第二行"]))
    const row = (await rig.repo.page(rig.ctx, "messages", { accountId: rig.account.id })).items[0]!
    const summary = row.data.summary as { locator: { accountId: string; folderId: string; uidValidity: string; uid: number } }
    const payload = await service.readAutomationReceipt({ identity: { ownerId: "test-owner", apiOrigin: "https://synapse.test" }, generation: 1, signal: new AbortController().signal },
      { sourceKey: "source", receiptKey: row.data.originReceiptKey as string, messageId: row.id, receivedAt: "2026-11-05T00:00:00Z", locator: { ...summary.locator, endpointEpoch: "epoch" } })
    expect(payload.body).toBe("完整正文\n第二行")
    expect(payload.accountAddress).toBe("me@example.com")
    expect(rig.session.storeFlags).not.toHaveBeenCalled()
    expect(vi.mocked(rig.session.fetchPart).mock.calls.map(args => args[2])).toEqual(["1"])
    expect(((await rig.repo.get(rig.ctx, "messages", row.id)).data.summary as { read: boolean }).read).toBe(false)
  } finally { await service.dispose(); await rig.close() }
})
