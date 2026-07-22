import { z } from "zod"
import { variableBindingSchema } from "../../../workflow-nodes/schemas/variable-binding"
import { textFileEncodingSchema } from "../shared/schema"

export const textFileWriterNodeConfigSchema = z.object({
  path: z.string().min(1, "文件路径必填"),
  text: z.string(),
  encoding: textFileEncodingSchema,
  overwrite: z.boolean(),
  variables: z.array(variableBindingSchema),
}).strict()

export type TextFileWriterNodeConfig = z.infer<typeof textFileWriterNodeConfigSchema>
