import { createHash, randomUUID } from "node:crypto"
import type { MailRecord } from "../../../electron/runtime/data-repo/schemas/mail"
import { MAIL_FOLDER_REFRESH_MS, MAIL_HISTORY_BATCH_SIZE, MAIL_HISTORY_CONCURRENCY, MAIL_PAGE_SIZE, MAIL_POLL_INTERVAL_MS } from "../shared/limits"
import { MailError, type Coverage, type Folder, type InboxDelta, type MailContext, type MailDetail, type MailInputs, type MailJob, type MailSummary } from "../shared/types"
import { summarySchema, addressSchema } from "../shared/schema"
import { MailRepository } from "./repository"
import { MailAccounts, type StoredAccount } from "./accounts"
import { normalizeProtocolError, type MailBodyStructure, type MailImapSession, type RemoteHeader } from "./protocol/types"

export interface StoredFolder extends Record<string, unknown> { folder: Folder; delimiter: string; flags: string[] }
export interface StoredMessage extends Record<string, unknown> {
  summary: Omit<MailSummary, "revision">; headers: MailDetail["headers"]; structure: MailBodyStructure | null; bodyRef: string | null; searchTextRef?: string; originalFolderId?: string
}
interface FolderCheckpoint extends Record<string, unknown> {
  kind: "folder"; folderId: string; uidValidity: string; baselineUid: number; metadataComplete: boolean; updatedAt: number;
  firstPageDone?: boolean; flagsOffset?: number; flagsCheckedAt?: number; uidDigest?: string; indexedCount?: number; headersIndexedCount?: number; totalCount?: number
}
interface StoredJob extends Record<string, unknown> { kind: "job"; job: MailJob }
export interface MailChanged { ownerId: string; generation: number; accountId: string; ids: string[]; revision: number }
export interface SyncEvents {
  changed(event: MailChanged): void
  inbox(ctx: MailContext, delta: InboxDelta): void | Promise<void>
  error(code: string, accountId: string): void
  draft?(ctx: MailContext, messageId: string): Promise<void>
}
export const emptyCoverage = (): Coverage => ({ metadataComplete: false, serverHistoryComplete: null, indexedCount: 0, bodyScannedCount: 0, bodyPendingCount: null, reason: "metadata_indexing" })
export const messageSummary = (row: MailRecord<StoredMessage>): MailSummary => ({ ...row.data.summary, receivedAt: row.data.summary.receivedAt ?? null, revision: row.revision })
const messageSortKey = (receivedAt: string | null, date: string | null, uid: number) =>
  String(9_999_999_999_999 - (receivedAt ? Date.parse(receivedAt) : date ? Date.parse(date) : uid)).padStart(13, "0")
export async function resolveMessage(repo: MailRepository, ctx: MailContext, messageId: string): Promise<MailRecord<StoredMessage>> {
  const row = await repo.get<StoredMessage>(ctx, "messages", messageId)
  const folder = await repo.find<StoredFolder>(ctx, "folders", row.data.summary.locator.folderId)
  if (row.data.summary.stale || !folder || folder.data.folder.uidValidity !== row.data.summary.locator.uidValidity) throw new MailError("STALE_TARGET", "邮件位置已失效，请重新同步")
  return row
}
/** A newly observed generation invalidates cached locators immediately, even when the caller fails. */
export async function assertRemoteGeneration(repo: MailRepository, ctx: MailContext, folderId: string, expected: string, actual: string): Promise<void> {
  if (actual === expected) return
  await invalidateFolderGeneration(repo, ctx, folderId, actual)
  throw new MailError("STALE_TARGET", "邮件位置已失效，请重新同步")
}
async function invalidateFolderGeneration(repo: MailRepository, ctx: MailContext, folderId: string, actual: string | null): Promise<void> {
  const row = await repo.get<StoredFolder>(ctx, "folders", folderId)
  await repo.save(ctx, "folders", row.id, row.accountId, { ...row.data, folder: { ...row.data.folder, uidValidity: actual, metadataComplete: false } }, row.revision, row.sortKey)
  let cursor: string | undefined
  do {
    const page = await repo.page<StoredMessage>(ctx, "messages", { accountId: row.accountId, cursor, limit: 100 })
    for (const message of page.items) if (message.data.summary.locator.folderId === folderId && message.data.summary.locator.uidValidity !== actual && !message.data.summary.stale) await repo.save(ctx, "messages", message.id, row.accountId, { ...message.data, summary: { ...message.data.summary, stale: true } }, message.revision, message.sortKey)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
}
const role = (path: string, special: string | null): Folder["role"] => path.toUpperCase() === "INBOX" ? "inbox" : ({ "\\Sent": "sent", "\\Drafts": "drafts", "\\Trash": "trash", "\\Junk": "junk" } as const)[special as "\\Sent"] ?? "none"
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve() }
    const timer = setTimeout(done, ms); signal.addEventListener("abort", done, { once: true })
  })
}
class WorkSlots {
  private active = 0
  private queue: (() => void)[] = []
  async run<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
    if (this.active >= MAIL_HISTORY_CONCURRENCY) await new Promise<void>(resolve => this.queue.push(resolve))
    else this.active++
    try { signal.throwIfAborted(); return await task() } finally {
      const next = this.queue.shift()
      if (next) next(); else this.active--
    }
  }
}
interface Runner { ctx: MailContext; accountId: string; controller: AbortController; task: Promise<void>; idle?: MailImapSession; idleTask?: Promise<void>; hint: boolean; jobId: string; folderId?: string; lastFolders: number; historyPaused?: boolean; foreground: boolean; requestVersion: number }

