import { z } from "zod"
import { variableBindingSchema } from "../../../workflow-nodes/schemas/variable-binding"

export const jsonRepairNodeConfigSchema = z.object({
  text: z.string().refine((value) => value.trim().length > 0, "输入文本必填"),
  variables: z.array(variableBindingSchema).default([]),
}).strict()

export type JsonRepairNodeConfig = z.infer<typeof jsonRepairNodeConfigSchema>
