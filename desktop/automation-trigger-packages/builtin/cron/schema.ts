import { z } from "zod"
import { automationTimeRangeSchema } from "../../schedule-constraints"

const activeDaysSchema = z.array(z.number().int().min(0).max(6)).min(1).max(7)

export const cronTriggerConfigSchema = z.object({
  expr: z.string().min(1),
  timezone: z.string().min(1).optional(),
  activeDays: activeDaysSchema,
  timeRange: automationTimeRangeSchema.optional(),
})

export type CronTriggerConfig = z.infer<typeof cronTriggerConfigSchema>
