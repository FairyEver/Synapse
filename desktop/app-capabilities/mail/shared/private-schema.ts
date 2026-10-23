import { z } from "zod"
import { accountConfigSchema, accountIdSchema, messageIdSchema, revisionSchema } from "./schema"
export const configureAccountSchema = accountConfigSchema.extend({ credential: z.string().min(1).max(4096), accountId: accountIdSchema.optional(), expectedRevision: revisionSchema.optional() }).strict()
  .refine(v => (v.accountId === undefined) === (v.expectedRevision === undefined), "Existing account requires its revision")
export type ConfigureAccount = z.input<typeof configureAccountSchema>
export interface MailScope { ownerId: string | null; generation: number; notificationsSupported: boolean; notificationError: string | null }
export interface MailOpenRequest { requestId: string; ownerId: string; generation: number; accountId?: string; messageId?: string; configure?: boolean }
export interface MailChanged { ownerId: string; generation: number; accountId: string; ids: string[]; revision: number }

export const mailOpenRequestSchema = z.object({ requestId: z.string().min(1).max(200), ownerId: z.string().min(1).max(200), generation: z.number().int().nonnegative(), accountId: accountIdSchema.optional(), messageId: messageIdSchema.optional(), configure: z.boolean().optional() }).strict()
