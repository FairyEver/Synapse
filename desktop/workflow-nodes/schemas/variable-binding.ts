import { z } from "zod"

const VARIABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export const variableSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("param"), param: z.string().min(1) }),
  z.object({ type: z.literal("node_output"), node: z.string().min(1) }),
  z.object({ type: z.literal("static"), value: z.string() }),
])

export const variableBindingSchema = z.object({
  name: z.string().regex(VARIABLE_NAME_RE, "Variable name must match /^[a-zA-Z_][a-zA-Z0-9_]*/"),
  source: variableSourceSchema,
})

export type VariableBinding = z.infer<typeof variableBindingSchema>
export type VariableSource = z.infer<typeof variableSourceSchema>
