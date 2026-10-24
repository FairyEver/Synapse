import { z } from "zod"
import { accountConfigSchema, accountIdSchema, messageIdSchema, revisionSchema, draftIdSchema, draftInputSchema, addressSchema } from "./schema"
export const configureAccountSchema = accountConfigSchema.extend({ credential: z.string().min(1).max(4096), accountId: accountIdSchema.optional(), expectedRevision: revisionSchema.optional() }).strict()
  .refine(v => (v.accountId === undefined) === (v.expectedRevision === undefined), "Existing account requires its revision")
export type ConfigureAccount = z.input<typeof configureAccountSchema>
export interface MailScope { ownerId: string | null; generation: number; notificationsSupported: boolean; notificationError: string | null }
export const composeIntentSchema = z.union([
  z.object({ draftId: draftIdSchema }).strict(),
  z.object({ accountId: accountIdSchema, recipient: addressSchema.optional() }).strict(),
  z.object({ accountId: accountIdSchema, sourceMessageId: messageIdSchema, mode: z.enum(["reply", "reply_all", "forward"]) }).strict(),
])
export type ComposeIntent = { draftId: string } | { accountId: string; sourceMessageId?: undefined; mode?: undefined; recipient?: z.infer<typeof addressSchema> } | { accountId: string; sourceMessageId: string; mode: "reply" | "reply_all" | "forward" }
export const draftCommitSchema = z.object({
  content: draftInputSchema,
  source: z.object({ messageId: messageIdSchema, mode: z.enum(["reply", "reply_all", "forward"]) }).strict().optional(),
}).strict()
export type DraftCommit = z.infer<typeof draftCommitSchema>

export interface MailOpenRequest { requestId: string; ownerId: string; generation: number; accountId?: string; messageId?: string; configure?: boolean; compose?: ComposeIntent }
export interface MailChanged { ownerId: string; generation: number; accountId: string; ids: string[]; revision: number }

export const mailOpenRequestSchema = z.object({ requestId: z.string().min(1).max(200), ownerId: z.string().min(1).max(200), generation: z.number().int().nonnegative(), accountId: accountIdSchema.optional(), messageId: messageIdSchema.optional(), configure: z.boolean().optional(), compose: composeIntentSchema.optional() }).strict()
