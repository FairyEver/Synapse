import { createHash, randomUUID } from "node:crypto"
import { MAIL_SEARCH_BATCH_BYTES, MAIL_SEARCH_BATCH_MS, MAIL_SEARCH_TTL_MS, MAIL_MAX_BODY_BYTES } from "../shared/limits"
import { matchesMailFilters, matchesMailText } from "../shared/search"
import { MAIL_INPUT_SCHEMAS } from "../shared/schema"
import { MailError, type Coverage, type MailContext, type MailInputs, type MailJob, type MailResults, type SearchAction } from "../shared/types"
import { MailRepository } from "./repository"
import { emptyCoverage, messageSummary, type StoredFolder, type StoredMessage } from "./sync"

export interface SearchText { text: string; bytes: number; available: boolean; truncated?: boolean }
export type ReadSearchText = (ctx: MailContext, messageId: string, options: { cachedOnly: boolean; maxBytes: number }) => Promise<SearchText>
interface SearchTask extends Record<string, unknown> {
  input: MailInputs["search.start"]; job: MailJob; expiresAt: number; phase: "local" | "remote" | "complete";
  scanCursor?: string; indexToken: string; remotePending: number; bodyComplete: boolean
}
interface SearchResult extends Record<string, unknown> { jobId: string; messageId: string; sourceRevision: number; matched: boolean; bodyScanned: boolean }

