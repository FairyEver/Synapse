import { vi } from "vitest"
import { Readable } from "node:stream"
import { MailDrafts } from "../drafts"
import { MailContent } from "../mime"
import { syncRig, remoteHeader } from "./sync-fixtures"
export async function draftRig() {
  const r = await syncRig()
  vi.mocked(r.session.searchUids).mockResolvedValue([1])
  vi.mocked(r.session.fetchHeaders).mockImplementation(async (_path, uids) => uids.map(uid => ({ ...remoteHeader(uid), from: [{ address: "author@example.com" }], replyTo: [{ address: "reply@example.com" }], to: [{ address: "me@example.com" }, { address: "other@example.com" }], cc: [{ address: "other@example.com" }, { address: "cc@example.com" }] })))
  await r.sync.runOnce(r.ctx, r.account.id)
  vi.mocked(r.session.fetchBodyStructure).mockResolvedValue({ type: "text/plain", part: "1" })
  vi.mocked(r.session.fetchPart).mockImplementation(async () => Readable.from(["Original text"]))
  const content = new MailContent(r.repo, r.accounts, r.assets, r.access)
  const drafts = new MailDrafts(r.repo, r.accounts, r.assets, content)
  const source = (await r.repo.page(r.ctx, "messages", { accountId: r.account.id })).items[0]
  return { ...r, content, drafts, source }
}
