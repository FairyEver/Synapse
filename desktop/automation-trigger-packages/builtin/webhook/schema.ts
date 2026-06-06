import { z } from "zod"

export const webhookTriggerConfigSchema = z.object({
  webhookPublicId: z.string().min(1),
  webhookName: z.string().min(1).optional(),
})

export type WebhookTriggerConfig = z.infer<typeof webhookTriggerConfigSchema>

