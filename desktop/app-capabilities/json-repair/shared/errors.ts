import { z } from "zod"

export const JSON_REPAIR_ERROR_CODES = [
  "INVALID_INPUT",
  "INPUT_TOO_LARGE",
  "OUTPUT_TOO_LARGE",
  "MAX_DEPTH_EXCEEDED",
  "NO_JSON_FOUND",
  "JSON_REPAIR_FAILED",
  "NON_FINITE_NUMBER",
  "CANCELLED",
  "INTERNAL_ERROR",
] as const

export type JsonRepairErrorCode = (typeof JSON_REPAIR_ERROR_CODES)[number]

export const JSON_REPAIR_ERROR_MESSAGES = {
  INVALID_INPUT: "JSON 修复输入无效。",
  INPUT_TOO_LARGE: "输入文本超过 128 KiB 限制。",
  OUTPUT_TOO_LARGE: "修复后的 JSON 文本超过 1 MiB 限制。",
  MAX_DEPTH_EXCEEDED: "修复后的 JSON 嵌套超过 128 层限制。",
  NO_JSON_FOUND: "未找到可修复的 JSON 数据。",
  JSON_REPAIR_FAILED: "无法产出有效的 JSON 文本。",
  NON_FINITE_NUMBER: "JSON 包含非有限数值。",
  CANCELLED: "JSON 修复已取消。",
  INTERNAL_ERROR: "JSON 修复失败。",
} as const satisfies Record<JsonRepairErrorCode, string>

export const JSON_REPAIR_INVALID_FIELDS = ["request", "text"] as const
export const JSON_REPAIR_INVALID_REASONS = [
  "required",
  "type",
  "empty",
  "invalid_unicode",
  "unknown_field",
] as const

export type JsonRepairInvalidField = (typeof JSON_REPAIR_INVALID_FIELDS)[number]
export type JsonRepairInvalidReason = (typeof JSON_REPAIR_INVALID_REASONS)[number]

const invalidInputDataSchema = z.object({
  field: z.enum(JSON_REPAIR_INVALID_FIELDS),
  reason: z.enum(JSON_REPAIR_INVALID_REASONS),
}).strict()

const invalidInputErrorSchema = z.object({
  code: z.literal("INVALID_INPUT"),
  message: z.literal(JSON_REPAIR_ERROR_MESSAGES.INVALID_INPUT),
  retryable: z.literal(false),
  data: invalidInputDataSchema.optional(),
}).strict()

const fixedErrorSchemas = JSON_REPAIR_ERROR_CODES
  .filter((code) => code !== "INVALID_INPUT")
  .map((code) => z.object({
    code: z.literal(code),
    message: z.literal(JSON_REPAIR_ERROR_MESSAGES[code]),
    retryable: z.literal(false),
  }).strict())

export const jsonRepairErrorPayloadSchema = z.union([
  invalidInputErrorSchema,
  ...fixedErrorSchemas,
])

export type JsonRepairInvalidData = z.infer<typeof invalidInputDataSchema>

export type JsonRepairErrorPayload = {
  readonly code: JsonRepairErrorCode
  readonly message: (typeof JSON_REPAIR_ERROR_MESSAGES)[JsonRepairErrorCode]
  readonly retryable: false
  readonly data?: JsonRepairInvalidData
}

export class JsonRepairError extends Error {
  readonly code: JsonRepairErrorCode
  readonly data?: JsonRepairInvalidData

  constructor(
    code: JsonRepairErrorCode,
    data?: JsonRepairInvalidData,
  ) {
    super(JSON_REPAIR_ERROR_MESSAGES[code])
    this.name = "JsonRepairError"
    this.code = code
    this.data = data
  }
}

export function createJsonRepairErrorPayload(
  code: JsonRepairErrorCode,
  data?: JsonRepairInvalidData,
): JsonRepairErrorPayload {
  return {
    code,
    message: JSON_REPAIR_ERROR_MESSAGES[code],
    retryable: false,
    ...(code === "INVALID_INPUT" && data ? { data } : {}),
  }
}

export function serializeJsonRepairError(error: unknown): JsonRepairErrorPayload {
  if (error instanceof JsonRepairError) {
    return createJsonRepairErrorPayload(error.code, error.data)
  }
  return createJsonRepairErrorPayload("INTERNAL_ERROR")
}
