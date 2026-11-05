import { afterEach, expect, it, vi } from "vitest"
import { syncRig, remoteHeader } from "./sync-fixtures"
import { MailAutomationReceipts } from "../automation-receipts"

const close: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of close.splice(0)) await dispose() })
async function fixture() {
  const rig = await syncRig(); close.push(rig.close)
  const receipts = new MailAutomationReceipts(rig.repo, rig.accounts, rig.sync)
  return { ...rig, receipts }
}
it("collects 151 post-boundary receipts across first-sync pages without notifying historical mail", async () => {
  const rig = await fixture()
  const [boundary] = await rig.receipts.prepare(rig.ctx, rig.account.id)
  expect(boundary?.kind).toBe("mail")
  vi.mocked(rig.session.select).mockResolvedValue({ uidValidity: "1", count: 402, uidNext: 403 })
  vi.mocked(rig.session.searchUids).mockImplementation(async (_path, query) => {
    const all = Array.from({ length: 402 }, (_, i) => i + 1)
    if (!query.uid) return all
    const [min, max] = String(query.uid).split(":").map(Number)
    return all.filter(uid => uid >= min! && uid <= max!)
  })
  vi.mocked(rig.session.fetchHeaders).mockImplementation(async (_path, uids) => uids.map(uid => ({ ...remoteHeader(uid), receivedAt: "2026-11-05T00:00:00.000Z" })))
  let cursor = "251", done = false
  const ids: string[] = []
  while (!done) {
    const page = await rig.receipts.scan(rig.ctx, boundary!, cursor, 50)
    ids.push(...page.receipts.map(r => r.receiptKey)); cursor = page.nextCursor; done = page.complete
  }
  expect(ids).toHaveLength(151)
  expect(new Set(ids).size).toBe(151)
  expect(rig.session.storeFlags).not.toHaveBeenCalled()
  if (boundary?.kind === "mail") {
    const coverage = await rig.sync.runOnce(rig.ctx, rig.account.id, boundary.folderId, false, false, { min: 403, max: 403 })
    expect(coverage.metadataComplete).toBe(false)
  }
})
it("requires every selected account to confirm a live connection and rejects UID generation changes", async () => {
  const rig = await fixture()
  const [boundary] = await rig.receipts.prepare(rig.ctx, rig.account.id)
  vi.mocked(rig.session.select).mockResolvedValue({ uidValidity: "2", count: 1, uidNext: 2 })
  await expect(rig.receipts.scan(rig.ctx, boundary!, "251", 50)).rejects.toMatchObject({ code: "STALE_TARGET" })
  await rig.accounts.pause(rig.ctx, rig.account.id)
  await expect(rig.receipts.prepare(rig.ctx)).rejects.toMatchObject({ code: "ACCOUNT_PAUSED" })
})
it("keeps the original receipt identity when a proven move changes its current locator", async () => {
  const rig = await fixture()
  await rig.sync.runOnce(rig.ctx, rig.account.id)
  const row = (await rig.repo.page(rig.ctx, "messages", { accountId: rig.account.id, limit: 1 })).items[0]!
  const original = row.data.originReceiptKey
  const summary = row.data.summary as { locator: { uid: number } }
  const moved = await rig.repo.save(rig.ctx, "messages", row.id, row.accountId, { ...row.data, summary: { ...summary, locator: { ...summary.locator, uid: 999 } } }, row.revision)
  expect(original).toEqual(expect.any(String))
  expect(moved.data.originReceiptKey).toBe(original)
})
