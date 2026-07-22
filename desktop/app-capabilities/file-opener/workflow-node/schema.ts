import { z } from "zod"
import { variableBindingSchema } from "../../../workflow-nodes/schemas/variable-binding"

export const fileOpenerNodeConfigSchema = z.object({
  path: z.string().refine((value) => value.length > 0, "文件路径必填"),
  variables: z.array(variableBindingSchema),
})

export type FileOpenerNodeConfig = z.infer<typeof fileOpenerNodeConfigSchema>

