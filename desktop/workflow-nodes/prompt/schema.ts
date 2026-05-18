import { z } from "zod"
import { variableBindingSchema } from "../schemas/variable-binding"

export const promptNodeConfigSchema = z.object({
  providerId: z.string().optional(),
  modelTier: z.enum(["default", "haiku", "sonnet", "opus"]).optional(),
  variables: z.array(variableBindingSchema),
  prompt: z.string().trim().min(1, "提示词不能为空"),
  projectId: z.string().optional(),
})
export type PromptNodeConfig = z.infer<typeof promptNodeConfigSchema>
