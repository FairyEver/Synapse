import { z } from "zod"
import { variableBindingSchema } from "../schemas/variable-binding"

export const endNodeConfigSchema = z.object({
  outputType: z.literal("text"),
  template: z.string(),
  variables: z.array(variableBindingSchema),
})
export type EndNodeConfig = z.infer<typeof endNodeConfigSchema>
