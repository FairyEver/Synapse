import { z } from "zod"
import { variableBindingSchema } from "../schemas/variable-binding"

export const openFileNodeConfigSchema = z.object({
  filePath: z.string().refine((value) => value.length > 0, "文件路径必填"),
  variables: z.array(variableBindingSchema),
})

export type OpenFileNodeConfig = z.infer<typeof openFileNodeConfigSchema>
