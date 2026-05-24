import { z } from "zod"
import { variableBindingSchema } from "../schemas/variable-binding"

export const fileConversionNodeOcrSchema = z.object({
  enabled: z.boolean().optional(),
  languages: z.array(z.string()).optional(),
  maxPages: z.number().int().positive().optional(),
}).optional()

export const fileConversionNodeConfigSchema = z.object({
  inputPath: z.string(),
  outputMode: z.enum(["result", "markdown-file"]).optional(),
  outputPath: z.string().optional(),
  outputDirectory: z.string().optional(),
  ocr: fileConversionNodeOcrSchema,
  variables: z.array(variableBindingSchema).optional(),
})

export type FileConversionNodeConfig = z.infer<typeof fileConversionNodeConfigSchema>
