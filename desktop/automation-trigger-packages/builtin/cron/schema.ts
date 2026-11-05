import { z } from "zod"

export const cronTriggerConfigSchema = z.object({
  expr: z.string().min(1),
  timezone: z.string().min(1).optional(),
})

export type CronTriggerConfig = z.infer<typeof cronTriggerConfigSchema>
