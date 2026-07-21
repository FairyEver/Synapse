import path from "node:path"
import { z } from "zod"

export const documentTextExtractionInputSchema = z.object({
  filePath: z.string().min(1).refine(path.isAbsolute, "必须使用绝对路径"),
}).strict()

const documentTextExtractionResultFields = {
  text: z.string(),
  fileName: z.string().min(1),
  size: z.number().int().nonnegative(),
}

export const documentTextExtractionResultSchema = z.discriminatedUnion("format", [
  z.object({
    ...documentTextExtractionResultFields,
    format: z.literal("pdf"),
    pages: z.number().int().positive().optional(),
  }).strict(),
  z.object({
    ...documentTextExtractionResultFields,
    format: z.literal("docx"),
  }).strict(),
])

export type DocumentTextExtractionInput = z.infer<typeof documentTextExtractionInputSchema>
export type DocumentTextExtractionResult = z.infer<typeof documentTextExtractionResultSchema>
