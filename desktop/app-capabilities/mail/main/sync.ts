import { randomUUID } from "node:crypto"
import type { MailRecord } from "../../../electron/runtime/data-repo/schemas/mail"
import { MAIL_FOLDER_REFRESH_MS, MAIL_HISTORY_BATCH_SIZE, MAIL_HISTORY_CONCURRENCY, MAIL_PAGE_SIZE, MAIL_POLL_INTERVAL_MS } from "../shared/limits"
import { MailError, type Coverage, type Folder, type InboxDelta, type MailContext, type MailDetail, type MailInputs, type MailJob, type MailSummary } from "../shared/types"
import { MailRepository } from "./repository"
import { MailAccounts, type StoredAccount } from "./accounts"
import { normalizeProtocolError, type MailBodyStructure, type MailImapSession, type RemoteHeader } from "./protocol/types"

export interface StoredFolder extends Record<string, unknown> { folder: Folder; delimiter: string; flags: string[] }
export interface StoredMessage extends Record<string, unknown> {
  summary: Omit<MailSummary, "revision">; headers: MailDetail["headers"]; structure: MailBodyStructure | null; bodyRef: string | null; searchTextRef?: string; originalFolderId?: string
}
interface FolderCheckpoint extends Record<string, unknown> { kind: "folder"; folderId: string; uidValidity: string; baselineUid: number; metadataComplete: boolean; updatedAt: number }
interface StoredJob extends Record<string, unknown> { kind: "job"; job: MailJob }
export interface MailChanged { ownerId: string; generation: number; accountId: string; ids: string[]; revision: number }
export interface SyncEvents {
  changed(event: MailChanged): void
  inbox(ctx: MailContext, delta: InboxDelta): void | Promise<void>
  error(code: string, accountId: string): void
}
export const emptyCoverage = (): Coverage => ({ metadataComplete: false, serverHistoryComplete: null, indexedCount: 0, bodyScannedCount: 0, bodyPendingCount: null, reason: "metadata_indexing" })
export const messageSummary = (row: MailRecord<StoredMessage>): MailSummary => ({ ...row.data.summary, revision: row.revision })
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
interface Runner { ctx: MailContext; accountId: string; controller: AbortController; task: Promise<void>; idle?: MailImapSession; idleTask?: Promise<void>; hint: boolean; jobId: string; folderId?: string; lastFolders: number }

