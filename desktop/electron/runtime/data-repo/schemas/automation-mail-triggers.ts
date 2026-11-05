import { z } from "zod"
import type { NamespaceSchema } from "../types"

const id = z.string().min(1).max(2048)
const sequence = z.string().regex(/^\d{1,30}$/u)
const boundary = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mail-internal"), sourceKey: id, receiptSequence: sequence, serverTime: z.iso.datetime() }).strict(),
  z.object({ kind: z.literal("mail"), sourceKey: id, accountId: id, folderId: id, endpointEpoch: id, uidValidity: id, uidNext: z.number().int().positive(), confirmedAt: z.iso.datetime() }).strict(),
])
const receipt = z.object({ sourceKey: id, receiptKey: id, messageId: id.optional(), receivedAt: z.iso.datetime().nullable(), sequence: sequence.optional(),
  locator: z.object({ accountId: id, folderId: id, uidValidity: id, uid: z.number().int().positive(), endpointEpoch: id }).strict().optional(),
}).strict()
const row = z.object({ id, schemaVersion: z.literal(1), kind: z.enum(["subscription", "source", "delivery"]), ownerId: id, apiOrigin: id,
  automationId: id, subscriptionId: id, sourceKey: z.string().max(2048), revision: z.number().int().nonnegative(),
  state: z.enum(["ready", "closed", "blocked", "retired", "pending", "awaiting_metadata", "submitted", "success", "failed", "unknown", "skipped"]),
  createdAt: z.iso.datetime(), orderKey: z.string().max(4096), retryAt: z.number().nonnegative(),
  boundary: boundary.optional(), cursor: z.string().max(8192).optional(), endedAt: z.iso.datetime().optional(),
  endCursor: z.string().max(100).optional(), stopConfirmed: z.boolean().optional(),
  receipt: receipt.optional(), runId: id.optional(), errorCode: z.string().max(200).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.kind === "source" && (!value.boundary || value.cursor === undefined)) ctx.addIssue({ code: "custom", message: "来源缺少接收边界" })
  if (value.kind === "delivery" && !value.receipt) ctx.addIssue({ code: "custom", message: "投递缺少信件引用" })
})
export type MailSourceBoundary = z.infer<typeof boundary>
export type MailReceiptRef = z.infer<typeof receipt>
export type MailTriggerRecord = z.infer<typeof row>
export type SubscriptionRow = MailTriggerRecord & { kind: "subscription" }
export type SourceRow = MailTriggerRecord & { kind: "source"; boundary: MailSourceBoundary; cursor: string }
export type DeliveryRow = MailTriggerRecord & { kind: "delivery"; receipt: MailReceiptRef }
const fields = Object.keys(row.shape) as (keyof MailTriggerRecord)[]
export const automationMailSchemas: readonly NamespaceSchema<MailTriggerRecord>[] = ["subscriptions", "sources", "deliveries"].map(entity => ({
  name: `app.automation-mail.${entity}`, backend: "sqlite", currentVersion: 1, migrations: [], transferPolicy: "local-only",
  validate: (value): value is MailTriggerRecord => row.safeParse(value).success && Buffer.byteLength(JSON.stringify(value)) <= 64 * 1024,
  sqlite: { fields, atomic: true, maxRecordBytes: 64 * 1024, indexes: [
    { name: "subscription_source", fields: ["subscriptionId", "sourceKey"] },
    { name: "identity_automation_state", fields: ["ownerId", "apiOrigin", "automationId", "state", "orderKey"] },
    { name: "identity_automation", fields: ["ownerId", "apiOrigin", "automationId", "id"] },
    { name: "automation_id", fields: ["automationId", "id"] },
    { name: "identity_error", fields: ["ownerId", "apiOrigin", "errorCode", "id"] },
  ] },
}))
