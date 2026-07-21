import path from "node:path"
import { z } from "zod"
import {
  DOCUMENT_TEXT_EXTRACTION_ERROR_CODES,
  DOCUMENT_TEXT_SAVE_ERROR_CODES,
} from "./errors"

export const documentTextExtractionInputSchema = z.object({
  filePath: z.string().min(1).refine(path.isAbsolute, "必须使用绝对路径"),
}).strict()

export const documentTextExtractionOperationSchema = z.object({
  operationId: z.string().min(1),
}).strict()

export const documentTextExtractionRequestSchema = documentTextExtractionInputSchema.extend({
  operationId: z.string().min(1),
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

export const documentTextExtractionErrorSchema = z.object({
  code: z.enum(DOCUMENT_TEXT_EXTRACTION_ERROR_CODES),
  message: z.string().min(1),
}).strict()

export const documentTextExtractionResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    result: documentTextExtractionResultSchema,
  }).strict(),
  z.object({
    ok: z.literal(false),
    error: documentTextExtractionErrorSchema,
  }).strict(),
])

export const documentTextExtractionStatusEventSchema = z.object({
  operationId: z.string().min(1),
  status: z.enum(["waiting", "running"]),
}).strict()

export const documentTextExtractionCancelResultSchema = z.object({
  cancelled: z.boolean(),
}).strict()

export const documentTextOutputChooseRequestSchema = z.object({
  defaultPath: z.string().min(1),
}).strict()

export const documentTextSaveInputSchema = z.object({
  outputPath: z.string().min(1).refine(path.isAbsolute, "必须使用绝对路径"),
  text: z.string(),
}).strict()

export const documentTextSaveResultSchema = z.object({
  outputPath: z.string(),
  fileName: z.string().min(1),
  size: z.number().int().nonnegative(),
}).strict()

export const documentTextSaveErrorSchema = z.object({
  code: z.enum(DOCUMENT_TEXT_SAVE_ERROR_CODES),
  message: z.string().min(1),
}).strict()

export const documentTextSaveResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    result: documentTextSaveResultSchema,
  }).strict(),
  z.object({
    ok: z.literal(false),
    error: documentTextSaveErrorSchema,
  }).strict(),
])

export type DocumentTextExtractionInput = z.infer<typeof documentTextExtractionInputSchema>
export type DocumentTextExtractionResult = z.infer<typeof documentTextExtractionResultSchema>
export type DocumentTextExtractionRequest = z.infer<typeof documentTextExtractionRequestSchema>
export type DocumentTextExtractionResponse = z.infer<typeof documentTextExtractionResponseSchema>
export type DocumentTextExtractionStatusEvent = z.infer<typeof documentTextExtractionStatusEventSchema>
export type DocumentTextOutputChooseRequest = z.infer<typeof documentTextOutputChooseRequestSchema>
export type DocumentTextSaveInput = z.infer<typeof documentTextSaveInputSchema>
export type DocumentTextSaveResult = z.infer<typeof documentTextSaveResultSchema>
export type DocumentTextSaveResponse = z.infer<typeof documentTextSaveResponseSchema>
