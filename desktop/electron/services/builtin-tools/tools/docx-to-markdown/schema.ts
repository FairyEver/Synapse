import { z } from "zod"

export const docxToMarkdownInputSchema = z.object({
  inputPath: z.string().min(1),
  outputMode: z.enum(["return", "write-file"]).default("return"),
  outputDirectory: z.string().min(1).optional(),
  outputPath: z.string().min(1).optional(),
})

export const docxToMarkdownOutputSchema = z.object({
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

export type DocxToMarkdownInput = z.infer<typeof docxToMarkdownInputSchema>
export type DocxToMarkdownOutput = z.infer<typeof docxToMarkdownOutputSchema>

