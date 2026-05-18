import { z } from "zod"
import { variableBindingSchema, variableSourceSchema } from "../schemas/variable-binding"
import { scriptActionConfigSchema } from "../../action-packages/builtin/script/schema"

const SCRIPT_VARIABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

const scriptVariableBindingSchema = z.object({
  name: z.string().regex(SCRIPT_VARIABLE_NAME_RE, "脚本变量名只能包含字母、数字和下划线，且不能以数字开头"),
  source: variableSourceSchema,
})

export const scriptNodeConfigSchema = scriptActionConfigSchema.extend({
  variables: z.array(scriptVariableBindingSchema),
})

export type ScriptNodeConfig = z.infer<typeof scriptNodeConfigSchema>
