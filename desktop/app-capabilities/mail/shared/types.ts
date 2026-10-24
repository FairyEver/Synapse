import type { DispatchContext } from "../../../synapse-capabilities/shared/types"
import type { z } from "zod"
import type {
  MAIL_INPUT_SCHEMAS, MAIL_RESULT_SCHEMAS, accountConfigSchema, accountSummarySchema, folderSchema,
  locatorSchema, coverageSchema, assetSchema, summarySchema, draftInputSchema, draftSchema, receiptSchema, batchSchema, previewSchema, jobSchema,
} from "./schema"

export type MailAction = keyof typeof MAIL_INPUT_SCHEMAS
export type MailInputs = { [K in MailAction]: z.output<(typeof MAIL_INPUT_SCHEMAS)[K]> }
export type MailArguments = { [K in MailAction]: z.input<(typeof MAIL_INPUT_SCHEMAS)[K]> }
export type MailResults = { [K in MailAction]: z.output<(typeof MAIL_RESULT_SCHEMAS)[K]> }
export type AccountAction = Extract<MailAction, `account.${string}`>
export type SearchAction = Extract<MailAction, `search.${string}`>
export type DraftAction = Extract<MailAction, `draft.${string}`>
export type FolderMutation = Exclude<Extract<MailAction, `folder.${string}`>, "folder.list">
export type MessageMutation = "message.update" | "message.move" | "message.delete" | "message.restore"
export type MailAccountId = string
export type MailFolderId = string
export type MailAssetId = string
export type MailDraftId = string
export type MailJobId = string
export type MailOperationId = string
export type Page<T> = { items: T[]; nextCursor: string | null }
export type AccountConfig = z.output<typeof accountConfigSchema>
export type AccountSummary = z.output<typeof accountSummarySchema>
export type Folder = z.output<typeof folderSchema>
export type MessageLocator = z.output<typeof locatorSchema>
export type Coverage = z.output<typeof coverageSchema>
export type MailAsset = z.output<typeof assetSchema>
export type MailSummary = z.output<typeof summarySchema>
export type DraftInput = z.output<typeof draftInputSchema>
export type Address = DraftInput["to"][number]
export type Draft = z.output<typeof draftSchema>
export type SendReceipt = z.output<typeof receiptSchema>
export type BatchResult = z.output<typeof batchSchema>
export type MailPreview = z.output<typeof previewSchema>
export type MailJob = z.output<typeof jobSchema>
export type MailDetail = MailResults["message.get"]
export type DraftSyncResult = { draftId: string; syncState: Draft["syncState"]; remoteLocator: MessageLocator | null }
export type InboxDelta = { accountId: string; messages: MailSummary[]; baseline: boolean }

export interface MailContext {
  readonly shareCaller?: Pick<DispatchContext, "actor" | "clientId" | "source">
  readonly ownerId: string
  readonly generation: number
  readonly signal: AbortSignal
  readonly actor: "ui" | "mcp" | "sync"
}

export class MailError extends Error {
  constructor(readonly code: string, message: string, readonly details?: Readonly<Record<string, unknown>>) {
    super(message)
    this.name = "MailError"
  }
}
