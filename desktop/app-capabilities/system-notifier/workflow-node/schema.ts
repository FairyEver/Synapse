import { z } from "zod"
import { variableBindingSchema } from "../../../workflow-nodes/schemas/variable-binding"

export const systemNotifierNodeConfigSchema = z.object({
  title: z.string().refine((value) => value.length > 0, "通知标题必填"),
  body: z.string().refine((value) => value.length > 0, "通知正文必填"),
  variables: z.array(variableBindingSchema).default([]),
  // `.default(false)` 让旧工作流（config 里没有这个键）照常解析。
  copyOnTap: z.boolean().default(false),
}).strict()

export type SystemNotifierNodeConfig = z.infer<typeof systemNotifierNodeConfigSchema>
