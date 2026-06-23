import { z } from "zod"
import { variableBindingSchema, variableSourceSchema } from "../schemas/variable-binding"

const workflowCallParamBindingSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("template"), template: z.string() }),
  z.object({ mode: z.literal("value"), source: variableSourceSchema }),
])

export const workflowCallNodeConfigSchema = z.object({
  workflowId: z.string().trim().min(1, "请选择要调用的工作流"),
  variables: z.array(variableBindingSchema),
  paramTemplates: z.record(z.string(), z.string()),
  paramBindings: z.record(z.string(), workflowCallParamBindingSchema).default({}),
})

export type WorkflowCallNodeConfig = z.infer<typeof workflowCallNodeConfigSchema>
