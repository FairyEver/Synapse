import { z } from "zod"
import { variableBindingSchema } from "../../../workflow-nodes/schemas/variable-binding"

export const systemNotifierNodeConfigSchema = z.object({
  title: z.string().refine((value) => value.length > 0, "通知标题必填"),
  body: z.string().refine((value) => value.length > 0, "通知正文必填"),
  variables: z.array(variableBindingSchema).default([]),
}).strict()

export type SystemNotifierNodeConfig = z.infer<typeof systemNotifierNodeConfigSchema>
