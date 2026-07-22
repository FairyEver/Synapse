import path from "node:path"
import { z } from "zod"
import {
  TEXT_EXTRACTION_ERROR_CODES,
  TEXT_SAVE_ERROR_CODES,
} from "./errors"
import {
  DEFAULT_TEXT_FILE_ENCODING,
  DEFAULT_TEXT_FILE_OVERWRITE,
  textFileEncodingSchema,
  textFileWriteResultSchema,
} from "../../text-file-writer/shared/schema"

export const textExtractionInputSchema = z.object({
  filePath: z.string().min(1).refine(path.isAbsolute, "必须使用绝对路径"),
}).strict()

export const textExtractionOperationSchema = z.object({
  operationId: z.string().min(1),
}).strict()

export const textExtractionRequestSchema = textExtractionInputSchema.extend({
  operationId: z.string().min(1),
}).strict()

const textExtractionResultFields = {
  text: z.string(),
  fileName: z.string().min(1),
  size: z.number().int().nonnegative(),
}

export const textExtractionResultSchema = z.discriminatedUnion("format", [
  z.object({
    ...textExtractionResultFields,
    format: z.literal("pdf"),
    pages: z.number().int().positive().optional(),
  }).strict(),
  z.object({
    ...textExtractionResultFields,
    format: z.literal("docx"),
  }).strict(),
])

export const textExtractionErrorSchema = z.object({
  code: z.enum(TEXT_EXTRACTION_ERROR_CODES),
  message: z.string().min(1),
}).strict()

export const textExtractionResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    result: textExtractionResultSchema,
  }).strict(),
  z.object({
    ok: z.literal(false),
    error: textExtractionErrorSchema,
  }).strict(),
])

export const textExtractionToFileInputSchema = textExtractionInputSchema.extend({
  outputPath: z.string().min(1).refine(path.isAbsolute, "必须使用绝对路径"),
  encoding: textFileEncodingSchema.optional().default(DEFAULT_TEXT_FILE_ENCODING),
  overwrite: z.boolean().optional().default(DEFAULT_TEXT_FILE_OVERWRITE),
}).strict()

const textExtractionSourceMetadataFields = {
  fileName: z.string().min(1),
  size: z.number().int().nonnegative(),
}

export const textExtractionSourceMetadataSchema = z.discriminatedUnion("format", [
  z.object({
    ...textExtractionSourceMetadataFields,
    format: z.literal("pdf"),
    pages: z.number().int().positive().optional(),
  }).strict(),
  z.object({
    ...textExtractionSourceMetadataFields,
    format: z.literal("docx"),
  }).strict(),
])

export const textExtractionToFileResultSchema = z.object({
  source: textExtractionSourceMetadataSchema,
  output: textFileWriteResultSchema,
}).strict()

export const textExtractionStatusEventSchema = z.object({
  operationId: z.string().min(1),
  status: z.enum(["waiting", "running"]),
}).strict()

export const textExtractionCancelResultSchema = z.object({
  cancelled: z.boolean(),
}).strict()

export const textOutputChooseRequestSchema = z.object({
  defaultPath: z.string().min(1),
}).strict()

export const textSaveInputSchema = z.object({
  outputPath: z.string().min(1).refine(path.isAbsolute, "必须使用绝对路径"),
  text: z.string(),
}).strict()

export const textSaveResultSchema = z.object({
  outputPath: z.string(),
  fileName: z.string().min(1),
  size: z.number().int().nonnegative(),
}).strict()

export const textSaveErrorSchema = z.object({
  code: z.enum(TEXT_SAVE_ERROR_CODES),
  message: z.string().min(1),
}).strict()

export const textSaveResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    result: textSaveResultSchema,
  }).strict(),
  z.object({
    ok: z.literal(false),
    error: textSaveErrorSchema,
  }).strict(),
])

export type TextExtractionInput = z.infer<typeof textExtractionInputSchema>
export type TextExtractionResult = z.infer<typeof textExtractionResultSchema>
export type TextExtractionToFileInput = z.input<typeof textExtractionToFileInputSchema>
export type ParsedTextExtractionToFileInput = z.output<typeof textExtractionToFileInputSchema>
export type TextExtractionToFileResult = z.infer<typeof textExtractionToFileResultSchema>
export type TextExtractionRequest = z.infer<typeof textExtractionRequestSchema>
export type TextExtractionResponse = z.infer<typeof textExtractionResponseSchema>
export type TextExtractionStatusEvent = z.infer<typeof textExtractionStatusEventSchema>
export type TextOutputChooseRequest = z.infer<typeof textOutputChooseRequestSchema>
export type TextSaveInput = z.infer<typeof textSaveInputSchema>
export type TextSaveResult = z.infer<typeof textSaveResultSchema>
export type TextSaveResponse = z.infer<typeof textSaveResponseSchema>
