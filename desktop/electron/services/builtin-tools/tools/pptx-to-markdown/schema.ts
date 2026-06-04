import { z } from "zod"

export const pptxToMarkdownInputSchema = z.object({
  inputPath: z.string().min(1),
  outputMode: z.enum(["return", "write-file"]).default("return"),
  outputDirectory: z.string().min(1).optional(),
  outputPath: z.string().min(1).optional(),
})

export const pptxToMarkdownOutputSchema = z.object({
  markdown: z.string(),
  text: z.string(),
  sourcePath: z.string(),
  outputPath: z.string().optional(),
  assets: z.array(z.object({
    relativePath: z.string(),
    fileName: z.string(),
    mimeType: z.string(),
  })).optional(),
  metadata: z.record(z.string(), z.unknown()),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
})

export type PptxToMarkdownInput = z.infer<typeof pptxToMarkdownInputSchema>
export type PptxToMarkdownOutput = z.infer<typeof pptxToMarkdownOutputSchema>

