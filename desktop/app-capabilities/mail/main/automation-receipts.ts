import { createHash } from "node:crypto"
import { z } from "zod"
import type { MailSourceBoundary, MailReceiptRef } from "../../../electron/runtime/data-repo/schemas/automation-mail-triggers"
import { MailError, type MailContext } from "../shared/types"
import { MailRepository } from "./repository"
import { MailAccounts, type StoredAccount } from "./accounts"
import { MailSync, type StoredFolder, type StoredMessage } from "./sync"
import type { MailImapSession } from "./protocol/types"

const position = z.object({ after: z.number().int().nonnegative(), through: z.number().int().nonnegative() }).strict()
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
type Boundary = Extract<MailSourceBoundary, { kind: "mail" }>
export class MailAutomationReceipts {
  constructor(private readonly repo: MailRepository, private readonly accounts: MailAccounts, private readonly sync: MailSync) {}
  private async connected<T>(ctx: MailContext, accountId: string, fn: (session: MailImapSession, epoch: string) => Promise<T>): Promise<T> {
    return this.accounts.exclusive(ctx, accountId, async () => {
      if ((await this.accounts.get(ctx, accountId)).paused) throw new MailError("ACCOUNT_PAUSED", "邮箱已暂停，请先恢复同步")
      const { config, credential } = await this.accounts.credential(ctx, accountId)
      const epoch = digest([config.imap, config.username ?? config.email])
      const session = await this.accounts.protocols.imap(ctx, config, credential)
      try { const result = await fn(session, epoch); this.accounts.context.assertCurrent(ctx); return result } finally { await session.close() }
    })
  }
  async prepare(ctx: MailContext, accountId?: string): Promise<MailSourceBoundary[]> {
    const ids: string[] = []; let cursor: string | undefined
    if (accountId) ids.push(accountId)
    else do {
      const page = await this.repo.page<StoredAccount>(ctx, "accounts", { cursor, limit: 100 }); ids.push(...page.items.map(a => a.id)); cursor = page.nextCursor ?? undefined
    } while (cursor)
    if (!ids.length) throw new MailError("ACCOUNT_UNAVAILABLE", "请先配置邮箱账号")
    const boundaries: MailSourceBoundary[] = []
    for (const id of ids) {
      await this.sync.runOnce(ctx, id)
      const folders: StoredFolder["folder"][] = []; let folderCursor: string | undefined
      do { const page = await this.repo.page<StoredFolder>(ctx, "folders", { accountId: id, cursor: folderCursor, limit: 100 }); folders.push(...page.items.map(f => f.data.folder)); folderCursor = page.nextCursor ?? undefined } while (folderCursor)
      const inboxes = folders.filter(f => f.selectable && f.role === "inbox")
      if (inboxes.length !== 1) throw new MailError("ROLE_MAPPING_REQUIRED", "请先配置唯一的收件箱")
      const inbox = inboxes[0]!
      boundaries.push(await this.connected(ctx, id, async (session, endpointEpoch): Promise<Boundary> => {
        const selected = await session.select(inbox.path, ctx.signal)
        if (!Number.isSafeInteger(selected.uidNext) || selected.uidNext < 1) throw new MailError("SEARCH_INCOMPLETE", "无法确认收信起点")
        const sourceKey = digest([ctx.ownerId, id, endpointEpoch, inbox.id, selected.uidValidity])
        return { kind: "mail", sourceKey, accountId: id, folderId: inbox.id, endpointEpoch, uidValidity: selected.uidValidity, uidNext: selected.uidNext, confirmedAt: new Date().toISOString() }
      }))
    }
    return boundaries
  }
  async scan(ctx: MailContext, boundary: MailSourceBoundary, cursor: string, limit: number) {
    if (boundary.kind !== "mail" || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new MailError("INVALID_INPUT", "收信查询范围无效")
    const saved = cursor.startsWith("{") ? position.parse(JSON.parse(cursor)) : { after: Number(cursor), through: undefined }
    if (!Number.isSafeInteger(saved.after) || saved.after < boundary.uidNext - 1) throw new MailError("INVALID_INPUT", "收信游标无效")
    const folder = await this.repo.get<StoredFolder>(ctx, "folders", boundary.folderId)
    if (folder.accountId !== boundary.accountId || folder.data.folder.role !== "inbox") throw new MailError("STALE_TARGET", "收件箱映射已变化")
    const scan = await this.connected(ctx, boundary.accountId, async (session, epoch) => {
      const selected = await session.select(folder.data.folder.path, ctx.signal)
      if (epoch !== boundary.endpointEpoch || selected.uidValidity !== boundary.uidValidity) throw new MailError("STALE_TARGET", "邮箱身份或世代已变化，收信自动化已暂停此来源")
      const through = saved.through ?? selected.uidNext - 1
      if (through < saved.after) throw new MailError("STALE_TARGET", "邮箱收件序列已回退")
      const uids = through > saved.after ? await session.searchUids(folder.data.folder.path, { uid: `${saved.after + 1}:${through}` }, ctx.signal) : []
      if (uids.some(uid => !Number.isSafeInteger(uid) || uid <= saved.after || uid > through) || new Set(uids).size !== uids.length) throw new MailError("SEARCH_INCOMPLETE", "收信 UID 范围不完整")
      return { through, uids: uids.sort((a, b) => a - b) }
    })
    const batch = scan.uids.slice(0, limit), complete = scan.uids.length <= limit
    if (batch.length) await this.sync.runOnce(ctx, boundary.accountId, boundary.folderId, false, false, { min: batch[0]!, max: batch.at(-1)! })
    const end = batch.at(-1) ?? scan.through
    const rows = await this.repo.receiptPage(ctx, boundary.accountId, boundary.folderId, boundary.uidValidity, saved.after, end, limit)
    const allowed = new Set(batch)
    const receipts: MailReceiptRef[] = rows.filter(row => allowed.has(row.receiptUid!) && !(row.data as StoredMessage).summary.stale).map(row => {
      const message = row.data as StoredMessage
      return { sourceKey: boundary.sourceKey, receiptKey: message.originReceiptKey!, messageId: row.id, receivedAt: message.summary.receivedAt ?? null,
        locator: { ...message.summary.locator, endpointEpoch: boundary.endpointEpoch } }
    })
    this.accounts.context.assertCurrent(ctx)
    return { receipts, nextCursor: complete ? String(scan.through) : JSON.stringify({ after: end, through: scan.through }), complete }
  }
}
