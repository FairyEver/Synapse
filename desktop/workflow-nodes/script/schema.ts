import { z } from "zod"
import { variableBindingSchema } from "../schemas/variable-binding"
import { scriptActionConfigSchema } from "../../action-packages/builtin/script/schema"

export const scriptNodeConfigSchema = scriptActionConfigSchema.extend({
  variables: z.array(variableBindingSchema),
})

export type ScriptNodeConfig = z.infer<typeof scriptNodeConfigSchema>
