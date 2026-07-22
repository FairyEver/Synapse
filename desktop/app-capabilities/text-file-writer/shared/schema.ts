import path from "node:path"
import { z } from "zod"
import { TEXT_FILE_WRITE_ERROR_CODES } from "./errors"

export const TEXT_FILE_FORMATS = ["txt", "md", "csv"] as const
export const TEXT_FILE_ENCODINGS = ["utf8", "utf16le"] as const
export const DEFAULT_TEXT_FILE_ENCODING = "utf8" as const
export const DEFAULT_TEXT_FILE_OVERWRITE = false as const

export const textFileFormatSchema = z.enum(TEXT_FILE_FORMATS)
export const textFileEncodingSchema = z.enum(TEXT_FILE_ENCODINGS)

export const textFileWriteInputSchema = z.object({
  text: z.string(),
  path: z.string().min(1, "文件路径必填").refine(path.isAbsolute, "文件路径必须是绝对路径"),
  encoding: textFileEncodingSchema.optional().default(DEFAULT_TEXT_FILE_ENCODING),
  overwrite: z.boolean().optional().default(DEFAULT_TEXT_FILE_OVERWRITE),
}).strict()

export const textFileWriteResultSchema = z.object({
  path: z.string(),
  fileName: z.string().min(1),
  format: textFileFormatSchema,
  encoding: textFileEncodingSchema,
  size: z.number().int().nonnegative(),
  overwritten: z.boolean(),
}).strict()

export const textFileWriteErrorPayloadSchema = z.object({
  code: z.enum(TEXT_FILE_WRITE_ERROR_CODES),
  message: z.string(),
  retryable: z.boolean(),
}).strict()

export const textFileWriteResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: textFileWriteResultSchema }).strict(),
  z.object({ ok: z.literal(false), error: textFileWriteErrorPayloadSchema }).strict(),
])

export const textFileOutputChooseRequestSchema = z.object({
  defaultPath: z.string().min(1).optional(),
}).strict().optional()

export type TextFileFormat = z.infer<typeof textFileFormatSchema>
export type TextFileEncoding = z.infer<typeof textFileEncodingSchema>
export type TextFileWriteInput = z.input<typeof textFileWriteInputSchema>
export type ParsedTextFileWriteInput = z.output<typeof textFileWriteInputSchema>
export type TextFileWriteResult = z.infer<typeof textFileWriteResultSchema>
export type TextFileWriteResponse = z.infer<typeof textFileWriteResponseSchema>
export type TextFileOutputChooseRequest = z.infer<typeof textFileOutputChooseRequestSchema>

export function textFileFormatFromPath(filePath: string): TextFileFormat | null {
  const extension = path.extname(filePath).slice(1).toLowerCase()
  return TEXT_FILE_FORMATS.find((format) => format === extension) ?? null
}
