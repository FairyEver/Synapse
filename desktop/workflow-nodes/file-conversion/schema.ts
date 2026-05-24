import { z } from "zod"

export const fileConversionNodeConfigSchema = z.object({
  inputPath: z.string(),
  outputMode: z.enum(["result", "markdown-file"]).optional(),
  outputPath: z.string().optional(),
})

export type FileConversionNodeConfig = z.infer<typeof fileConversionNodeConfigSchema>