export class MailSearch {
  private running = new Map<string, { task: Promise<void>; controller: AbortController }>()
  constructor(private readonly repo: MailRepository, private readonly readSearchText: ReadSearchText, private readonly onChanged: (ctx: MailContext, accountId: string, jobId: string) => void = () => undefined) {}
  private async indexState(ctx: MailContext, accountId: string, folderId?: string): Promise<{ coverage: Coverage; serverReported: number | null; token: string }> {
    let cursor: string | undefined, complete = true, found = false, reported: number | null = 0
    const token = createHash("sha256")
    do {
      const page = await this.repo.page<StoredFolder>(ctx, "folders", { accountId, cursor, limit: 100 })
      for (const row of page.items) {
        if (folderId && row.id !== folderId) continue
        found = true; complete &&= row.data.folder.metadataComplete
        token.update(`${row.id}:${row.revision};`)
        if (row.data.folder.serverCount === null) reported = null; else if (reported !== null) reported += row.data.folder.serverCount
      }
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    return { coverage: { ...emptyCoverage(), metadataComplete: complete && found, reason: complete && found ? "server_visible_history_only" : "metadata_indexing" }, serverReported: reported, token: token.digest("hex") }
  }
  async listMessages(ctx: MailContext, input: MailInputs["message.list"]): Promise<MailResults["message.list"]> {
    await this.repo.get(ctx, "accounts", input.accountId)
    const { cursor: initial, limit, ...filters } = input
    let cursor = initial
    const items: MailResults["message.list"]["items"] = []
    do {
      const page = await this.repo.page<StoredMessage>(ctx, "messages", { accountId: input.accountId, cursor, limit: limit - items.length, binding: JSON.stringify(filters) })
      for (const row of page.items) if (matchesMailFilters(row.data.summary, filters)) items.push(messageSummary(row))
      cursor = page.nextCursor ?? undefined
      if (!cursor) break
    } while (items.length < limit)
    const state = await this.countMessages(ctx, { accountId: input.accountId, folderId: input.folderId })
    return { items, nextCursor: cursor ?? null, coverage: state.coverage }
  }
  async countMessages(ctx: MailContext, input: MailInputs["message.count"]): Promise<MailResults["message.count"]> {
    await this.repo.get(ctx, "accounts", input.accountId)
    let indexed = 0, unread = 0, cursor: string | undefined
    do {
      const page = await this.repo.page<StoredMessage>(ctx, "messages", { accountId: input.accountId, cursor, limit: 100 })
      for (const row of page.items) if (matchesMailFilters(row.data.summary, input)) { indexed++; if (!row.data.summary.read) unread++ }
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    const state = await this.indexState(ctx, input.accountId, input.folderId)
    return { indexed, unread, serverReported: state.serverReported, coverage: { ...state.coverage, indexedCount: indexed } }
  }
  private async task(ctx: MailContext, id: string) {
    const row = await this.repo.get<SearchTask>(ctx, "search-tasks", id)
    if (row.data.expiresAt <= Date.now()) throw new MailError("CURSOR_EXPIRED", "搜索任务已过期，请重新搜索")
    return row
  }
  private schedule(ctx: MailContext, id: string): void {
    if (this.running.has(id)) return
    const controller = new AbortController(), scanCtx = { ...ctx, signal: AbortSignal.any([ctx.signal, controller.signal]) }
    const task = this.scan(scanCtx, id).catch(async error => {
      if (scanCtx.signal.aborted) return
      const row = await this.task(ctx, id)
      await this.repo.save(ctx, "search-tasks", id, row.accountId, { ...row.data, job: { ...row.data.job, state: "failed", errorCode: error instanceof MailError ? error.code : "SEARCH_FAILED" }, bodyComplete: false }, row.revision)
      this.onChanged(ctx, row.accountId, id)
    }).finally(() => this.running.delete(id))
    this.running.set(id, { controller, task })
  }
  async settle(): Promise<void> { await Promise.all([...this.running.values()].map(r => r.task)) }
  async dispose(): Promise<void> { for (const r of this.running.values()) r.controller.abort(); await this.settle() }
  private async scan(ctx: MailContext, id: string): Promise<void> {
    const row = await this.task(ctx, id)
    let data = row.data, cursor = data.scanCursor, bytes = 0, scanned = 0
    const started = Date.now(), remote = data.phase === "remote", body = data.input.fields === "body"
    if (data.phase === "complete" || data.job.state === "cancelled") return
    let ended = false, limited = !data.bodyComplete
    while (scanned < (body ? 100 : 1000) && Date.now() - started < MAIL_SEARCH_BATCH_MS && bytes <= MAIL_SEARCH_BATCH_BYTES - (body ? MAIL_MAX_BODY_BYTES : 1)) {
      const page = await this.repo.page<StoredMessage>(ctx, "messages", { accountId: row.accountId, cursor, limit: body ? 1 : 100, binding: id })
      for (const message of page.items) {
        if (!matchesMailFilters(message.data.summary, data.input)) continue
        const resultId = `${id}:${message.id}`
        const existing = await this.repo.find<SearchResult>(ctx, "search-results", resultId)
        if (remote && existing?.data.bodyScanned) continue
        let text = ""
        let bodyScanned = false
        if (!remote) data = { ...data, job: { ...data.job, coverage: { ...data.job.coverage, indexedCount: data.job.coverage.indexedCount + 1 } } }
        if (body) {
          const content = await this.readSearchText(ctx, message.id, { cachedOnly: !remote, maxBytes: MAIL_SEARCH_BATCH_BYTES - bytes })
          bytes += content.bytes
          if (content.available) {
            text = content.text
            bodyScanned = true
            if (content.truncated) limited = true
            data = { ...data, remotePending: Math.max(0, data.remotePending - (remote ? 1 : 0)), job: { ...data.job, coverage: { ...data.job.coverage, bodyScannedCount: data.job.coverage.bodyScannedCount + 1 } } }
          } else if (!remote) data = { ...data, remotePending: data.remotePending + 1 }
          if (remote && !content.available) throw new MailError("BODY_UNAVAILABLE", "部分正文暂不可用")
        }
        const matched = (existing?.data.matched ?? false) || matchesMailText(message.data.summary, data.input.query, text)
        if (matched || body) {
          await this.repo.save<SearchResult>(ctx, "search-results", resultId, row.accountId, { jobId: id, messageId: message.id, sourceRevision: message.revision, matched, bodyScanned }, existing?.revision ?? 0, message.sortKey)
        }
      }
      scanned += page.items.length; cursor = page.nextCursor ?? undefined
      if (!cursor) { ended = true; break }
    }
    let phase = data.phase
    if (ended) { phase = body && !remote && data.remotePending > 0 ? "remote" : "complete"; cursor = undefined }
    const state = await this.indexState(ctx, row.accountId, data.input.folderId)
    const reason = state.token !== data.indexToken ? "index_changed" : limited ? "body_truncated" : phase === "complete" ? state.coverage.reason : phase === "remote" && ended ? "body_not_scanned" : "scan_budget"
    const coverage = { ...data.job.coverage, metadataComplete: state.coverage.metadataComplete, serverHistoryComplete: null, bodyPendingCount: body ? (phase === "local" ? null : phase === "complete" ? 0 : data.remotePending) : null, reason }
    const current = await this.task(ctx, id)
    await this.repo.save<SearchTask>(ctx, "search-tasks", id, row.accountId, { ...data, phase, scanCursor: cursor, bodyComplete: !limited, job: { ...data.job, state: phase === "complete" ? "completed" : "paused", coverage, errorCode: null } }, current.revision)
    this.onChanged(ctx, row.accountId, id)
  }
  async execute<K extends SearchAction>(ctx: MailContext, action: K, input: MailInputs[K]): Promise<MailResults[K]> {
    let result: unknown
    if (action === "search.start") {
      const params = MAIL_INPUT_SCHEMAS["search.start"].parse(input)
      await this.repo.get(ctx, "accounts", params.accountId)
      const id = `mj_${randomUUID()}`, state = await this.indexState(ctx, params.accountId, params.folderId)
      await this.repo.save<SearchTask>(ctx, "search-tasks", id, params.accountId, { input: params, job: { jobId: id, accountId: params.accountId, state: "running", coverage: state.coverage, errorCode: null }, expiresAt: Date.now() + MAIL_SEARCH_TTL_MS, phase: "local", indexToken: state.token, remotePending: 0, bodyComplete: true }, 0)
      this.schedule(ctx, id); result = { jobId: id }
    } else if (action === "search.get") {
      const params = MAIL_INPUT_SCHEMAS["search.get"].parse(input), row = await this.task(ctx, params.jobId)
      const items: MailResults["search.get"]["items"] = []
      let cursor = params.cursor, changed = false
      do {
        const page = await this.repo.page<SearchResult>(ctx, "search-results", { accountId: row.accountId, cursor, limit: params.limit - items.length, binding: params.jobId })
        for (const entry of page.items) {
          if (entry.data.jobId !== params.jobId || !entry.data.matched) continue
          const message = await this.repo.find<StoredMessage>(ctx, "messages", entry.data.messageId)
          if (!message || message.revision !== entry.data.sourceRevision) changed = true
          if (message && matchesMailFilters(message.data.summary, row.data.input) && (row.data.input.fields === "body" || matchesMailText(message.data.summary, row.data.input.query))) items.push(messageSummary(message))
        }
        cursor = page.nextCursor ?? undefined
        if (!cursor) break
      } while (items.length < params.limit)
      const state = await this.indexState(ctx, row.accountId, row.data.input.folderId)
      const coverage = { ...row.data.job.coverage, ...(changed || state.token !== row.data.indexToken ? { metadataComplete: false, reason: "index_changed" } : {}) }
      result = { items, nextCursor: cursor ?? null, coverage, canContinue: row.data.phase !== "complete" && row.data.job.state !== "cancelled" }
    } else if (action === "search.resume") {
      const params = MAIL_INPUT_SCHEMAS["search.resume"].parse(input), row = await this.task(ctx, params.jobId)
      if (row.data.job.state === "cancelled") throw new MailError("CANCELLED", "搜索任务已取消")
      if (row.data.phase === "complete" || this.running.has(row.id)) result = row.data.job
      else {
        const job = { ...row.data.job, state: "running" as const, errorCode: null }
        await this.repo.save(ctx, "search-tasks", row.id, row.accountId, { ...row.data, job }, row.revision)
        this.schedule(ctx, row.id); result = job
      }
    } else {
      const params = MAIL_INPUT_SCHEMAS["search.cancel"].parse(input), row = await this.task(ctx, params.jobId)
      this.running.get(row.id)?.controller.abort(); await this.running.get(row.id)?.task
      const current = await this.task(ctx, row.id), job = { ...current.data.job, state: "cancelled" as const }
      await this.repo.save(ctx, "search-tasks", row.id, row.accountId, { ...current.data, job }, current.revision); result = job
    }
    return result as MailResults[K]
  }
}
