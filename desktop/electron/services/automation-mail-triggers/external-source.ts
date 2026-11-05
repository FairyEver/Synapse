import type { MailReceiptPage, MailReceiptRef, MailReceiptSource, MailSourceBoundary, MailTriggerContext, PreparedMailPayload } from "./types"

export interface ExternalMailSourceDeps {
  listAccounts?(context: MailTriggerContext): Promise<string[]>
  assertCurrent(context: MailTriggerContext): void
  prepare(context: MailTriggerContext, accountId?: string): Promise<MailSourceBoundary[]>
  scan(context: MailTriggerContext, boundary: MailSourceBoundary, cursor: string, limit: number): Promise<MailReceiptPage>
  read(context: MailTriggerContext, receipt: MailReceiptRef): Promise<PreparedMailPayload>
}
export class ExternalMailReceiptSource implements MailReceiptSource {
  constructor(private readonly deps: ExternalMailSourceDeps) {}
  private assert(context: MailTriggerContext) { context.signal.throwIfAborted(); this.deps.assertCurrent(context) }
  async discover(context: MailTriggerContext) {
    this.assert(context); const result = await this.deps.listAccounts?.(context) ?? []; this.assert(context); return result
  }
  async prepare(context: MailTriggerContext, accountId?: string) {
    this.assert(context); const result = await this.deps.prepare(context, accountId); this.assert(context); return result
  }
  async scan(context: MailTriggerContext, boundary: MailSourceBoundary, cursor: string, limit: number) {
    this.assert(context); const result = await this.deps.scan(context, boundary, cursor, limit); this.assert(context); return result
  }
  async hydrate(context: MailTriggerContext, receipt: MailReceiptRef) {
    this.assert(context); const result = await this.deps.read(context, receipt); this.assert(context); return result
  }
}
