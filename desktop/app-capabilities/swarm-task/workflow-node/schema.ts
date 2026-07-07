import { z } from "zod"

import { variableBindingSchema } from "../../../workflow-nodes/schemas/variable-binding"
import { swarmRunModeSchema } from "../shared/schema"

export const swarmTaskNodeConfigSchema = z.object({
  taskId: z.string().min(1),
  promptOverride: z.string().min(1).optional(),
  runModeOverride: swarmRunModeSchema.optional(),
  maxRoundsOverride: z.number().int().min(1).max(500).optional(),
  concurrencyOverride: z.number().int().min(1).max(20).optional(),
  waitForCompletion: z.boolean().default(false),
  variables: z.array(variableBindingSchema).default([]),
}).strict()

export type SwarmTaskNodeConfig = z.infer<typeof swarmTaskNodeConfigSchema>
