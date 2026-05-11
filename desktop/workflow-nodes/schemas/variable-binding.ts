import { z } from "zod"

const VARIABLE_NAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fff][a-zA-Z0-9_\u4e00-\u9fff]*$/

export const variableSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("param"), param: z.string().min(1) }),
  z.object({ type: z.literal("node_output"), node: z.string().min(1) }),
  z.object({ type: z.literal("static"), value: z.string() }),
])

export const variableBindingSchema = z.object({
  name: z.string().regex(VARIABLE_NAME_RE, "变量名只能包含字母、数字、下划线或中文"),
  source: variableSourceSchema,
})

export type VariableBinding = z.infer<typeof variableBindingSchema>
export type VariableSource = z.infer<typeof variableSourceSchema>
