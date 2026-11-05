import { z } from "zod"
export const mailInternalReceivedConfigSchema = z.object({}).strict()
export type MailInternalReceivedConfig = z.infer<typeof mailInternalReceivedConfigSchema>
