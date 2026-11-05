import { z } from "zod"
export const mailReceivedConfigSchema = z.object({ accountId: z.string().min(1).optional() }).strict()
export type MailReceivedConfig = z.infer<typeof mailReceivedConfigSchema>
