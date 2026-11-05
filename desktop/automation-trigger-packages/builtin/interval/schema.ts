import { z } from "zod"

export const intervalTriggerConfigSchema = z.object({
  everyMinutes: z.number().int().positive(),
  anchor: z.enum(["created_at", "last_completed_at"]),
})

export type IntervalTriggerConfig = z.infer<typeof intervalTriggerConfigSchema>
