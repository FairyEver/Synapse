import { z } from "zod"
import { variableBindingSchema } from "../../../workflow-nodes/schemas/variable-binding"
import { textFileEncodingSchema } from "../shared/schema"
import { isHtmlPath } from "../shared/schema"

export const textFileWriterNodeConfigSchema = z.object({
  path: z.string().min(1, "文件路径必填"),
  text: z.string(),
  encoding: textFileEncodingSchema,
  overwrite: z.boolean(),
  variables: z.array(variableBindingSchema),
}).strict().superRefine((value, context) => {
  if (isHtmlPath(value.path) && value.encoding === "utf16le") {
    context.addIssue({ code: "custom", path: ["encoding"], message: "HTML 文件仅支持 UTF-8 编码" })
  }
})

export type TextFileWriterNodeConfig = z.infer<typeof textFileWriterNodeConfigSchema>
