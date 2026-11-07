import { z } from "zod"

export const manualTriggerConfigSchema = z.object({}).strict()

export type ManualTriggerConfig = z.infer<typeof manualTriggerConfigSchema>
