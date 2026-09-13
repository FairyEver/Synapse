import { AGENT_HISTORY_APPEND_ATTEMPTS, AGENT_HISTORY_PREVIEW_UNITS } from "../../../config"
import { createHash, randomUUID } from "node:crypto"
import type { AtomicBatchRequest, DataRepository } from "../../runtime/data-repo/types"
import {
  historySummaryNamespace, historyRecordNamespace, historyReceiptNamespace, historyContentNamespace, historyTurnNamespace,
  historyRevisionNamespace,
  type ConversationSummaryV2, type HistoryRecord, type HistoryAppendReceipt, type HistoryTurnIndex,
  type HistoryRecordRevision,
} from "../../runtime/data-repo/schemas/agent-history"
import { HistoryContentStore, commitHistoryBatch, queryHistoryRange, scopedRecordId, type HistoryScope } from "./history-content-store"

export interface AppendHistoryRecord extends HistoryScope {
  readonly operationId: string
  readonly turnId: string
  readonly generation: number
  readonly role: HistoryRecord["role"]
  readonly content: string
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly toolUseId?: string
  readonly requestId?: string
  readonly timestamp: string
}
export interface HistorySnapshot { readonly revision: number; readonly highWaterSeq: number; readonly count: number }
async function* textSource(text: string) { yield text }

/** V2 foundation. No legacy Conversation-shaped empty history or automatic storage cutover. */
export class AgentHistoryRepository {
  constructor(private readonly repo: DataRepository, private readonly contents: HistoryContentStore) {}

  getSummary(scope: HistoryScope): Promise<ConversationSummaryV2 | null> {
    return this.repo.namespace<ConversationSummaryV2>(historySummaryNamespace.name).get(scopedRecordId(scope, "summary"))
  }

  async create(scope: HistoryScope, name: string): Promise<ConversationSummaryV2> {
    const now = new Date().toISOString()
    const summary: ConversationSummaryV2 = { ...scope, id: scopedRecordId(scope, "summary"), schemaVersion: 1, storageVersion: 2,
      storageEpoch: randomUUID(), name, historyCount: 0, lastHistorySeq: 0, commitRevision: 0, activeGeneration: 0,
      createdAt: now, updatedAt: now }
    if (!await commitHistoryBatch(this.repo, { guards: [], operations: [
      { kind: "insert", namespace: historySummaryNamespace.name, id: summary.id, value: summary },
    ] })) throw new Error("会话已经存在。")
    return summary
  }

