import { randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import type { MailRecord } from "../../../electron/runtime/data-repo/schemas/mail"
import {
  MAIL_MAX_ATTACHMENT_BYTES,
  MAIL_MAX_BODY_BYTES,
  MAIL_SCHEDULED_GRACE_MS,
  MAIL_SCHEDULED_MAX_AHEAD_YEARS,
  MAIL_SCHEDULED_MIN_LEAD_MS,
  MAIL_SCHEDULED_RETRY_MS,
  MAIL_SCHEDULED_TIMER_MAX_MS,
} from "../shared/limits"
import { MAIL_INPUT_SCHEMAS, receiptSchema, scheduledDetailSchema, scheduledSummarySchema } from "../shared/schema"
import {
  MailError,
  type Draft,
  type MailAsset,
  type MailContext,
  type MailInputs,
  type MailResults,
  type ScheduledAction,
  type ScheduledSendDetail,
  type ScheduledSendState,
  type ScheduledSendSummary,
  type SendReceipt,
} from "../shared/types"
import type { MailChanged } from "../shared/private-schema"
import { MailRepository } from "./repository"
import { MailAccounts } from "./accounts"
import { MailAssets } from "./assets"
import { MailDrafts, type StoredDraft } from "./drafts"
import { compileDraftMime } from "./mime-compose"
import { providerPolicy } from "./protocol/aliyun-policy"
import { normalizeProtocolError } from "./protocol/types"
import {
  MailSend,
  connectionFingerprint,
  mailHash,
  mimeFingerprint,
  sendOperationId,
  type SendSnapshot,
  type StoredPreview,
  type StoredSend,
} from "./send"

export interface ScheduledPayload extends Record<string, unknown> {
  draft: Omit<Draft, "html" | "text">
  bodyRef: string
  attachments: MailAsset[]
  headers: { inReplyTo: string | null; references: string[] }
  from: string
  envelope: string[]
  messageId: string
  accountFingerprint: string
  serverSavesSent: boolean
  signature: string
}

export interface StoredScheduled extends Record<string, unknown> {
  kind: "scheduled"
  state: ScheduledSendState
  sendAt: string
  graceMs: number
  payload: ScheduledPayload
  pinnedAssetIds: string[]
  operationId: string | null
  errorCode: string | null
  nextAttemptAt: string | null
  createdAt: string
  updatedAt: string
  sentAt: string | null
}

interface ScheduledKey extends Record<string, unknown> {
  kind: "scheduled-key"
  scheduledId: string
  signature: string
}

export interface MailSchedulerHooks {
  changed(event: MailChanged): void
  draftRestored(ctx: MailContext, draftId: string): void
  notify(ctx: MailContext, input: { accountId: string; scheduledId: string; subject: string; kind: "sent" | "missed" | "failed" | "unknown" }): Promise<void>
  diagnostic(code: string, accountId: string): void
  context(actor: MailContext["actor"]): MailContext
  scoped(ctx: MailContext, accountId: string): MailContext
}

const MUTABLE_STATES = new Set<ScheduledSendState>(["pending", "missed", "failed"])
const TRANSIENT_PRE_SUBMIT_CODES = new Set(["NETWORK_ERROR", "CONNECTION_TIMEOUT", "CONNECT_TIMEOUT", "TIMEOUT", "DNS_ERROR", "OFFLINE", "TEMP_UNAVAILABLE", "PROTOCOL_ERROR"])
const MAX_AHEAD_MS = Math.round(MAIL_SCHEDULED_MAX_AHEAD_YEARS * 365.25 * 24 * 60 * 60_000)

export function normalizeScheduledSendAt(sendAt: string, nowMs = Date.now()): string {
  const targetMs = Date.parse(sendAt)
  if (!Number.isFinite(targetMs)) throw new MailError("INVALID_SCHEDULE_TIME", "定时发送时间格式无效")
  if (targetMs < nowMs + MAIL_SCHEDULED_MIN_LEAD_MS) throw new MailError("INVALID_SCHEDULE_TIME", "定时发送时间必须晚于当前时间")
  if (targetMs > nowMs + MAX_AHEAD_MS) throw new MailError("INVALID_SCHEDULE_TIME", `定时发送时间不能超过 ${MAIL_SCHEDULED_MAX_AHEAD_YEARS} 年`)
  return new Date(targetMs).toISOString()
}

export class MailScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined
  private tickTask: Promise<void> | null = null
  private suspended = false

  constructor(
    private readonly repo: MailRepository,
    private readonly accounts: MailAccounts,
    private readonly assets: MailAssets,
    private readonly drafts: MailDrafts,
    private readonly send: MailSend,
    private readonly hooks: MailSchedulerHooks,
  ) {}

  private stored(ctx: MailContext, id: string): Promise<MailRecord<StoredScheduled>> {
    return this.repo.get<StoredScheduled>(ctx, "scheduled", id).then(row => {
      if (row.data.kind !== "scheduled") throw new MailError("UNAVAILABLE", "定时邮件不存在")
      return row
    })
  }

  private toSummary(row: MailRecord<StoredScheduled>): ScheduledSendSummary {
    const d = row.data, p = d.payload
    return scheduledSummarySchema.parse({
      id: row.id,
      accountId: row.accountId,
      draftId: p.draft.id,
      revision: row.revision,
      state: d.state,
      sendAt: d.sendAt,
      graceMs: d.graceMs,
      from: { address: p.from },
      to: p.draft.to,
      cc: p.draft.cc,
      bcc: p.draft.bcc,
      subject: p.draft.subject,
      attachmentCount: p.draft.assetIds.length,
      messageId: p.messageId,
      operationId: d.operationId,
      errorCode: d.errorCode,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      sentAt: d.sentAt,
    })
  }

  private async toDetail(ctx: MailContext, row: MailRecord<StoredScheduled>): Promise<ScheduledSendDetail> {
    const summary = this.toSummary(row)
    let receipt: SendReceipt | null = null
    if (row.data.operationId) {
      const op = await this.repo.find<StoredSend>(ctx, "operations", row.data.operationId)
      if (op?.data.kind === "send") receipt = receiptSchema.parse(op.data.receipt)
    }
    return scheduledDetailSchema.parse({
      ...summary,
      attachments: row.data.payload.attachments,
      bodyRef: row.data.payload.bodyRef,
      receipt,
    })
  }

  private emitChanged(ctx: MailContext, accountId: string, id: string, revision: number): void {
    this.hooks.changed({ ownerId: ctx.ownerId, generation: ctx.generation, accountId, ids: [id], revision })
  }

  private clearTimer(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined }
  }

  async rearm(ctx: MailContext): Promise<void> {
    this.clearTimer()
    if (this.suspended || ctx.signal.aborted) return
    let minDueMs = Number.POSITIVE_INFINITY
    let cursor: string | undefined
    do {
      const page = await this.repo.page<StoredScheduled>(ctx, "scheduled", { cursor, limit: 100 })
      for (const row of page.items) {
        if (row.data.kind !== "scheduled" || row.data.state !== "pending") continue
        const dueMs = Math.max(Date.parse(row.data.sendAt), row.data.nextAttemptAt ? Date.parse(row.data.nextAttemptAt) : 0)
        if (Number.isFinite(dueMs) && dueMs < minDueMs) minDueMs = dueMs
      }
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    if (!Number.isFinite(minDueMs) || this.suspended || ctx.signal.aborted) return
    const delay = Math.min(Math.max(0, minDueMs - Date.now()), MAIL_SCHEDULED_TIMER_MAX_MS)
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.suspended || ctx.signal.aborted) return
      void this.tick(this.hooks.context("sync")).catch(() => {
        if (!ctx.signal.aborted) this.hooks.diagnostic("MAIL_SCHEDULED_TICK_FAILED", "mail")
      })
    }, delay)
    this.timer.unref?.()
  }

  async create(ctx: MailContext, input: MailInputs["scheduled.create"]): Promise<ScheduledSendDetail> {
    const params = MAIL_INPUT_SCHEMAS["scheduled.create"].parse(input)
    const preview = await this.repo.get<StoredPreview>(ctx, "previews", params.previewId)
    const detail = await this.accounts.exclusive(ctx, preview.accountId, async () => {
      const snapshot = preview.data.snapshot
      const keyId = `request:${mailHash(`${ctx.ownerId}:${preview.accountId}:${params.clientRequestId}`)}`
      const existingKey = await this.repo.find<ScheduledKey>(ctx, "scheduled", keyId)
      if (existingKey) {
        if (existingKey.data.kind !== "scheduled-key" || existingKey.data.signature !== snapshot.signature) {
          throw new MailError("IDEMPOTENCY_CONFLICT", "此请求标识已用于其他定时邮件")
        }
        const existing = await this.stored(ctx, existingKey.data.scheduledId)
        return this.toDetail(ctx, existing)
      }
      const sendAt = normalizeScheduledSendAt(params.sendAt)
      await this.send.validateSnapshot(ctx, snapshot)
      const draftRow = await this.drafts.stored(ctx, snapshot.draft.id)
      const nowIso = new Date().toISOString()
      const scheduledId = `ms_${randomUUID()}`
      const refs = [...new Set([snapshot.bodyRef, ...snapshot.attachments.map(asset => asset.id)])]
      const added: string[] = []
      const payload: ScheduledPayload = {
        draft: snapshot.draft,
        bodyRef: snapshot.bodyRef,
        attachments: snapshot.attachments,
        headers: draftRow.data.headers,
        from: snapshot.from,
        envelope: snapshot.envelope,
        messageId: snapshot.messageId,
        accountFingerprint: snapshot.accountFingerprint,
        serverSavesSent: snapshot.serverSavesSent,
        signature: snapshot.signature,
      }
      const data: StoredScheduled = {
        kind: "scheduled",
        state: "pending",
        sendAt,
        graceMs: MAIL_SCHEDULED_GRACE_MS,
        payload,
        pinnedAssetIds: refs,
        operationId: null,
        errorCode: null,
        nextAttemptAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
        sentAt: null,
      }
      const record: MailRecord<StoredScheduled> = {
        id: scheduledId,
        schemaVersion: 1,
        ownerId: ctx.ownerId,
        accountId: preview.accountId,
        revision: 1,
        sortKey: `${sendAt}:${scheduledId}`,
        data,
      }
      const keyRecord: MailRecord<ScheduledKey> = {
        id: keyId,
        schemaVersion: 1,
        ownerId: ctx.ownerId,
        accountId: preview.accountId,
        revision: 1,
        sortKey: `~request:${keyId}`,
        data: { kind: "scheduled-key", scheduledId, signature: snapshot.signature },
      }
      const updatedDraft: MailRecord<StoredDraft> = {
        ...draftRow,
        revision: draftRow.revision + 1,
        data: { ...draftRow.data, state: "scheduled", updatedAt: nowIso },
      }
      const { id: _did, ...draftPatch } = updatedDraft
      try {
        for (const id of refs) { await this.assets.pin(ctx, id, 1); added.push(id) }
        const committed = await this.repo.storage.commitBatch!({
          guards: [{ namespace: "app.mail.drafts", id: draftRow.id, expected: { ownerId: ctx.ownerId, revision: draftRow.revision } }],
          operations: [
            { kind: "insert", namespace: "app.mail.scheduled", id: scheduledId, value: record },
            { kind: "insert", namespace: "app.mail.scheduled", id: keyId, value: keyRecord },
            { kind: "patch", namespace: "app.mail.drafts", id: draftRow.id, patch: draftPatch },
          ],
        })
        this.accounts.context.assertCurrent(ctx)
        if (!committed.committed) throw new MailError("VERSION_CONFLICT", "草稿状态已变化，请重新预览")
      } catch (error) {
        if (!ctx.signal.aborted) for (const id of added) await this.assets.pin(ctx, id, -1)
        throw error
      }
      this.drafts.notify(ctx, draftRow.id)
      this.emitChanged(ctx, preview.accountId, scheduledId, 1)
      return this.toDetail(ctx, record)
    })
    await this.rearm(ctx)
    return detail
  }

  async list(ctx: MailContext, input: MailInputs["scheduled.list"]): Promise<MailResults["scheduled.list"]> {
    const params = MAIL_INPUT_SCHEMAS["scheduled.list"].parse(input)
    await this.repo.get(ctx, "accounts", params.accountId)
    const items: ScheduledSendSummary[] = []
    let cursor = params.cursor
    do {
      const page = await this.repo.page<StoredScheduled>(ctx, "scheduled", {
        accountId: params.accountId,
        cursor,
        limit: params.limit - items.length,
        binding: params.state ?? "all-scheduled",
      })
      for (const row of page.items) {
        if (row.data.kind !== "scheduled") continue
        if (params.state && row.data.state !== params.state) continue
        items.push(this.toSummary(row))
      }
      cursor = page.nextCursor ?? undefined
      if (!cursor) break
    } while (items.length < params.limit)
    return { items, nextCursor: cursor ?? null }
  }

  async get(ctx: MailContext, input: MailInputs["scheduled.get"]): Promise<ScheduledSendDetail> {
    const params = MAIL_INPUT_SCHEMAS["scheduled.get"].parse(input)
    const row = await this.stored(ctx, params.scheduledId)
    return this.toDetail(ctx, row)
  }

  async readBody(ctx: MailContext, scheduledId: string): Promise<{ html: string; text: string }> {
    const row = await this.stored(ctx, scheduledId)
    const bytes = await this.assets.read(ctx, row.data.payload.bodyRef, MAIL_MAX_BODY_BYTES)
    const parsed = JSON.parse(bytes.toString("utf8")) as { html?: unknown; text?: unknown }
    if (typeof parsed.html !== "string" || typeof parsed.text !== "string") throw new MailError("ASSET_UNAVAILABLE", "定时邮件正文不可用")
    return { html: parsed.html, text: parsed.text }
  }

  async reschedule(ctx: MailContext, input: MailInputs["scheduled.update"]): Promise<ScheduledSendDetail> {
    const params = MAIL_INPUT_SCHEMAS["scheduled.update"].parse(input)
    const initial = await this.stored(ctx, params.scheduledId)
    const detail = await this.accounts.exclusive(ctx, initial.accountId, async () => {
      const row = await this.stored(ctx, params.scheduledId)
      if (row.revision !== params.expectedRevision) throw new MailError("VERSION_CONFLICT", "定时邮件已变化，请刷新后重试")
      if (!MUTABLE_STATES.has(row.data.state)) throw new MailError("INVALID_STATE", "当前状态不支持修改发送时间")
      const sendAt = normalizeScheduledSendAt(params.sendAt)
      const nowIso = new Date().toISOString()
      const saved = await this.repo.save<StoredScheduled>(
        ctx,
        "scheduled",
        row.id,
        row.accountId,
        { ...row.data, state: "pending", sendAt, errorCode: null, nextAttemptAt: null, updatedAt: nowIso },
        row.revision,
        `${sendAt}:${row.id}`,
      )
      this.emitChanged(ctx, row.accountId, row.id, saved.revision)
      return this.toDetail(ctx, saved)
    })
    await this.rearm(ctx)
    return detail
  }

  async cancel(ctx: MailContext, input: MailInputs["scheduled.cancel"]): Promise<ScheduledSendDetail> {
    const params = MAIL_INPUT_SCHEMAS["scheduled.cancel"].parse(input)
    const initial = await this.stored(ctx, params.scheduledId)
    const detail = await this.accounts.exclusive(ctx, initial.accountId, async () => {
      const row = await this.stored(ctx, params.scheduledId)
      if (row.revision !== params.expectedRevision) throw new MailError("VERSION_CONFLICT", "定时邮件已变化，请刷新后重试")
      if (!MUTABLE_STATES.has(row.data.state)) throw new MailError("INVALID_STATE", "当前状态不支持取消定时")
      const nowIso = new Date().toISOString()
      const oldPins = row.data.pinnedAssetIds
      const nextScheduled: MailRecord<StoredScheduled> = {
        ...row,
        revision: row.revision + 1,
        data: { ...row.data, state: "cancelled", pinnedAssetIds: [], nextAttemptAt: null, updatedAt: nowIso },
      }
      const { id: _sid, ...scheduledPatch } = nextScheduled
      const guards = [{ namespace: "app.mail.scheduled", id: row.id, expected: { ownerId: ctx.ownerId, revision: row.revision } }]
      const operations: { kind: "patch"; namespace: string; id: string; patch: Record<string, unknown> }[] = [
        { kind: "patch", namespace: "app.mail.scheduled", id: row.id, patch: scheduledPatch },
      ]
      let restoredDraftId: string | null = null
      if (params.restoreDraft) {
        const draft = await this.repo.find<StoredDraft>(ctx, "drafts", row.data.payload.draft.id)
        if (draft && draft.data.state === "scheduled") {
          const nextDraft: MailRecord<StoredDraft> = {
            ...draft,
            revision: draft.revision + 1,
            data: { ...draft.data, state: "editing", syncState: "pending", updatedAt: nowIso },
          }
          const { id: _did, ...draftPatch } = nextDraft
          guards.push({ namespace: "app.mail.drafts", id: draft.id, expected: { ownerId: ctx.ownerId, revision: draft.revision } })
          operations.push({ kind: "patch", namespace: "app.mail.drafts", id: draft.id, patch: draftPatch })
          restoredDraftId = draft.id
        }
      }
      const committed = await this.repo.storage.commitBatch!({ guards, operations })
      this.accounts.context.assertCurrent(ctx)
      if (!committed.committed) throw new MailError("VERSION_CONFLICT", "取消定时冲突，请刷新后重试")
      for (const id of oldPins) await this.assets.pin(ctx, id, -1)
      if (restoredDraftId) {
        this.drafts.notify(ctx, restoredDraftId)
        this.hooks.draftRestored(ctx, restoredDraftId)
      }
      this.emitChanged(ctx, row.accountId, row.id, nextScheduled.revision)
      return this.toDetail(ctx, nextScheduled)
    })
    await this.rearm(ctx)
    return detail
  }

  async sendNow(ctx: MailContext, input: MailInputs["scheduled.send"]): Promise<SendReceipt> {
    const params = MAIL_INPUT_SCHEMAS["scheduled.send"].parse(input)
    const initial = await this.stored(ctx, params.scheduledId)
    const receipt = await this.accounts.exclusive(ctx, initial.accountId, async () => {
      const row = await this.stored(ctx, params.scheduledId)
      if (row.revision !== params.expectedRevision) throw new MailError("VERSION_CONFLICT", "定时邮件已变化，请刷新后重试")
      if (row.data.state === "unknown") throw new MailError("SEND_OUTCOME_UNKNOWN", "此邮件发送结果待核验，请先核验已发送副本，避免重复发送")
      if (!MUTABLE_STATES.has(row.data.state)) throw new MailError("INVALID_STATE", "当前状态不支持立即发送")
      const result = await this.dispatchLocked(ctx, row.id, { manual: true })
      if (!result) throw new MailError("MAIL_FAILED", "定时邮件发送未完成，请刷新状态")
      return result
    })
    await this.rearm(ctx)
    return receipt
  }

  private async compileFreshSnapshotLocked(ctx: MailContext, row: MailRecord<StoredScheduled>, sentAt: string): Promise<{ snapshot: SendSnapshot; generatedAssetIds: string[] }> {
    const p = row.data.payload
    const account = await this.accounts.get(ctx, row.accountId)
    if (connectionFingerprint(account) !== p.accountFingerprint || account.email !== p.from) {
      throw new MailError("ACCOUNT_CHANGED", "邮箱配置已变化，未向其他服务器发送")
    }
    const bodyBytes = await this.assets.read(ctx, p.bodyRef, MAIL_MAX_BODY_BYTES)
    const parsedBody = JSON.parse(bodyBytes.toString("utf8")) as { html?: unknown; text?: unknown }
    if (typeof parsedBody.html !== "string" || typeof parsedBody.text !== "string") {
      throw new MailError("ASSET_UNAVAILABLE", "定时邮件正文不可用")
    }
    for (const attachment of p.attachments) {
      const current = await this.assets.info(ctx, attachment.id)
      if (current.accountId !== row.accountId || current.state !== "ready" || current.sha256 !== attachment.sha256 || mailHash(await this.assets.read(ctx, current.id)) !== attachment.sha256) {
        throw new MailError("ASSET_CHANGED", "定时邮件附件已变化或不可用")
      }
    }
    const fullDraft: Draft = { ...p.draft, html: parsedBody.html, text: parsedBody.text }
    const headers = { from: p.from, messageId: p.messageId, date: sentAt, inReplyTo: p.headers.inReplyTo, references: p.headers.references }
    const generatedAssetIds: string[] = []
    try {
      const mime = await compileDraftMime(ctx, fullDraft, this.assets, { ...headers, keepBcc: false })
      const raw = await this.assets.put(ctx, Readable.from([mime.raw]), { accountId: row.accountId, name: "scheduled-send.eml", mime: "message/rfc822", pinned: true }, MAIL_MAX_ATTACHMENT_BYTES)
      generatedAssetIds.push(raw.id)
      const serverSavesSent = providerPolicy(account).serverSavesSent
      const sentRaw = serverSavesSent
        ? raw
        : await this.assets.put(ctx, Readable.from([(await compileDraftMime(ctx, fullDraft, this.assets, { ...headers, keepBcc: true })).raw]), { accountId: row.accountId, name: "scheduled-sent.eml", mime: "message/rfc822", pinned: true }, MAIL_MAX_ATTACHMENT_BYTES)
      if (sentRaw.id !== raw.id) generatedAssetIds.push(sentRaw.id)
      const snapshot: SendSnapshot = {
        draft: p.draft,
        bodyRef: p.bodyRef,
        rawAssetId: raw.id,
        rawHash: raw.sha256!,
        rawSize: raw.size,
        sentRawAssetId: sentRaw.id,
        sentRawHash: sentRaw.sha256!,
        from: p.from,
        envelope: p.envelope,
        messageId: p.messageId,
        createdAt: sentAt,
        expiresAt: new Date(Date.parse(sentAt) + 60_000).toISOString(),
        attachments: p.attachments,
        fingerprint: await mimeFingerprint(ctx, mime.raw),
        accountFingerprint: p.accountFingerprint,
        serverSavesSent,
        signature: p.signature,
      }
      return { snapshot, generatedAssetIds }
    } catch (error) {
      if (!ctx.signal.aborted) for (const id of generatedAssetIds) await this.assets.pin(ctx, id, -1)
      throw error
    }
  }

  private async dispatchLocked(ctx: MailContext, scheduledId: string, options: { manual: boolean }): Promise<SendReceipt | null> {
    let row = await this.stored(ctx, scheduledId)
    if (!options.manual && row.data.state !== "pending") return null
    if (options.manual && !MUTABLE_STATES.has(row.data.state)) return null

    const nowMs = Date.now(), nowIso = new Date(nowMs).toISOString()
    if (!options.manual) {
      const overdueMs = nowMs - Date.parse(row.data.sendAt)
      if (overdueMs < 0) return null
      if (overdueMs > row.data.graceMs) {
        row = await this.repo.save<StoredScheduled>(ctx, "scheduled", row.id, row.accountId, { ...row.data, state: "missed", errorCode: "SCHEDULE_MISSED", nextAttemptAt: null, updatedAt: nowIso }, row.revision, row.sortKey)
        this.emitChanged(ctx, row.accountId, row.id, row.revision)
        await this.hooks.notify(ctx, { accountId: row.accountId, scheduledId: row.id, subject: row.data.payload.draft.subject, kind: "missed" })
        return null
      }
      const account = await this.accounts.get(ctx, row.accountId)
      if (account.paused) {
        row = await this.repo.save<StoredScheduled>(ctx, "scheduled", row.id, row.accountId, { ...row.data, state: "missed", errorCode: "ACCOUNT_PAUSED", nextAttemptAt: null, updatedAt: nowIso }, row.revision, row.sortKey)
        this.emitChanged(ctx, row.accountId, row.id, row.revision)
        await this.hooks.notify(ctx, { accountId: row.accountId, scheduledId: row.id, subject: row.data.payload.draft.subject, kind: "missed" })
        return null
      }
    }

    const opId = sendOperationId(`scheduled:${ctx.ownerId}:${row.accountId}:${row.id}:${row.revision}`)
    row = await this.repo.save<StoredScheduled>(
      ctx,
      "scheduled",
      row.id,
      row.accountId,
      { ...row.data, state: "sending", operationId: opId, errorCode: null, nextAttemptAt: null, updatedAt: nowIso },
      row.revision,
      row.sortKey,
    )
    this.emitChanged(ctx, row.accountId, row.id, row.revision)

    let compiled: { snapshot: SendSnapshot; generatedAssetIds: string[] }
    try {
      compiled = await this.compileFreshSnapshotLocked(ctx, row, nowIso)
    } catch (error) {
      if (ctx.signal.aborted) throw error
      const normalized = normalizeProtocolError(error)
      row = await this.repo.save<StoredScheduled>(
        ctx,
        "scheduled",
        row.id,
        row.accountId,
        { ...row.data, state: "failed", operationId: null, errorCode: normalized.code, nextAttemptAt: null, updatedAt: new Date().toISOString() },
        row.revision,
        row.sortKey,
      )
      this.emitChanged(ctx, row.accountId, row.id, row.revision)
      if (!options.manual) await this.hooks.notify(ctx, { accountId: row.accountId, scheduledId: row.id, subject: row.data.payload.draft.subject, kind: "failed" })
      if (options.manual) throw error
      return null
    }

    let receipt: SendReceipt
    try {
      receipt = await this.send.submitPreparedLocked(ctx, { accountId: row.accountId, operationId: opId, snapshot: compiled.snapshot })
    } finally {
      if (!ctx.signal.aborted) for (const id of compiled.generatedAssetIds) await this.assets.pin(ctx, id, -1)
    }

    const finishedIso = new Date().toISOString()
    if (receipt.state === "accepted" || receipt.state === "partial") {
      const oldPins = row.data.pinnedAssetIds
      row = await this.repo.save<StoredScheduled>(
        ctx,
        "scheduled",
        row.id,
        row.accountId,
        { ...row.data, state: "sent", pinnedAssetIds: [], operationId: receipt.operationId, errorCode: receipt.errorCode, nextAttemptAt: null, updatedAt: finishedIso, sentAt: finishedIso },
        row.revision,
        row.sortKey,
      )
      for (const id of oldPins) await this.assets.pin(ctx, id, -1)
      this.emitChanged(ctx, row.accountId, row.id, row.revision)
      await this.hooks.notify(ctx, { accountId: row.accountId, scheduledId: row.id, subject: row.data.payload.draft.subject, kind: "sent" })
      return receipt
    }

    if (receipt.state === "unknown") {
      row = await this.repo.save<StoredScheduled>(
        ctx,
        "scheduled",
        row.id,
        row.accountId,
        { ...row.data, state: "unknown", operationId: receipt.operationId, errorCode: receipt.errorCode, nextAttemptAt: null, updatedAt: finishedIso },
        row.revision,
        row.sortKey,
      )
      this.emitChanged(ctx, row.accountId, row.id, row.revision)
      await this.hooks.notify(ctx, { accountId: row.accountId, scheduledId: row.id, subject: row.data.payload.draft.subject, kind: "unknown" })
      return receipt
    }

    const afterMs = Date.now()
    const withinGraceForRetry = !options.manual
      && !!receipt.errorCode
      && TRANSIENT_PRE_SUBMIT_CODES.has(receipt.errorCode)
      && (afterMs - Date.parse(row.data.sendAt) + MAIL_SCHEDULED_RETRY_MS <= row.data.graceMs)

    if (withinGraceForRetry) {
      row = await this.repo.save<StoredScheduled>(
        ctx,
        "scheduled",
        row.id,
        row.accountId,
        { ...row.data, state: "pending", operationId: null, errorCode: receipt.errorCode, nextAttemptAt: new Date(afterMs + MAIL_SCHEDULED_RETRY_MS).toISOString(), updatedAt: finishedIso },
        row.revision,
        row.sortKey,
      )
      this.emitChanged(ctx, row.accountId, row.id, row.revision)
      return receipt
    }

    const missed = !options.manual && (afterMs - Date.parse(row.data.sendAt) > row.data.graceMs)
    const nextState: ScheduledSendState = missed ? "missed" : "failed"
    row = await this.repo.save<StoredScheduled>(
      ctx,
      "scheduled",
      row.id,
      row.accountId,
      { ...row.data, state: nextState, operationId: receipt.operationId, errorCode: receipt.errorCode ?? (missed ? "SCHEDULE_MISSED" : "MAIL_FAILED"), nextAttemptAt: null, updatedAt: finishedIso },
      row.revision,
      row.sortKey,
    )
    this.emitChanged(ctx, row.accountId, row.id, row.revision)
    if (!options.manual) await this.hooks.notify(ctx, { accountId: row.accountId, scheduledId: row.id, subject: row.data.payload.draft.subject, kind: nextState })
    return receipt
  }

  async recover(ctx: MailContext): Promise<void> {
    let cursor: string | undefined
    do {
      const page = await this.repo.page<StoredScheduled>(ctx, "scheduled", { cursor, limit: 100 })
      for (const item of page.items) {
        if (item.data.kind !== "scheduled" || item.data.state !== "sending") continue
        const scoped = this.hooks.scoped(ctx, item.accountId)
        await this.accounts.exclusive(scoped, item.accountId, async () => {
          const row = await this.stored(scoped, item.id)
          if (row.data.state !== "sending") return
          const nowIso = new Date().toISOString()
          const op = row.data.operationId ? await this.repo.find<StoredSend>(scoped, "operations", row.data.operationId) : null
          if (op?.data.kind === "send") {
            const state = op.data.state
            if (state === "accepted" || state === "partial") {
              const oldPins = row.data.pinnedAssetIds
              await this.repo.save<StoredScheduled>(scoped, "scheduled", row.id, row.accountId, { ...row.data, state: "sent", pinnedAssetIds: [], errorCode: op.data.receipt.errorCode, updatedAt: nowIso, sentAt: row.data.sentAt ?? nowIso }, row.revision, row.sortKey)
              for (const id of oldPins) await this.assets.pin(scoped, id, -1)
              return
            }
            if (state === "unknown" || state === "submitting") {
              await this.repo.save<StoredScheduled>(scoped, "scheduled", row.id, row.accountId, { ...row.data, state: "unknown", errorCode: op.data.receipt.errorCode ?? "INTERRUPTED", updatedAt: nowIso }, row.revision, row.sortKey)
              return
            }
            if (state === "failed") {
              await this.repo.save<StoredScheduled>(scoped, "scheduled", row.id, row.accountId, { ...row.data, state: "failed", errorCode: op.data.receipt.errorCode ?? "INTERRUPTED", updatedAt: nowIso }, row.revision, row.sortKey)
              return
            }
          }
          // Crashed before any operation was submitted to SMTP.
          const overdueMs = Date.now() - Date.parse(row.data.sendAt)
          const nextState: ScheduledSendState = overdueMs > row.data.graceMs ? "missed" : "pending"
          await this.repo.save<StoredScheduled>(
            scoped,
            "scheduled",
            row.id,
            row.accountId,
            { ...row.data, state: nextState, operationId: null, errorCode: nextState === "missed" ? "SCHEDULE_MISSED" : null, nextAttemptAt: null, updatedAt: nowIso },
            row.revision,
            row.sortKey,
          )
        })
      }
      cursor = page.nextCursor ?? undefined
    } while (cursor)
  }

  async tick(ctx: MailContext): Promise<void> {
    if (this.suspended || ctx.signal.aborted) return
    if (this.tickTask) return this.tickTask
    this.tickTask = (async () => {
      try {
        const due: { id: string; accountId: string }[] = []
        const nowMs = Date.now()
        let cursor: string | undefined
        do {
          const page = await this.repo.page<StoredScheduled>(ctx, "scheduled", { cursor, limit: 100 })
          for (const row of page.items) {
            if (row.data.kind !== "scheduled" || row.data.state !== "pending") continue
            const dueMs = Math.max(Date.parse(row.data.sendAt), row.data.nextAttemptAt ? Date.parse(row.data.nextAttemptAt) : 0)
            if (Number.isFinite(dueMs) && dueMs <= nowMs) due.push({ id: row.id, accountId: row.accountId })
          }
          cursor = page.nextCursor ?? undefined
        } while (cursor)

        for (const item of due) {
          if (this.suspended || ctx.signal.aborted) break
          const scoped = this.hooks.scoped(ctx, item.accountId)
          try {
            await this.accounts.exclusive(scoped, item.accountId, () => this.dispatchLocked(scoped, item.id, { manual: false }))
          } catch {
            if (!scoped.signal.aborted) this.hooks.diagnostic("MAIL_SCHEDULED_DISPATCH_FAILED", item.accountId)
          }
        }
      } finally {
        this.tickTask = null
        if (!this.suspended && !ctx.signal.aborted) await this.rearm(ctx)
      }
    })()
    return this.tickTask
  }

  async start(ctx: MailContext): Promise<void> {
    this.suspended = false
    await this.tick(ctx)
  }

  async suspend(): Promise<void> {
    this.suspended = true
    this.clearTimer()
    await this.tickTask
  }

  resume(ctx: MailContext, delayMs = 0): void {
    this.suspended = false
    this.clearTimer()
    if (ctx.signal.aborted) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.suspended || ctx.signal.aborted) return
      void this.tick(this.hooks.context("sync")).catch(() => {
        if (!ctx.signal.aborted) this.hooks.diagnostic("MAIL_SCHEDULED_RESUME_FAILED", "mail")
      })
    }, Math.max(0, delayMs))
    this.timer.unref?.()
  }

  async dispose(): Promise<void> {
    this.suspended = true
    this.clearTimer()
    await this.tickTask
  }

  execute<K extends ScheduledAction>(ctx: MailContext, action: K, input: MailInputs[K]): Promise<MailResults[K]> {
    switch (action) {
      case "scheduled.create": return this.create(ctx, input as MailInputs["scheduled.create"]) as Promise<MailResults[K]>
      case "scheduled.list": return this.list(ctx, input as MailInputs["scheduled.list"]) as Promise<MailResults[K]>
      case "scheduled.get": return this.get(ctx, input as MailInputs["scheduled.get"]) as Promise<MailResults[K]>
      case "scheduled.update": return this.reschedule(ctx, input as MailInputs["scheduled.update"]) as Promise<MailResults[K]>
      case "scheduled.cancel": return this.cancel(ctx, input as MailInputs["scheduled.cancel"]) as Promise<MailResults[K]>
      case "scheduled.send": return this.sendNow(ctx, input as MailInputs["scheduled.send"]) as Promise<MailResults[K]>
    }
  }
}
