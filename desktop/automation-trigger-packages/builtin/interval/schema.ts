import { z } from "zod"
import { automationTimeRangeSchema } from "../../schedule-constraints"

const activeDaysSchema = z.array(z.number().int().min(0).max(6)).min(1).max(7)

export const intervalTriggerConfigSchema = z.object({
  everyMinutes: z.number().int().positive(),
  anchor: z.enum(["created_at", "last_completed_at"]),
  activeDays: activeDaysSchema,
  timeRange: automationTimeRangeSchema.optional(),
})

export type IntervalTriggerConfig = z.infer<typeof intervalTriggerConfigSchema>
