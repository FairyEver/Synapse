import { z } from "zod"

const emailListSchema = z.array(z.string().trim().email()).max(100)

export const wecomMailAccountSchema = z.object({
  address: z.string().email().optional(),
  displayName: z.string().min(1).max(120).optional(),
  connectedAt: z.string().min(1),
  lastValidatedAt: z.string().min(1),
}).strict()

export const wecomMailPersonSchema = z.object({
  name: z.string(),
  email: z.string(),
}).strict()

export const wecomMailSummarySchema = z.object({
  mailId: z.string().min(1),
  subject: z.string(),
  sendTime: z.string(),
  sender: wecomMailPersonSchema,
  receivers: z.array(wecomMailPersonSchema),
  isRead: z.boolean(),
  folderName: z.string().optional(),
}).strict()

export const wecomMailAttachmentSchema = z.object({
  name: z.string(),
  size: z.number().int().nonnegative().optional(),
}).strict()

export const wecomMailDetailSchema = wecomMailSummarySchema.extend({
  content: z.string(),
  to: z.array(wecomMailPersonSchema),
  cc: z.array(wecomMailPersonSchema),
  bcc: z.array(wecomMailPersonSchema),
  attachments: z.array(wecomMailAttachmentSchema),
}).strict()

export const wecomMailSearchInputSchema = z.object({
  query: z.string().trim().max(200).optional(),
  cursor: z.string().max(4096).optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).strict()

export const wecomMailSearchResultSchema = z.object({
  items: z.array(wecomMailSummarySchema),
  nextCursor: z.string().max(4096).nullable(),
  hasMore: z.boolean(),
}).strict()

export const wecomMailGetInputSchema = z.object({
  mailId: z.string().min(1).max(1024),
}).strict()

export const wecomMailSendInputSchema = z.object({
  to: emailListSchema.min(1),
  cc: emailListSchema.optional(),
  bcc: emailListSchema.optional(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().max(100_000),
  replyToMailId: z.string().min(1).max(1024).optional(),
  replyAll: z.boolean().optional(),
}).strict()

export const wecomMailSendResultSchema = z.object({
  ok: z.literal(true),
}).strict()

export type WecomMailAccount = z.infer<typeof wecomMailAccountSchema>
export type WecomMailPerson = z.infer<typeof wecomMailPersonSchema>
export type WecomMailSummary = z.infer<typeof wecomMailSummarySchema>
export type WecomMailDetail = z.infer<typeof wecomMailDetailSchema>
export type WecomMailSearchInput = z.infer<typeof wecomMailSearchInputSchema>
export type WecomMailSearchResult = z.infer<typeof wecomMailSearchResultSchema>
export type WecomMailGetInput = z.infer<typeof wecomMailGetInputSchema>
export type WecomMailSendInput = z.infer<typeof wecomMailSendInputSchema>
export type WecomMailSendResult = z.infer<typeof wecomMailSendResultSchema>
