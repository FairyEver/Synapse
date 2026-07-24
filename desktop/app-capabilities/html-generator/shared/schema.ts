import { z } from "zod"
import { HTML_GENERATION_ERROR_CODES } from "./errors"

export {
  HTML_GENERATION_DATA_MAX_BYTES,
  HTML_GENERATION_INPUT_MAX_BYTES,
  HTML_GENERATION_OUTPUT_MAX_BYTES,
  HTML_GENERATION_TEMPLATE_MAX_BYTES,
} from "./limits"

export type JsonValue = null | string | boolean | number | JsonValue[] | JsonObject
export type JsonObject = { [key: string]: JsonValue }

const jsonObjectInputSchema = z.custom<Record<string, unknown>>(
  (value) => typeof value === "object" && value !== null && !Array.isArray(value),
  "数据必须是顶层对象",
)

export const htmlGenerationInputSchema = z.object({
  template: z.string().min(1),
  data: jsonObjectInputSchema,
}).strict()

export const htmlGenerationFileInputSchema = htmlGenerationInputSchema.extend({
  outputPath: z.string().min(1),
  overwrite: z.boolean().optional().default(false),
}).strict()

export const htmlGenerationResultSchema = z.object({
  html: z.string(),
  size: z.number().int().nonnegative(),
}).strict()

export const htmlGenerationFileOutputSchema = z.object({
  path: z.string(),
  fileName: z.string().min(1),
  format: z.enum(["html", "htm"]),
  encoding: z.literal("utf8"),
  size: z.number().int().nonnegative(),
  overwritten: z.boolean(),
}).strict()

export const htmlGenerationFileResultSchema = z.object({
  output: htmlGenerationFileOutputSchema,
}).strict()

export const htmlGenerationErrorPayloadSchema = z.object({
  code: z.enum(HTML_GENERATION_ERROR_CODES),
  message: z.string(),
  retryable: z.boolean(),
  line: z.number().int().positive().optional(),
}).strict()

export const htmlGenerationResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: htmlGenerationResultSchema }).strict(),
  z.object({ ok: z.literal(false), error: htmlGenerationErrorPayloadSchema }).strict(),
])

export const htmlGenerationFileResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), result: htmlGenerationFileResultSchema }).strict(),
  z.object({ ok: z.literal(false), error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    line: z.number().int().positive().optional(),
  }).strict() }).strict(),
])

export const htmlGeneratorOutputChooseRequestSchema = z.object({
  defaultPath: z.string().min(1).optional(),
}).strict().optional()

export type HtmlGenerationInput = z.input<typeof htmlGenerationInputSchema>
export type HtmlGenerationFileInput = z.input<typeof htmlGenerationFileInputSchema>
export type ParsedHtmlGenerationFileInput = z.output<typeof htmlGenerationFileInputSchema>
export type HtmlGenerationResult = z.infer<typeof htmlGenerationResultSchema>
export type HtmlGenerationFileResult = z.infer<typeof htmlGenerationFileResultSchema>
export type HtmlGenerationResponse = z.infer<typeof htmlGenerationResponseSchema>
export type HtmlGenerationFileResponse = z.infer<typeof htmlGenerationFileResponseSchema>
export type HtmlGeneratorOutputChooseRequest = z.infer<typeof htmlGeneratorOutputChooseRequestSchema>
