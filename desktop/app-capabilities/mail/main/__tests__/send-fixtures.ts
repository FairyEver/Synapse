import { randomUUID } from "node:crypto"
import { createMailTestRig } from "./helpers"
import { aliyunConfig } from "../protocol/aliyun-policy"
import { MailDrafts } from "../drafts"
import { MailContent } from "../mime"
import { MailSend } from "../send"
import { MailSendOperations } from "../send-reconcile"
import type { StoredFolder } from "../sync"
export async function sendRig(clientSent = false) {
  const r = await createMailTestRig()
  const config = { ...aliyunConfig("me@example.com", "Work"), ...(clientSent ? { provider: "custom" as const, sentPolicy: "client" as const } : {}) }
  const account = await r.accounts.configure(r.ctx, { ...config, credential: "secret" })
  const folderId = `mf_${randomUUID()}`
  await r.repo.save<StoredFolder>(r.ctx, "folders", folderId, account.id, { folder: { id: folderId, accountId: account.id, path: "Sent", name: "Sent", role: "sent", uidValidity: "1", serverCount: 0, metadataComplete: true, selectable: true }, flags: [], delimiter: "/" }, 0)
  const content = new MailContent(r.repo, r.accounts, r.assets, r.access), drafts = new MailDrafts(r.repo, r.accounts, r.assets, content)
  const operations = new MailSendOperations(r.repo, r.accounts, r.assets, drafts), send = new MailSend(r.repo, r.accounts, r.assets, drafts, operations)
  const draft = await drafts.execute(r.ctx, "draft.create", { accountId: account.id, to: [{ address: "to@example.com" }], cc: [], bcc: [{ address: "hidden@example.com" }], subject: "Hello", html: "<p>Frozen content</p>", text: "Frozen content", assetIds: [], inlineImages: [] })
  return { ...r, account, folderId, drafts, draft, operations, send }
}
