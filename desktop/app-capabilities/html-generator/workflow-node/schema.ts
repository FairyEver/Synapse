import { z } from "zod"

const nodeOutputSourceSchema = z.object({
  type: z.literal("node_output"),
  node: z.string().min(1),
}).strict()

const variableSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("param"), param: z.string().min(1) }).strict(),
  nodeOutputSourceSchema,
  z.object({ type: z.literal("static"), value: z.string() }).strict(),
])

const variableBindingSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*$/),
  source: variableSourceSchema,
}).strict()

const dataBindingSchema = z.object({
  name: z.literal("data"),
  source: nodeOutputSourceSchema,
}).strict()

const WORKFLOW_TEMPLATE_VARIABLE_RE = /\{\{\s*\$?([\p{L}\p{N}_.-]+)\s*\}\}/gu

export const htmlGeneratorEjsNodeConfigSchema = z.object({
  template: z.string().min(1),
  variables: z.array(dataBindingSchema).length(1),
}).strict()

export const htmlGeneratorEjsFileNodeConfigSchema = z.object({
  template: z.string().min(1),
  outputPath: z.string().min(1),
  overwrite: z.boolean(),
  variables: z.array(variableBindingSchema),
}).strict().superRefine((value, context) => {
  const dataBindings = value.variables.filter((binding) => binding.name === "data")
  if (dataBindings.length !== 1 || dataBindings[0]?.source.type !== "node_output") {
    context.addIssue({ code: "custom", path: ["variables"], message: "必须选择一个上游数据来源" })
  }

  const boundNames = new Set(value.variables.map((binding) => binding.name))
  for (const match of value.outputPath.matchAll(WORKFLOW_TEMPLATE_VARIABLE_RE)) {
    const variableName = match[1]
    if (variableName === "data") {
      context.addIssue({
        code: "custom",
        path: ["outputPath"],
        message: "输出文件不能引用保留变量 data",
      })
    } else if (!boundNames.has(variableName)) {
      context.addIssue({
        code: "custom",
        path: ["outputPath"],
        message: `模板变量「${variableName}」未绑定`,
      })
    }
  }
})

export type HtmlGeneratorEjsNodeConfig = z.infer<typeof htmlGeneratorEjsNodeConfigSchema>
export type HtmlGeneratorEjsFileNodeConfig = z.infer<typeof htmlGeneratorEjsFileNodeConfigSchema>
export type HtmlGeneratorNodeConfig = HtmlGeneratorEjsNodeConfig | HtmlGeneratorEjsFileNodeConfig
