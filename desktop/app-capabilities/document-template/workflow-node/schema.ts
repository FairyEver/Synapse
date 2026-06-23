import { z } from "zod"
import { variableBindingSchema } from "../../../workflow-nodes/schemas/variable-binding"

export const documentTemplateNodeConfigSchema = z.object({
  templatePath: z.string().refine((value) => value.trim().length > 0, "模板文件必填"),
  outputPath: z.string().refine((value) => value.trim().length > 0, "输出文件必填"),
  dataSource: z.enum(["dataPath", "inline"]),
  dataPath: z.string().optional(),
  dataJson: z.string().optional(),
  overwrite: z.boolean(),
  variables: z.array(variableBindingSchema),
}).superRefine((value, ctx) => {
  if (value.dataSource === "dataPath" && !value.dataPath?.trim()) {
    ctx.addIssue({ code: "custom", path: ["dataPath"], message: "JSON 文件路径必填" })
  }
  if (value.dataSource === "inline" && !value.dataJson?.trim()) {
    ctx.addIssue({ code: "custom", path: ["dataJson"], message: "内联 JSON 必填" })
  }
})

export type DocumentTemplateNodeConfig = z.infer<typeof documentTemplateNodeConfigSchema>
