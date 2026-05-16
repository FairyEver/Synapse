import { z } from "zod"
import { variableBindingSchema } from "../schemas/variable-binding"

export const promptNodeConfigSchema = z.object({
  providerId: z.string().min(1),
  modelTier: z.enum(["default", "haiku", "sonnet", "opus"]),
  variables: z.array(variableBindingSchema),
  prompt: z.string(),
  projectId: z.string().optional(),
})
export type PromptNodeConfig = z.infer<typeof promptNodeConfigSchema>