export class MailSync {
  private runners = new Map<string, Runner>()
  private folderQueues = new Map<string, string[]>()
  private slots = new WorkSlots()
  private suspended = false
  constructor(private readonly repo: MailRepository, private readonly accounts: MailAccounts, private readonly events: SyncEvents) {}
  private emit(ctx: MailContext, accountId: string, ids: string[], revision = 1): void {
    this.accounts.context.assertCurrent(ctx)
    if (ids.length) this.events.changed({ ownerId: ctx.ownerId, generation: ctx.generation, accountId, ids, revision })
  }
  private async folders(ctx: MailContext, accountId: string, session: MailImapSession, refresh: boolean): Promise<MailRecord<StoredFolder>[]> {
    const rows: MailRecord<StoredFolder>[] = []
    let cursor: string | undefined
    do { const page = await this.repo.page<StoredFolder>(ctx, "folders", { accountId, cursor, limit: 100 }); rows.push(...page.items); cursor = page.nextCursor ?? undefined } while (cursor)
    if (!refresh) return rows
    const remote = await session.listFolders(ctx.signal)
    const paths = new Set(remote.map(f => f.path))
    for (const entry of remote) {
      const old = rows.find(f => f.data.folder.path === entry.path)
      const id = old?.id ?? `mf_${randomUUID()}`
      const folder: Folder = { id, accountId, path: entry.path, name: entry.name, role: old?.data.folder.role ?? role(entry.path, entry.specialUse), uidValidity: old?.data.folder.uidValidity ?? null, serverCount: entry.count, metadataComplete: old?.data.folder.metadataComplete ?? false, selectable: !entry.flags.includes("\\Noselect") }
      const saved = await this.repo.save(ctx, "folders", id, accountId, { folder, delimiter: entry.delimiter, flags: entry.flags }, old?.revision ?? 0, entry.path)
      const index = rows.findIndex(f => f.id === id); if (index < 0) rows.push(saved); else rows[index] = saved
    }
    // Keep removed folders as invalid locators; do not redirect references by matching names.
    for (const old of rows.filter(f => !paths.has(f.data.folder.path))) {
      await this.repo.save(ctx, "folders", old.id, accountId, { ...old.data, folder: { ...old.data.folder, selectable: false, uidValidity: null } }, old.revision, old.sortKey)
      await invalidateFolderGeneration(this.repo, ctx, old.id, null)
      this.emit(ctx, accountId, [old.id])
    }
    return rows.filter(f => paths.has(f.data.folder.path))
  }
  private async syncFolder(ctx: MailContext, accountId: string, initialFolder: MailRecord<StoredFolder>, session: MailImapSession, newMailOnly = false): Promise<Coverage> {
    let folder = initialFolder
    const selected = await session.select(folder.data.folder.path, ctx.signal)
    const uids = await session.searchUids(folder.data.folder.path, { all: true }, ctx.signal)
    if (uids.some(uid => !Number.isSafeInteger(uid) || uid < 1) || new Set(uids).size !== uids.length) throw new MailError("SEARCH_INCOMPLETE", "邮件 UID 校对不完整")
    uids.sort((a, b) => b - a)
    const uidDigest = createHash("sha256").update(uids.join(",")).digest("hex")
    const checkpointId = `folder:${folder.id}`
    let checkpoint = await this.repo.find<FolderCheckpoint>(ctx, "sync-state", checkpointId)
    const validityChanged = checkpoint?.data.uidValidity !== selected.uidValidity
    if (!checkpoint || validityChanged) {
      checkpoint = await this.repo.save(ctx, "sync-state", checkpointId, accountId, { kind: "folder", folderId: folder.id, uidValidity: selected.uidValidity, baselineUid: uids[0] ?? 0, metadataComplete: false, updatedAt: Date.now() }, checkpoint?.revision ?? 0)
    }
    const flagsDue = checkpoint.data.uidDigest !== uidDigest || checkpoint.data.metadataComplete && Date.now() - (checkpoint.data.flagsCheckedAt ?? 0) >= (folder.data.folder.role === "inbox" ? MAIL_POLL_INTERVAL_MS : MAIL_FOLDER_REFRESH_MS)
    let flagsOffset = flagsDue ? 0 : checkpoint.data.flagsOffset ?? 0
    folder = await this.repo.save(ctx, "folders", folder.id, accountId, { ...folder.data, folder: { ...folder.data.folder, uidValidity: selected.uidValidity, serverCount: uids.length, metadataComplete: false } }, folder.revision, folder.sortKey)
    const existing = new Map<number, { id: string; stale: boolean; needsMetadata: boolean }>()
    let cursor: string | undefined
    do {
      const page = await this.repo.page<StoredMessage>(ctx, "messages", { accountId, cursor, limit: 100 })
      for (const row of page.items) {
        const locator = row.data.summary.locator
        if (locator.folderId !== folder.id) continue
        if (locator.uidValidity !== selected.uidValidity) {
          if (!row.data.summary.stale) await this.repo.save(ctx, "messages", row.id, accountId, { ...row.data, summary: { ...row.data.summary, stale: true } }, row.revision, row.sortKey)
        } else if (!row.data.summary.stale) existing.set(locator.uid, { id: row.id, stale: false, needsMetadata: row.data.summary.receivedAt === undefined || row.data.headers.sender === undefined })
      }
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    const allMissing = uids.filter(uid => !existing.has(uid) || existing.get(uid)?.needsMetadata)
    const baselineUid = checkpoint.data.baselineUid
    const missing = allMissing.filter(uid => !newMailOnly || uid > baselineUid)
    let indexed = 0
    if (missing.length) {
      checkpoint = await this.repo.save(ctx, "sync-state", checkpointId, accountId, {
        ...checkpoint.data, metadataComplete: false, headersIndexedCount: uids.length - allMissing.length,
        totalCount: uids.length, flagsOffset, uidDigest, updatedAt: Date.now(),
      }, checkpoint.revision)
      this.emit(ctx, accountId, [folder.id])
      const batch = missing.slice(0, checkpoint.data.firstPageDone ? MAIL_HISTORY_BATCH_SIZE : MAIL_PAGE_SIZE)
      const headers = await session.fetchHeaders(folder.data.folder.path, batch, ctx.signal)
      const allowed = new Set(batch), seen = new Set<number>()
      const notifications: MailSummary[] = []
      for (const header of headers) {
        if (!allowed.has(header.uid) || seen.has(header.uid)) throw new MailError("SEARCH_INCOMPLETE", "服务端返回无效邮件摘要")
        seen.add(header.uid)
        const receivedAt = header.receivedAt && Number.isFinite(Date.parse(header.receivedAt)) ? new Date(header.receivedAt).toISOString() : null
        // Sender is display metadata only; invalid or oversized values must not
        // replace recipients or block synchronization of an otherwise valid message.
        const rawSender = header.sender ?? []
        const sender = rawSender.length <= 100 && rawSender.every(value => addressSchema.safeParse(value).success) && Buffer.byteLength(JSON.stringify(rawSender)) <= 8 * 1024 ? rawSender : []
        const prior = existing.get(header.uid)
        if (prior) {
          // Upgrade metadata in the same bounded header batches; preserve identity,
          // cached assets, flags and old-mail notification baseline.
          const row = await this.repo.get<StoredMessage>(ctx, "messages", prior.id)
          const upgraded = { ...row.data, headers: { ...row.data.headers, sender }, summary: { ...row.data.summary, receivedAt: row.data.summary.receivedAt === undefined ? receivedAt : row.data.summary.receivedAt } }
          if (Buffer.byteLength(JSON.stringify(upgraded)) > 48 * 1024) upgraded.headers.sender = []
          const saved = await this.repo.save<StoredMessage>(ctx, "messages", row.id, accountId,
            upgraded, row.revision,
            messageSortKey(upgraded.summary.receivedAt, row.data.summary.date, header.uid))
          prior.needsMetadata = false
          this.emit(ctx, accountId, [row.id], saved.revision)
          continue
        }
        const id = `em_${randomUUID()}`
        const date = header.date && Number.isFinite(Date.parse(header.date)) ? header.date : null
        const mime = indexedStructure(header.structure)
        const summary: StoredMessage["summary"] = { id, accountId, locator: { accountId, folderId: folder.id, uidValidity: selected.uidValidity, uid: header.uid }, subject: header.subject, from: header.from, to: header.to, cc: header.cc, date, receivedAt, snippet: "", read: header.flags.includes("\\Seen"), star: header.flags.includes("\\Flagged"), attachmentCount: mime.attachments, bodyState: "remote", stale: false }
        let data: StoredMessage = { summary, headers: { sender, replyTo: header.replyTo, messageId: header.messageId, references: header.references }, structure: mime.structure, bodyRef: null }
        if (Buffer.byteLength(JSON.stringify(data)) > 48 * 1024) data.headers.sender = []
        // A single malformed/oversized envelope must not block newer mail. The original
        // MIME remains available on demand; never guess recipients from partial headers.
        if (Buffer.byteLength(JSON.stringify(data)) > 48 * 1024 || !summarySchema.safeParse({ ...summary, revision: 1 }).success || !header.replyTo.every(address => addressSchema.safeParse(address).success)) data = { summary: { ...summary, subject: "（邮件头异常或过大，部分信息不可用）", from: [], to: [], cc: [], metadataTruncated: true }, headers: { sender: [], replyTo: [], messageId: null, references: [] }, structure: null, bodyRef: null }
        const saved = await this.repo.save<StoredMessage>(ctx, "messages", id, accountId, data, 0, messageSortKey(receivedAt, date, header.uid))
        existing.set(header.uid, { id, stale: false, needsMetadata: false }); this.emit(ctx, accountId, [id], saved.revision)
        if (folder.data.folder.role === "drafts") await this.events.draft?.(ctx, id)
        if (header.uid > checkpoint.data.baselineUid && folder.data.folder.role === "inbox") notifications.push(messageSummary(saved))
      }
      if (notifications.length) await this.events.inbox(ctx, { accountId, messages: notifications, baseline: false })
      // UID disappearing between SEARCH and FETCH is retried by the next reconciliation, never guessed.
      if (seen.size !== batch.length) throw new MailError("SEARCH_INCOMPLETE", "邮件索引尚未完成")
      indexed = batch.length
      checkpoint = await this.repo.save(ctx, "sync-state", checkpointId, accountId, { ...checkpoint.data, firstPageDone: true, metadataComplete: false, updatedAt: Date.now() }, checkpoint.revision)
    }
    // Recheck generation before destructive local reconciliation.
    const verify = await session.select(folder.data.folder.path, ctx.signal)
    if (verify.uidValidity !== selected.uidValidity) throw new MailError("STALE_TARGET", "邮箱世代已变化，请重新同步")
    const remote = new Set(uids)
    for (const [uid, local] of existing) {
      if (remote.has(uid) || local.stale) continue
      const row = await this.repo.get<StoredMessage>(ctx, "messages", local.id)
      const saved = await this.repo.save(ctx, "messages", row.id, accountId, { ...row.data, summary: { ...row.data.summary, stale: true } }, row.revision, row.sortKey)
      existing.delete(uid)
      this.emit(ctx, accountId, [saved.id], saved.revision)
    }
    const headersComplete = indexed === missing.length
    // Publish the completed header work before waiting for a flag batch. Counts
    // describe verified server UIDs, not the number of cached message records.
    checkpoint = await this.repo.save(ctx, "sync-state", checkpointId, accountId, {
      ...checkpoint.data, metadataComplete: false, headersIndexedCount: uids.length - allMissing.length + indexed,
      totalCount: uids.length, flagsOffset, uidDigest, updatedAt: Date.now(),
    }, checkpoint.revision)
    this.emit(ctx, accountId, [folder.id])
    if (headersComplete && (flagsOffset < uids.length || flagsDue)) {
      const flags = await session.fetchFlags(folder.data.folder.path, uids.slice(flagsOffset, flagsOffset + MAIL_HISTORY_BATCH_SIZE), ctx.signal)
      for (const value of flags) {
        const target = existing.get(value.uid); if (!target || !remote.has(value.uid)) continue
        const row = await this.repo.get<StoredMessage>(ctx, "messages", target.id)
        const read = value.flags.includes("\\Seen"), star = value.flags.includes("\\Flagged")
        if (row.data.summary.read === read && row.data.summary.star === star && !row.data.summary.stale) continue
        const saved = await this.repo.save(ctx, "messages", row.id, accountId, { ...row.data, summary: { ...row.data.summary, read, star, stale: false } }, row.revision, row.sortKey)
        this.emit(ctx, accountId, [saved.id], saved.revision)
      }
      flagsOffset = Math.min(uids.length, flagsOffset + MAIL_HISTORY_BATCH_SIZE)
    }
    const metadataComplete = indexed === allMissing.length && flagsOffset >= uids.length
    const currentFolder = await this.repo.get<StoredFolder>(ctx, "folders", folder.id)
    await this.repo.save(ctx, "folders", folder.id, accountId, { ...currentFolder.data, folder: { ...currentFolder.data.folder, metadataComplete } }, currentFolder.revision, currentFolder.sortKey)
    await this.repo.save(ctx, "sync-state", checkpointId, accountId, { ...checkpoint.data, metadataComplete, flagsOffset, flagsCheckedAt: metadataComplete ? Date.now() : checkpoint.data.flagsCheckedAt ?? 0, uidDigest, indexedCount: existing.size, updatedAt: Date.now() }, checkpoint.revision)
    this.emit(ctx, accountId, [folder.id])
    return { ...emptyCoverage(), metadataComplete, indexedCount: existing.size, reason: metadataComplete ? "server_visible_history_only" : "metadata_indexing" }
  }
  async runOnce(ctx: MailContext, accountId: string, folderId?: string, refreshFolders = true, newMailOnly = false): Promise<Coverage> {
    return this.slots.run(ctx.signal, () => this.accounts.exclusive(ctx, accountId, async () => {
      if ((await this.accounts.get(ctx, accountId)).paused) throw new MailError("ACCOUNT_PAUSED", "邮箱已暂停，请先恢复同步")
      const { config, credential } = await this.accounts.credential(ctx, accountId)
      const session = await this.accounts.protocols.imap(ctx, config, credential)
      try {
        const folders = (await this.folders(ctx, accountId, session, refreshFolders)).filter(f => f.data.folder.selectable).sort((a, b) => Number(b.data.folder.role === "inbox") - Number(a.data.folder.role === "inbox"))
        let coverage: Coverage = { ...emptyCoverage(), metadataComplete: true, reason: "server_visible_history_only" }
        const key = `${ctx.ownerId}:${ctx.generation}:${accountId}`
        const queue = (this.folderQueues.get(key) ?? []).filter(id => folders.some(f => f.id === id))
        if (!newMailOnly) {
          for (const folder of folders) if ((refreshFolders || folder.data.folder.role === "inbox" || !folder.data.folder.metadataComplete) && !queue.includes(folder.id)) queue.push(folder.id)
        }
        const targetId = newMailOnly ? folders.find(f => f.data.folder.role === "inbox")?.id : folderId ?? queue[0]
        const target = folders.find(f => f.id === targetId)
        // Advance before IO so a failing Inbox cannot starve other folders. Each
        // turn still releases the work connection and account queue after one batch.
        if (!newMailOnly && targetId) { const index = queue.indexOf(targetId); if (index >= 0) queue.splice(index, 1) }
        this.folderQueues.set(key, queue)
        if (target) await this.syncFolder(ctx, accountId, target, session, newMailOnly)
        for (const folder of folders) {
          const checkpoint = await this.repo.find<FolderCheckpoint>(ctx, "sync-state", `folder:${folder.id}`)
          coverage.indexedCount += checkpoint?.data.indexedCount ?? 0
          coverage.metadataComplete &&= checkpoint?.data.metadataComplete ?? false
        }
        if (!folderId && !newMailOnly && queue.length) coverage.metadataComplete = false
        if (!coverage.metadataComplete) coverage.reason = "metadata_indexing"
        const account = await this.repo.get<StoredAccount>(ctx, "accounts", accountId)
        if (!account.data.paused && ["offline", "error", "connecting"].includes(account.data.state)) {
          await this.repo.save(ctx, "accounts", accountId, accountId, { ...account.data, state: "connected", errorCode: null }, account.revision)
          this.emit(ctx, accountId, [accountId])
        }
        return coverage
      } finally { await session.close() }
    }))
  }
  async start(ctx: MailContext, input: MailInputs["sync.start"]): Promise<{ jobId: string }> { return this.startAccount(ctx, input.accountId, input.folderId) }
  async startAccount(ctx: MailContext, accountId: string, folderId?: string): Promise<{ jobId: string }> {
    if ((await this.accounts.get(ctx, accountId)).paused) throw new MailError("ACCOUNT_PAUSED", "邮箱已暂停，请先恢复同步")
    const key = `${ctx.ownerId}:${accountId}`
    const existing = this.runners.get(key)
    if (folderId) {
      const folder = await this.repo.get<StoredFolder>(ctx, "folders", folderId)
      if (folder.accountId !== accountId) throw new MailError("UNAVAILABLE", "文件夹不属于此账号")
    }
    if (existing && !existing.controller.signal.aborted && !existing.ctx.signal.aborted && !existing.historyPaused) { existing.hint = true; existing.folderId = folderId; existing.foreground = true; existing.requestVersion++; return { jobId: existing.jobId } }
    if (existing) { existing.controller.abort(); await existing.idle?.close() }
    const controller = new AbortController(), signal = AbortSignal.any([ctx.signal, controller.signal])
    const jobId = `mj_${randomUUID()}`
    const runner: Runner = { ctx: { ...ctx, actor: "sync", signal }, accountId, controller, jobId, task: Promise.resolve(), hint: false, folderId, lastFolders: -Infinity, foreground: true, requestVersion: 0 }
    await this.repo.save<StoredJob>(ctx, "sync-state", jobId, accountId, { kind: "job", job: { jobId, accountId, state: "running", coverage: emptyCoverage(), errorCode: null } }, 0)
    this.runners.set(key, runner)
    runner.task = Promise.resolve().then(() => this.loop(runner)).catch(error => {
      if (!signal.aborted) this.events.error(normalizeProtocolError(error).code, accountId)
    }).finally(() => { if (this.runners.get(key) === runner) this.runners.delete(key) })
    return { jobId }
  }
  private async loop(runner: Runner): Promise<void> {
    const { ctx, accountId } = runner
    let failures = 0
    let coverage = emptyCoverage()
    while (!ctx.signal.aborted && !this.suspended) {
      try {
        const foreground = runner.foreground, requestVersion = runner.requestVersion
        if (!runner.historyPaused && foreground) {
          const previous = (await this.repo.get<StoredJob>(ctx, "sync-state", runner.jobId)).data.job
          if (previous.state !== "running") await this.updateJob(ctx, runner.jobId, "running", previous.coverage, null)
        }
        const refresh = Date.now() - runner.lastFolders >= MAIL_FOLDER_REFRESH_MS
        const requestedFolder = runner.folderId
        runner.hint = false
        coverage = await this.runOnce(ctx, accountId, requestedFolder, refresh, runner.historyPaused)
        if (runner.folderId === requestedFolder) runner.folderId = undefined
        if (refresh) runner.lastFolders = Date.now()
        failures = 0
        // Periodic reconciliation keeps the last completed job quiet. A manual
        // request arriving during this turn must finish in a subsequent turn.
        if (!runner.historyPaused && requestVersion === runner.requestVersion && (foreground || coverage.metadataComplete)) {
          await this.updateJob(ctx, runner.jobId, coverage.metadataComplete ? "completed" : "running", coverage, null)
          if (coverage.metadataComplete && requestVersion === runner.requestVersion) runner.foreground = false
        }
        if (!runner.idleTask) runner.idleTask = this.watchInbox(runner).catch(error => {
          if (!ctx.signal.aborted) this.events.error(normalizeProtocolError(error).code, accountId)
        }).finally(() => { runner.idleTask = undefined })
        if (!coverage.metadataComplete && !runner.historyPaused) { await wait(0, ctx.signal); continue }
        // IDLE is only a hint; periodic reconciliation remains authoritative.
        for (let elapsed = 0; elapsed < MAIL_POLL_INTERVAL_MS && !runner.hint && !ctx.signal.aborted; elapsed += 1000) await wait(1000, ctx.signal)
      } catch (error) {
        if (ctx.signal.aborted) break
        const code = normalizeProtocolError(error).code
        if (code === "ACCOUNT_PAUSED") { await this.updateJob(ctx, runner.jobId, "paused", coverage, code); break }
        runner.foreground = true
        if (!runner.historyPaused) await this.updateJob(ctx, runner.jobId, code === "AUTH_FAILED" ? "paused" : "failed", coverage, code)
        const row = await this.repo.get<StoredAccount>(ctx, "accounts", accountId)
        await this.repo.save(ctx, "accounts", accountId, accountId, { ...row.data, state: code === "AUTH_FAILED" ? "auth_failed" : "offline", errorCode: code }, row.revision)
        this.emit(ctx, accountId, [accountId]); this.events.error(code, accountId)
        if (code === "AUTH_FAILED") break
        await wait(Math.min(300_000, 1000 * 2 ** Math.min(failures++, 9)) * (0.8 + Math.random() * 0.4), ctx.signal)
      }
    }
    runner.controller.abort()
    await runner.idle?.close()
  }
  private async watchInbox(runner: Runner): Promise<void> {
    const { ctx, accountId } = runner
    const { config, credential } = await this.accounts.credential(ctx, accountId)
    const session = await this.accounts.protocols.imap(ctx, config, credential)
    runner.idle = session
    try {
      if (!session.capabilities.has("IDLE")) return
      let cursor: string | undefined, inbox: Folder | undefined
      do { const page = await this.repo.page<StoredFolder>(ctx, "folders", { accountId, cursor, limit: 100 }); inbox = page.items.find(f => f.data.folder.role === "inbox")?.data.folder; cursor = page.nextCursor ?? undefined } while (!inbox && cursor)
      if (!inbox) return
      while (!ctx.signal.aborted) { await session.idle(inbox.path, ctx.signal, () => { runner.hint = true }); await wait(50, ctx.signal) }
    } finally { await session.close(); if (runner.idle === session) runner.idle = undefined }
  }
  private async syncProgress(ctx: MailContext, accountId: string): Promise<NonNullable<MailJob["syncProgress"]>> {
    let cursor: string | undefined, total = 0, indexed = 0, checked = 0, known = true, folders = 0
    do {
      const page = await this.repo.page<StoredFolder>(ctx, "folders", { accountId, cursor, limit: 100 })
      for (const row of page.items) {
        if (!row.data.folder.selectable) continue
        folders++
        const checkpoint = await this.repo.find<FolderCheckpoint>(ctx, "sync-state", `folder:${row.id}`)
        const data = checkpoint?.data
        if (!data || data.uidValidity !== row.data.folder.uidValidity || data.totalCount === undefined || data.headersIndexedCount === undefined) { known = false; continue }
        total += data.totalCount
        indexed += data.headersIndexedCount
        checked += Math.min(data.flagsOffset ?? 0, data.totalCount)
      }
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    const reconciling = known && folders > 0 && indexed === total
    return { phase: reconciling ? "reconciling" : "indexing", completed: reconciling ? checked : indexed, total: known && folders > 0 ? total : null }
  }
  private async updateJob(ctx: MailContext, jobId: string, state: MailJob["state"], coverage: Coverage, errorCode: string | null): Promise<MailJob> {
    const row = await this.repo.get<StoredJob>(ctx, "sync-state", jobId)
    const job = { ...row.data.job, state, coverage, errorCode, syncProgress: await this.syncProgress(ctx, row.accountId) }
    await this.repo.save(ctx, "sync-state", jobId, row.accountId, { kind: "job", job }, row.revision)
    this.emit(ctx, row.accountId, [jobId]); return job
  }
  async get(ctx: MailContext, input: MailInputs["sync.get"]): Promise<MailJob | null> {
    let jobId = input.jobId
    if (input.accountId) {
      await this.accounts.get(ctx, input.accountId)
      const current = this.runners.get(`${ctx.ownerId}:${input.accountId}`)
      if (!current || current.ctx.generation !== ctx.generation || current.ctx.signal.aborted || this.suspended) return null
      jobId = current.jobId
    }
    if (!jobId) throw new MailError("INVALID_INPUT", "请选择同步任务或邮箱账号")
    const job = (await this.repo.get<StoredJob>(ctx, "sync-state", jobId)).data.job
    const runner = this.runners.get(`${ctx.ownerId}:${job.accountId}`)
    const running = runner?.jobId === job.jobId && runner.ctx.generation === ctx.generation && !runner.ctx.signal.aborted && !this.suspended
    if (running && !runner.historyPaused && (job.state === "running" || job.state === "completed" && runner.foreground)) return { ...job, state: "running", syncProgress: await this.syncProgress(ctx, job.accountId) }
    return job.state === "running" && !running ? { ...job, state: "paused" } : job
  }
  async cancel(ctx: MailContext, input: MailInputs["sync.cancel"]): Promise<MailJob> {
    const job = (await this.repo.get<StoredJob>(ctx, "sync-state", input.jobId)).data.job
    const runner = this.runners.get(`${ctx.ownerId}:${job.accountId}`)
    if (runner?.jobId === job.jobId) runner.historyPaused = true
    return this.updateJob(ctx, input.jobId, "cancelled", job.coverage, null)
  }
  async stopAccount(accountId: string): Promise<void> {
    for (const key of this.folderQueues.keys()) if (key.endsWith(`:${accountId}`)) this.folderQueues.delete(key)
    const runners = [...this.runners.values()].filter(r => r.accountId === accountId)
    for (const r of runners) { r.controller.abort(); await r.idle?.close() }
    // May be called while holding the account queue. Aborted queued work validates
    // its context before touching storage; waiting for it here would deadlock.
  }
  async suspend(): Promise<void> { this.suspended = true; await this.dispose() }
  async resume(ctx: MailContext): Promise<void> {
    this.suspended = false
    let cursor: string | undefined
    do {
      const page = await this.repo.page<StoredAccount>(ctx, "accounts", { cursor, limit: 100 })
      for (const row of page.items) if (!row.data.paused && !["unverified", "auth_failed"].includes(row.data.state)) await this.startAccount(ctx, row.id)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
  }
  async dispose(): Promise<void> {
    const runners = [...this.runners.values()]
    await Promise.all([...new Set(runners.map(r => r.accountId))].map(id => this.stopAccount(id)))
    await Promise.all(runners.map(r => r.task))
    await Promise.all(runners.map(r => r.idleTask))
    this.folderQueues.clear()
  }
}
function indexedStructure(structure: MailBodyStructure | null): { structure: MailBodyStructure | null; attachments: number } {
  if (!structure) return { structure: null, attachments: 0 }
  const pending = [{ node: structure, depth: 0 }], seen = new Set<MailBodyStructure>()
  let attachments = 0
  while (pending.length) {
    const { node, depth } = pending.pop()!
    if (seen.has(node) || seen.size >= 1000 || depth > 30 || typeof node.type !== "string") return { structure: null, attachments: 0 }
    seen.add(node)
    if (node.disposition?.toLowerCase() === "attachment") attachments++
    for (const child of node.childNodes ?? []) pending.push({ node: child, depth: depth + 1 })
  }
  return { structure: Buffer.byteLength(JSON.stringify(structure)) <= 16 * 1024 ? structure : null, attachments }
}
