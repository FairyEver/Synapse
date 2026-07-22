import { z } from "zod"
import { variableBindingSchema } from "../../../workflow-nodes/schemas/variable-binding"

export const textExtractNodeConfigSchema = z.object({
  filePath: z.string().refine((value) => value.trim().length > 0, "文档文件必填"),
  variables: z.array(variableBindingSchema),
})

export type TextExtractNodeConfig = z.infer<typeof textExtractNodeConfigSchema>
