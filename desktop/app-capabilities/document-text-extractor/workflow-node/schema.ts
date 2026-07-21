import { z } from "zod"
import { variableBindingSchema } from "../../../workflow-nodes/schemas/variable-binding"

export const documentTextExtractNodeConfigSchema = z.object({
  filePath: z.string().refine((value) => value.trim().length > 0, "文档文件必填"),
  variables: z.array(variableBindingSchema),
})

export type DocumentTextExtractNodeConfig = z.infer<typeof documentTextExtractNodeConfigSchema>
