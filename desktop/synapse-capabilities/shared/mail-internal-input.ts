import { z } from "zod"

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
