import { z } from "zod"

export const csvToMarkdownInputSchema = z.object({
  inputPath: z.string().min(1),
  outputMode: z.enum(["return", "write-file"]).default("return"),
  outputDirectory: z.string().min(1).optional(),
  outputPath: z.string().min(1).optional(),
  delimiter: z.string().min(1).max(1).default(","),
  maxRows: z.number().int().positive().max(10000).default(1000),
})

export const csvToMarkdownOutputSchema = z.object({
  markdown: z.string(),
  text: z.string(),
  sourcePath: z.string(),
  outputPath: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
})

export type CsvToMarkdownInput = z.infer<typeof csvToMarkdownInputSchema>
export type CsvToMarkdownOutput = z.infer<typeof csvToMarkdownOutputSchema>
