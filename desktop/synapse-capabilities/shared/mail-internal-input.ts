import { z } from "zod"

export const mailRecipientResolveInputSchema = z.object({
  nicknames: z.array(z.string().max(100).trim().min(1).regex(/^[^\u0000\p{Surrogate}]+$/u)).min(1).max(50),
}).strict()

export const mailRecipientResolveResultSchema = z.object({
  items: z.array(z.discriminatedUnion("status", [
    z.object({ nickname: z.string(), status: z.literal("matched"), userId: z.string().min(1), contactEmail: z.string().nullable() }),
    z.object({ nickname: z.string(), status: z.literal("not_found") }),
    z.object({ nickname: z.string(), status: z.literal("ambiguous") }),
  ])),
})

export type MailRecipientResolveInput = z.infer<typeof mailRecipientResolveInputSchema>

export const mailBoxInputSchema = z.object({ box: z.enum(["inbox", "sent"]) }).strict()
export const mailMessageListInputSchema = mailBoxInputSchema.extend({
  query: z.string().max(120).optional(), cursor: z.string().min(1).optional(), unreadOnly: z.boolean().optional(),
  contactKey: z.string().regex(/^(platform|(?:user|organization):[^\s:]{1,160})$/u).optional(),
}).superRefine((input, ctx) => {
  if (input.box === "sent" && input.unreadOnly) ctx.addIssue({ code: "custom", path: ["unreadOnly"], message: "Unread filter is only available for inbox." })
  if ((input.box === "sent" && input.contactKey === "platform") || (input.box === "inbox" && input.contactKey?.startsWith("organization:"))) {
    ctx.addIssue({ code: "custom", path: ["contactKey"], message: "Invalid contact filter for this mailbox." })
  }
})

export const mailAttachmentSourceSchema = z.object({
  filePath: z.string().min(1).max(4096).optional(), shareImageRef: z.string().uuid().optional(),
}).strict().refine(input => (input.filePath === undefined) !== (input.shareImageRef === undefined), "Provide exactly one of filePath or shareImageRef.")
