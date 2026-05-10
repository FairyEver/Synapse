import { z } from "zod"
import { variableBindingSchema } from "../schemas/variable-binding"

export const promptNodeConfigSchema = z.object({
  agent: z.string().min(1),
  variables: z.array(variableBindingSchema),
  prompt: z.string(),
})
export type PromptNodeConfig = z.infer<typeof promptNodeConfigSchema>