  async append(input: AppendHistoryRecord): Promise<HistoryAppendReceipt> {
    const scope = { projectId: input.projectId, conversationId: input.conversationId }
    const metadata = input.metadata === undefined ? undefined : JSON.stringify(input.metadata)
    const payloadHash = createHash("sha256").update(JSON.stringify([
      input.turnId, input.generation, input.role, input.timestamp, input.toolUseId, input.requestId,
      createHash("sha256").update(input.content).digest("hex"), metadata,
    ])).digest("hex")
    const receiptId = scopedRecordId(scope, `operation:${input.operationId}`)
    const receipts = this.repo.namespace<HistoryAppendReceipt>(historyReceiptNamespace.name)
    const previous = await receipts.get(receiptId)
    if (previous) return this.matchReceipt(previous, payloadHash)
    const initial = await this.requireSummary(scope)
    if (initial.activeGeneration !== input.generation) throw new Error("执行代际已失效。")
    const contentRef = await this.contents.stage(scope, input.turnId, textSource(input.content))
    const staged = [contentRef]
    let attached = false
    let result: HistoryAppendReceipt | undefined
    try {
      const metadataRef = metadata === undefined ? undefined : await this.contents.stage(scope, input.turnId, textSource(metadata))
      if (metadataRef) staged.push(metadataRef)
      for (let attempt = 0; attempt < AGENT_HISTORY_APPEND_ATTEMPTS; attempt += 1) {
        const summary = await this.requireSummary(scope)
        const existing = await receipts.get(receiptId)
        if (existing) { result = this.matchReceipt(existing, payloadHash); break }
        if (summary.activeGeneration !== input.generation) throw new Error("执行代际已失效。")
        const seq = summary.lastHistorySeq + 1
        const revision = summary.commitRevision + 1
        const entryId = scopedRecordId(scope, `entry:${input.operationId}`)
        const record: HistoryRecord = { ...scope, id: entryId, entryId, schemaVersion: 1, seq,
          turnId: input.turnId, generation: input.generation, role: input.role, timestamp: input.timestamp,
          ...(input.toolUseId ? { toolUseId: input.toolUseId } : {}), ...(input.requestId ? { requestId: input.requestId } : {}),
          preview: input.content.slice(0, AGENT_HISTORY_PREVIEW_UNITS).replace(/[\uD800-\uDBFF]$/, ""), contentRef,
          ...(metadataRef ? { metadataRef } : {}), createdRevision: revision }
        const receipt: HistoryAppendReceipt = { ...scope, id: receiptId, schemaVersion: 1,
          operationId: input.operationId, payloadHash, entryId, seq, commitRevision: revision }
        const turnId = scopedRecordId(scope, `turn:${input.turnId}`)
        const turn = await this.repo.namespace<HistoryTurnIndex>(historyTurnNamespace.name).get(turnId)
        const turnValue: HistoryTurnIndex = { ...scope, id: turnId, schemaVersion: 1, turnId: input.turnId,
          firstSeq: turn?.firstSeq ?? seq, lastSeq: seq, projectionBytes: (turn?.projectionBytes ?? 0) + Buffer.byteLength(JSON.stringify(record)) }
        const operations: AtomicBatchRequest["operations"] = [
          { kind: "insert", namespace: historyRecordNamespace.name, id: entryId, value: record },
          { kind: "insert", namespace: historyReceiptNamespace.name, id: receiptId, value: receipt },
          { kind: "patch", namespace: historySummaryNamespace.name, id: summary.id,
            patch: { historyCount: summary.historyCount + 1, lastHistorySeq: seq, commitRevision: revision, updatedAt: input.timestamp } },
          turn ? { kind: "patch", namespace: historyTurnNamespace.name, id: turnId,
            patch: { lastSeq: seq, projectionBytes: turnValue.projectionBytes } }
            : { kind: "insert", namespace: historyTurnNamespace.name, id: turnId, value: turnValue },
          ...[contentRef, ...(metadataRef ? [metadataRef] : [])].map((ref) => ({ kind: "patch" as const,
            namespace: historyContentNamespace.name, id: scopedRecordId(scope, ref.contentId), patch: { state: "committed" } })),
        ]
        if (await commitHistoryBatch(this.repo, { guards: [{ namespace: historySummaryNamespace.name, id: summary.id,
          expected: { commitRevision: summary.commitRevision, activeGeneration: input.generation } }], operations })) { attached = true; result = receipt; break }
      }
      if (!result) throw new Error("历史追加竞争过多，请重试。")
    } catch (error) {
      try { await this.discardStaged(scope, staged) }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], "历史追加及暂存状态更新失败。", { cause: cleanupError }) }
      throw error
    }
    if (!attached) await this.discardStaged(scope, staged)
    return result
  }

  private async discardStaged(scope: HistoryScope, staged: readonly { contentId: string }[]): Promise<void> {
    const results = await Promise.allSettled(staged.map((ref) => this.contents.markOrphan(scope, ref.contentId)))
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === "rejected").map((result) => result.reason)
    if (errors.length) throw new AggregateError(errors, "历史追加后暂存状态更新失败。")
  }

  async page(scope: HistoryScope, options: { readonly beforeSeq?: number; readonly limit?: number; readonly snapshot?: HistorySnapshot } = {}) {
    const summary = await this.requireSummary(scope)
    const snapshot = options.snapshot ?? { revision: summary.commitRevision, highWaterSeq: summary.lastHistorySeq, count: summary.historyCount }
    if (snapshot.revision > summary.commitRevision || snapshot.highWaterSeq > summary.lastHistorySeq) throw new Error("历史快照无效。")
    const limit = options.limit ?? 100
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("历史页大小无效。")
    const entries = await queryHistoryRange(this.repo.namespace<HistoryRecord>(historyRecordNamespace.name), {
      index: "scope_seq", equal: scope, range: { field: "seq", lt: Math.min(options.beforeSeq ?? snapshot.highWaterSeq + 1, snapshot.highWaterSeq + 1) },
      direction: "desc", limit: limit + 1,
    })
    const hasOlder = entries.length > limit
    const page = entries.slice(0, limit).reverse()
    for (let index = 0; index < page.length; index += 1) {
      const entry = page[index]
      const [revision] = await queryHistoryRange(this.repo.namespace<HistoryRecordRevision>(historyRevisionNamespace.name), {
        index: "scope_entry_revision", equal: { ...scope, entryId: entry.entryId }, range: { field: "revision", lte: snapshot.revision }, direction: "desc", limit: 1,
      })
      if (revision) page[index] = { ...entry, metadataRef: revision.metadataRef }
    }
    return { entries: page, snapshot, hasOlder, beforeSeq: hasOlder ? page[0].seq : null }
  }

  private async requireSummary(scope: HistoryScope): Promise<ConversationSummaryV2> {
    const summary = await this.getSummary(scope)
    if (!summary) throw new Error("会话不存在。")
    return summary
  }

  private matchReceipt(receipt: HistoryAppendReceipt, payloadHash: string): HistoryAppendReceipt {
    if (receipt.payloadHash !== payloadHash) throw new Error("重复操作的内容不一致。")
    return receipt
  }
}
