import { z } from "zod"
import { variableBindingSchema } from "../schemas/variable-binding"
import { httpRequestActionConfigSchema } from "../../action-packages/builtin/http-request/schema"

export const httpRequestNodeConfigSchema = httpRequestActionConfigSchema.extend({
  variables: z.array(variableBindingSchema),
})

export type HttpRequestNodeConfig = z.infer<typeof httpRequestNodeConfigSchema>