export class MailSync {
  private runners = new Map<string, Runner>()
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
  private async syncFolder(ctx: MailContext, accountId: string, initialFolder: MailRecord<StoredFolder>, session: MailImapSession): Promise<Coverage> {
    let folder = initialFolder
    const selected = await session.select(folder.data.folder.path, ctx.signal)
    const uids = await session.searchUids(folder.data.folder.path, { all: true }, ctx.signal)
    if (uids.some(uid => !Number.isSafeInteger(uid) || uid < 1) || new Set(uids).size !== uids.length) throw new MailError("SEARCH_INCOMPLETE", "邮件 UID 校对不完整")
    uids.sort((a, b) => b - a)
    const checkpointId = `folder:${folder.id}`
    let checkpoint = await this.repo.find<FolderCheckpoint>(ctx, "sync-state", checkpointId)
    const validityChanged = checkpoint?.data.uidValidity !== selected.uidValidity
    if (!checkpoint || validityChanged) {
      checkpoint = await this.repo.save(ctx, "sync-state", checkpointId, accountId, { kind: "folder", folderId: folder.id, uidValidity: selected.uidValidity, baselineUid: uids[0] ?? 0, metadataComplete: false, updatedAt: Date.now() }, checkpoint?.revision ?? 0)
    }
    folder = await this.repo.save(ctx, "folders", folder.id, accountId, { ...folder.data, folder: { ...folder.data.folder, uidValidity: selected.uidValidity, metadataComplete: false } }, folder.revision, folder.sortKey)
    const existing = new Map<number, { id: string; stale: boolean }>()
    let cursor: string | undefined
    do {
      const page = await this.repo.page<StoredMessage>(ctx, "messages", { accountId, cursor, limit: 100 })
      for (const row of page.items) {
        const locator = row.data.summary.locator
        if (locator.folderId !== folder.id) continue
        if (locator.uidValidity !== selected.uidValidity) {
          if (!row.data.summary.stale) await this.repo.save(ctx, "messages", row.id, accountId, { ...row.data, summary: { ...row.data.summary, stale: true } }, row.revision, row.sortKey)
        } else existing.set(locator.uid, { id: row.id, stale: row.data.summary.stale })
      }
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    const missing = uids.filter(uid => !existing.has(uid))
    for (let offset = 0; offset < missing.length;) {
      const batch = missing.slice(offset, offset + (offset === 0 && !checkpoint.data.metadataComplete ? MAIL_PAGE_SIZE : MAIL_HISTORY_BATCH_SIZE))
      const headers = await session.fetchHeaders(folder.data.folder.path, batch, ctx.signal)
      const allowed = new Set(batch), seen = new Set<number>()
      const notifications: MailSummary[] = []
      for (const header of headers) {
        if (!allowed.has(header.uid) || seen.has(header.uid)) throw new MailError("SEARCH_INCOMPLETE", "服务端返回无效邮件摘要")
        seen.add(header.uid)
        const id = `em_${randomUUID()}`
        const date = header.date && Number.isFinite(Date.parse(header.date)) ? header.date : null
        const summary: StoredMessage["summary"] = { id, accountId, locator: { accountId, folderId: folder.id, uidValidity: selected.uidValidity, uid: header.uid }, subject: header.subject, from: header.from, to: header.to, cc: header.cc, date, snippet: "", read: header.flags.includes("\\Seen"), star: header.flags.includes("\\Flagged"), attachmentCount: countAttachments(header.structure), bodyState: "remote", stale: false }
        const saved = await this.repo.save<StoredMessage>(ctx, "messages", id, accountId, { summary, headers: { replyTo: header.replyTo, messageId: header.messageId, references: header.references }, structure: header.structure, bodyRef: null }, 0, `${String(9_999_999_999_999 - (date ? Date.parse(date) : header.uid)).padStart(13, "0")}`)
        existing.set(header.uid, { id, stale: false }); this.emit(ctx, accountId, [id], saved.revision)
        if (header.uid > checkpoint.data.baselineUid && folder.data.folder.role === "inbox") notifications.push(messageSummary(saved))
      }
      if (notifications.length) await this.events.inbox(ctx, { accountId, messages: notifications, baseline: false })
      // UID disappearing between SEARCH and FETCH is retried by the next reconciliation, never guessed.
      if (seen.size !== batch.length) throw new MailError("SEARCH_INCOMPLETE", "邮件索引尚未完成")
      offset += batch.length
      await this.repo.save(ctx, "sync-state", checkpointId, accountId, { ...checkpoint.data, updatedAt: Date.now() }, checkpoint.revision).then(row => { checkpoint = row })
    }
    // Recheck generation before destructive local reconciliation.
    const verify = await session.select(folder.data.folder.path, ctx.signal)
    if (verify.uidValidity !== selected.uidValidity) throw new MailError("STALE_TARGET", "邮箱世代已变化，请重新同步")
    const remote = new Set(uids)
    for (const [uid, local] of existing) {
      if (remote.has(uid) || local.stale) continue
      const row = await this.repo.get<StoredMessage>(ctx, "messages", local.id)
      const saved = await this.repo.save(ctx, "messages", row.id, accountId, { ...row.data, summary: { ...row.data.summary, stale: true } }, row.revision, row.sortKey)
      this.emit(ctx, accountId, [saved.id], saved.revision)
    }
    for (let offset = 0; offset < uids.length; offset += MAIL_HISTORY_BATCH_SIZE) {
      const flags = await session.fetchFlags(folder.data.folder.path, uids.slice(offset, offset + MAIL_HISTORY_BATCH_SIZE), ctx.signal)
      for (const value of flags) {
        const target = existing.get(value.uid); if (!target || !remote.has(value.uid)) continue
        const row = await this.repo.get<StoredMessage>(ctx, "messages", target.id)
        const read = value.flags.includes("\\Seen"), star = value.flags.includes("\\Flagged")
        if (row.data.summary.read === read && row.data.summary.star === star && !row.data.summary.stale) continue
        const saved = await this.repo.save(ctx, "messages", row.id, accountId, { ...row.data, summary: { ...row.data.summary, read, star, stale: false } }, row.revision, row.sortKey)
        this.emit(ctx, accountId, [saved.id], saved.revision)
      }
    }
    const currentFolder = await this.repo.get<StoredFolder>(ctx, "folders", folder.id)
    await this.repo.save(ctx, "folders", folder.id, accountId, { ...currentFolder.data, folder: { ...currentFolder.data.folder, metadataComplete: true } }, currentFolder.revision, currentFolder.sortKey)
    await this.repo.save(ctx, "sync-state", checkpointId, accountId, { ...checkpoint.data, metadataComplete: true, updatedAt: Date.now() }, checkpoint.revision)
    this.emit(ctx, accountId, [folder.id])
    return { ...emptyCoverage(), metadataComplete: true, indexedCount: uids.length, reason: "server_visible_history_only" }
  }
  async runOnce(ctx: MailContext, accountId: string, folderId?: string, refreshFolders = true): Promise<Coverage> {
    return this.slots.run(ctx.signal, () => this.accounts.exclusive(ctx, accountId, async () => {
      const { config, credential } = await this.accounts.credential(ctx, accountId)
      const session = await this.accounts.protocols.imap(ctx, config, credential)
      try {
        const folders = await this.folders(ctx, accountId, session, refreshFolders)
        let coverage: Coverage = { ...emptyCoverage(), metadataComplete: true, reason: "server_visible_history_only" }
        for (const folder of folders.filter(f => f.data.folder.selectable && (folderId ? f.id === folderId : refreshFolders || f.data.folder.role === "inbox"))) {
          const result = await this.syncFolder(ctx, accountId, folder, session)
          coverage = { ...result, indexedCount: coverage.indexedCount + result.indexedCount }
        }
        return coverage
      } finally { await session.close() }
    }))
  }
  async start(ctx: MailContext, input: MailInputs["sync.start"]): Promise<{ jobId: string }> { return this.startAccount(ctx, input.accountId, input.folderId) }
  async startAccount(ctx: MailContext, accountId: string, folderId?: string): Promise<{ jobId: string }> {
    await this.accounts.get(ctx, accountId)
    const key = `${ctx.ownerId}:${accountId}`
    const existing = this.runners.get(key)
    if (existing && !existing.controller.signal.aborted) { existing.hint = true; return { jobId: existing.jobId } }
    const controller = new AbortController(), signal = AbortSignal.any([ctx.signal, controller.signal])
    const jobId = `mj_${randomUUID()}`
    const runner: Runner = { ctx: { ...ctx, actor: "sync", signal }, accountId, controller, jobId, task: Promise.resolve(), hint: false, folderId, lastFolders: -Infinity }
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
    while (!ctx.signal.aborted && !this.suspended) {
      try {
        const refresh = Date.now() - runner.lastFolders >= MAIL_FOLDER_REFRESH_MS
        const coverage = await this.runOnce(ctx, accountId, runner.folderId, refresh)
        if (refresh) runner.lastFolders = Date.now()
        failures = 0
        await this.updateJob(ctx, runner.jobId, "completed", coverage, null)
        if (!runner.idleTask) runner.idleTask = this.watchInbox(runner).catch(error => {
          if (!ctx.signal.aborted) this.events.error(normalizeProtocolError(error).code, accountId)
        }).finally(() => { runner.idleTask = undefined })
        runner.hint = false
        // IDLE is only a hint; periodic reconciliation remains authoritative.
        for (let elapsed = 0; elapsed < MAIL_POLL_INTERVAL_MS && !runner.hint && !ctx.signal.aborted; elapsed += 1000) await wait(1000, ctx.signal)
      } catch (error) {
        if (ctx.signal.aborted) break
        const code = normalizeProtocolError(error).code
        await this.updateJob(ctx, runner.jobId, code === "AUTH_FAILED" ? "paused" : "failed", emptyCoverage(), code)
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
  private async updateJob(ctx: MailContext, jobId: string, state: MailJob["state"], coverage: Coverage, errorCode: string | null): Promise<MailJob> {
    const row = await this.repo.get<StoredJob>(ctx, "sync-state", jobId)
    const job = { ...row.data.job, state, coverage, errorCode }
    await this.repo.save(ctx, "sync-state", jobId, row.accountId, { kind: "job", job }, row.revision)
    this.emit(ctx, row.accountId, [jobId]); return job
  }
  async get(ctx: MailContext, input: MailInputs["sync.get"]): Promise<MailJob> { return (await this.repo.get<StoredJob>(ctx, "sync-state", input.jobId)).data.job }
  async cancel(ctx: MailContext, input: MailInputs["sync.cancel"]): Promise<MailJob> {
    const job = await this.get(ctx, input)
    await this.stopAccount(job.accountId)
    return this.updateJob(ctx, input.jobId, "cancelled", job.coverage, null)
  }
  async stopAccount(accountId: string): Promise<void> {
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
  }
}
function countAttachments(structure: MailBodyStructure | null): number {
  if (!structure) return 0
  return (structure.disposition?.toLowerCase() === "attachment" ? 1 : 0) + (structure.childNodes ?? []).reduce((sum, child) => sum + countAttachments(child), 0)
}
