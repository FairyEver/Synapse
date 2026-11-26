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
    await rig.accounts.pause(rig.ctx, rig.account.id)
    await expect(service.readAutomationReceipt({ identity: { ownerId: "test-owner", apiOrigin: "https://synapse.test" }, generation: 1, signal: new AbortController().signal },
      { sourceKey: "source", receiptKey: row.data.originReceiptKey as string, messageId: row.id, receivedAt: "2026-11-05T00:00:00Z", locator: { ...summary.locator, endpointEpoch: "epoch" } })).rejects.toMatchObject({ code: "ACCOUNT_PAUSED" })
  } finally { await service.dispose(); await rig.close() }
})

it("evaluates mail-received metadata pre-filters from indexed headers without fetching the body", async () => {
  const rig = await syncRig()
  const audit = new InMemoryAuditSink()
  const service = new MailService({ storage: rig.storage, files: new ManagedAssetStore(`${rig.root}/assets`),
    permissionGuard: { registerPolicy: () => () => undefined, check: async () => ({ allowed: true }) }, auditSink: audit,
    resolveOwner: () => "test-owner", events: () => undefined, open: async () => undefined,
    notifications: { show: () => undefined }, diagnostic: () => undefined, protocols: rig.protocols })
  try {
    vi.mocked(rig.session.searchUids).mockResolvedValue([1, 2])
    vi.mocked(rig.session.fetchHeaders).mockResolvedValue([
      {
        ...remoteHeader(1),
        subject: "财务系统部署申请",
        from: [{ address: "chenp@world-tech.com.cn", name: "陈鹏" }],
        references: [],
        receivedAt: "2026-11-26T02:00:00Z",
        structure: { type: "text/plain", part: "1" },
      },
      {
        ...remoteHeader(2),
        subject: "回复：财务系统部署申请",
        from: [{ address: "fanxw@world-tech.com.cn", name: "樊晓旺" }],
        references: ["<msg-1@world-tech.com.cn>"],
        receivedAt: "2026-11-26T02:01:00Z",
        structure: { type: "text/plain", part: "1" },
      },
    ])
    await rig.sync.runOnce(rig.ctx, rig.account.id)
    const items = (await rig.repo.page(rig.ctx, "messages", { accountId: rig.account.id })).items
    const original = items.find(item => (item.data.summary as { locator: { uid: number } }).locator.uid === 1)!
    const reply = items.find(item => (item.data.summary as { locator: { uid: number } }).locator.uid === 2)!
    const triggerCtx = { identity: { ownerId: "test-owner", apiOrigin: "https://synapse.test" }, generation: 1, signal: new AbortController().signal }
    const filterConfig = { senderMatches: ["@world-tech.com.cn"], subjectContains: ["部署"], originalOnly: true }
    const toReceipt = (row: typeof original) => {
      const summary = row.data.summary as { locator: { accountId: string; folderId: string; uidValidity: string; uid: number } }
      return { sourceKey: "source", receiptKey: row.data.originReceiptKey as string, messageId: row.id, receivedAt: "2026-11-26T02:00:00Z", locator: { ...summary.locator, endpointEpoch: "epoch" } }
    }

    expect(await service.matchesAutomationReceiptFilter(triggerCtx, toReceipt(original), filterConfig)).toBe(true)
    expect(await service.matchesAutomationReceiptFilter(triggerCtx, toReceipt(reply), filterConfig)).toBe(false)
    expect(await service.matchesAutomationReceiptFilter(triggerCtx, toReceipt(original), { senderMatches: ["@other.com"] })).toBe(false)
    expect(rig.session.fetchPart).not.toHaveBeenCalled()
  } finally { await service.dispose(); await rig.close() }
})
