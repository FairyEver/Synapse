import { z } from "zod"
import {
  createJsonRepairErrorPayload,
  jsonRepairErrorPayloadSchema,
  type JsonRepairErrorPayload,
} from "./errors"

export const JSON_REPAIR_INPUT_MAX_BYTES = 128 * 1024
export const JSON_REPAIR_OUTPUT_MAX_BYTES = 1024 * 1024
export const JSON_REPAIR_MAX_DEPTH = 128
export const JSON_REPAIR_SCHEMA_MAX_LENGTH = 131_072

export interface JsonRepairInput {
  readonly text: string
}

export interface ValidatedJsonRepairInput {
  readonly text: string
  readonly inputBytes: number
}

export type JsonRepairInputValidation =
  | { readonly ok: true; readonly data: ValidatedJsonRepairInput }
  | { readonly ok: false; readonly error: JsonRepairErrorPayload }

export const jsonRepairResultSchema = z.object({
  json: z.string(),
}).strict()

export const jsonRepairResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    result: jsonRepairResultSchema,
  }).strict(),
  z.object({
    ok: z.literal(false),
    error: jsonRepairErrorPayloadSchema,
  }).strict(),
])

export type JsonRepairResult = z.infer<typeof jsonRepairResultSchema>
export type JsonRepairResponse = z.infer<typeof jsonRepairResponseSchema>

export function validateJsonRepairInput(request: unknown): JsonRepairInputValidation {
  if (!isPlainObject(request)) {
    return invalid("request", "type")
  }
  if (Object.keys(request).some((key) => key !== "text")) {
    return invalid("request", "unknown_field")
  }
  if (!Object.prototype.hasOwnProperty.call(request, "text")) {
    return invalid("text", "required")
  }
  if (typeof request.text !== "string") {
    return invalid("text", "type")
  }
  if (request.text.trim().length === 0) {
    return invalid("text", "empty")
  }
  if (hasUnpairedSurrogate(request.text)) {
    return invalid("text", "invalid_unicode")
  }
  const inputBytes = utf8ByteLength(request.text)
  if (inputBytes > JSON_REPAIR_INPUT_MAX_BYTES) {
    return { ok: false, error: createJsonRepairErrorPayload("INPUT_TOO_LARGE") }
  }
  return {
    ok: true,
    data: {
      text: request.text,
      inputBytes,
    },
  }
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return true
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return true
      index++
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true
    }
  }
  return false
}

function invalid(
  field: "request" | "text",
  reason: "required" | "type" | "empty" | "invalid_unicode" | "unknown_field",
): JsonRepairInputValidation {
  return {
    ok: false,
    error: createJsonRepairErrorPayload("INVALID_INPUT", { field, reason }),
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
