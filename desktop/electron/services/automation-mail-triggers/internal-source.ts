import { createHash } from "node:crypto"
import { z } from "zod"
import type { MailReceiptPage, MailReceiptRef, MailReceiptSource, MailSourceBoundary, MailTriggerContext, PreparedMailPayload } from "./types"

const seq = z.string().regex(/^\d{1,19}$/u)
const checkpoint = z.object({ receiptSequence: seq, serverTime: z.iso.datetime() })
const changes = z.object({ items: z.array(z.object({ messageId: z.string().min(1), receiptSequence: seq, sentAt: z.iso.datetime() })).max(50), nextAfter: seq, through: seq, complete: z.boolean() })
export type InternalReceiptQuery = { after: string; through?: string; limit: number }
export type InternalReceiptCheckpoint = z.infer<typeof checkpoint>
export type InternalReceiptChanges = z.infer<typeof changes>
export interface InternalMailSourceDeps {
  assertCurrent(context: MailTriggerContext): void
  checkpoint(context: MailTriggerContext): Promise<InternalReceiptCheckpoint>
  changes(context: MailTriggerContext, input: InternalReceiptQuery): Promise<InternalReceiptChanges>
  read(context: MailTriggerContext, messageId: string): Promise<PreparedMailPayload>
}
export class InternalMailReceiptSource implements MailReceiptSource {
  constructor(private readonly deps: InternalMailSourceDeps) {}
  private assert(context: MailTriggerContext) { context.signal.throwIfAborted(); this.deps.assertCurrent(context) }
  async prepare(context: MailTriggerContext): Promise<MailSourceBoundary[]> {
    this.assert(context)
    const result = checkpoint.parse(await this.deps.checkpoint(context)); this.assert(context)
    const sourceKey = createHash("sha256").update(JSON.stringify(["mail-internal", context.identity])).digest("hex")
    return [{ kind: "mail-internal", sourceKey, ...result }]
  }
  async scan(context: MailTriggerContext, boundary: MailSourceBoundary, cursor: string, limit: number): Promise<MailReceiptPage> {
    this.assert(context)
    if (boundary.kind !== "mail-internal") throw new Error("收信来源类型不匹配")
    const position = cursor.startsWith("{") ? z.object({ after: seq, through: seq }).strict().parse(JSON.parse(cursor)) : { after: seq.parse(cursor) }
    const result = changes.parse(await this.deps.changes(context, { ...position, limit })); this.assert(context)
    if (BigInt(result.nextAfter) < BigInt(position.after) || BigInt(result.nextAfter) > BigInt(result.through)
      || ("through" in position && position.through !== result.through)) throw new Error("收信分页边界无效")
    return { receipts: result.items.map(item => ({ sourceKey: boundary.sourceKey, receiptKey: `mail-internal:${item.messageId}`, messageId: item.messageId, receivedAt: item.sentAt, sequence: item.receiptSequence })),
      nextCursor: result.complete ? result.nextAfter : JSON.stringify({ after: result.nextAfter, through: result.through }), complete: result.complete }
  }
  async hydrate(context: MailTriggerContext, receipt: MailReceiptRef): Promise<PreparedMailPayload> {
    this.assert(context)
    if (!receipt.messageId) throw new Error("站内信引用无效")
    const payload = await this.deps.read(context, receipt.messageId); this.assert(context)
    return payload
  }
}
