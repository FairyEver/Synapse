import { z } from "zod"
import { variableBindingSchema } from "../schemas/variable-binding"

export const textNodeConfigSchema = z.object({
  template: z.string(),
  variables: z.array(variableBindingSchema),
})

export type TextNodeConfig = z.infer<typeof textNodeConfigSchema>
