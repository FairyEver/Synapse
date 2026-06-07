import { z } from "zod"
import { variableBindingSchema } from "../schemas/variable-binding"

export const workflowCallNodeConfigSchema = z.object({
  workflowId: z.string().trim().min(1, "请选择要调用的工作流"),
  variables: z.array(variableBindingSchema),
  paramTemplates: z.record(z.string(), z.string()),
})

export type WorkflowCallNodeConfig = z.infer<typeof workflowCallNodeConfigSchema>
