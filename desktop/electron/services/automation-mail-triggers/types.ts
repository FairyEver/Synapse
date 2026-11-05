import type { AutomationTriggerEvent } from "../../../automation-trigger-packages/types.shared"
export type { MailSourceBoundary, MailReceiptRef, SubscriptionRow, SourceRow, DeliveryRow } from "../../runtime/data-repo/schemas/automation-mail-triggers"
import type { MailSourceBoundary, MailReceiptRef } from "../../runtime/data-repo/schemas/automation-mail-triggers"

export type MailTriggerIdentity = { ownerId: string; apiOrigin: string }
export type MailTriggerContext = { identity: MailTriggerIdentity; generation: number; signal: AbortSignal }
export type MailReceiptPage = { receipts: MailReceiptRef[]; nextCursor: string; complete: boolean }
export type PrepareSubscriptionInput = { identity: MailTriggerIdentity; automationId: string; boundaries: MailSourceBoundary[] }
export type DeliveryOutcome = { state: "success" | "failed" | "unknown" | "skipped"; errorCode?: string }
export type PreparedMailPayload = {
  messageId: string; subject: string; body: string; sender: string; to: string; cc: string; receivedAt: string;
  attachmentCount: number; attachments: string; url: string;
  accountId?: string; accountName?: string; accountAddress?: string;
}
export interface MailReceiptSource {
  discover?(context: MailTriggerContext): Promise<string[]>
  prepare(context: MailTriggerContext, accountId?: string): Promise<MailSourceBoundary[]>
  scan(context: MailTriggerContext, boundary: MailSourceBoundary, cursor: string, limit: number): Promise<MailReceiptPage>
  hydrate(context: MailTriggerContext, receipt: MailReceiptRef): Promise<PreparedMailPayload>
}
export type MailTriggerEvent = AutomationTriggerEvent
