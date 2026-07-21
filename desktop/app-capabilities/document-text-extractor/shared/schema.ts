import path from "node:path"
import { z } from "zod"

export const documentTextExtractionInputSchema = z.object({
  filePath: z.string().min(1).refine(path.isAbsolute, "必须使用绝对路径"),
}).strict()

export const documentTextExtractionResultSchema = z.object({
  text: z.string(),
  format: z.enum(["pdf", "docx"]),
  fileName: z.string().min(1),
  size: z.number().int().nonnegative(),
  pages: z.number().int().positive().optional(),
})

export type DocumentTextExtractionInput = z.infer<typeof documentTextExtractionInputSchema>
export type DocumentTextExtractionResult = z.infer<typeof documentTextExtractionResultSchema>
