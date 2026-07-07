import { z } from "zod"

import { swarmRunModeSchema } from "../shared/schema"

export const swarmTaskNodeConfigSchema = z.object({
  taskId: z.string().min(1),
  promptOverride: z.string().min(1).optional(),
  runModeOverride: swarmRunModeSchema.optional(),
  maxRoundsOverride: z.number().int().min(1).max(500).optional(),
  concurrencyOverride: z.number().int().min(1).max(20).optional(),
  waitForCompletion: z.boolean().default(false),
}).strict()

export type SwarmTaskNodeConfig = z.infer<typeof swarmTaskNodeConfigSchema>
