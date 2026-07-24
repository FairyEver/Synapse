import {
  HTML_GENERATION_DATA_MAX_BYTES,
  HTML_GENERATION_INPUT_MAX_BYTES,
  HTML_GENERATION_OUTPUT_MAX_BYTES,
  HTML_GENERATION_TEMPLATE_MAX_BYTES,
} from "../shared/limits"
import type { JsonObject, JsonValue } from "../shared/schema"
import { HtmlGenerationError } from "../shared/errors"

export type NormalizedHtmlGenerationInput = {
  readonly template: string
  readonly data: JsonObject
  readonly templateBytes: number
  readonly dataBytes: number
  readonly inputBytes: number
}

export function normalizeHtmlGenerationInput(input: unknown): NormalizedHtmlGenerationInput {
  if (!isPlainRecord(input) || !hasExactKeys(input, ["template", "data"])) {
    throw new HtmlGenerationError("INVALID_DATA")
  }
  if (typeof input.template !== "string" || input.template.length === 0 || !isWellFormedUnicode(input.template)) {
    throw new HtmlGenerationError("INVALID_TEMPLATE")
  }
  const templateBytes = Buffer.byteLength(input.template, "utf8")
  if (templateBytes > HTML_GENERATION_TEMPLATE_MAX_BYTES) {
    throw new HtmlGenerationError("TEMPLATE_TOO_LARGE")
  }

  let normalizedData: JsonObject
  try {
    validateJsonObject(input.data)
    const serialized = JSON.stringify(input.data)
    const dataBytes = Buffer.byteLength(serialized, "utf8")
    if (dataBytes > HTML_GENERATION_DATA_MAX_BYTES) {
      throw new HtmlGenerationError("DATA_TOO_LARGE")
    }
    normalizedData = JSON.parse(serialized) as JsonObject
    const inputBytes = Buffer.byteLength(JSON.stringify({ template: input.template, data: normalizedData }), "utf8")
    if (inputBytes > HTML_GENERATION_INPUT_MAX_BYTES) {
      throw new HtmlGenerationError("INPUT_TOO_LARGE")
    }
    return { template: input.template, data: normalizedData, templateBytes, dataBytes, inputBytes }
  } catch (error) {
    if (error instanceof HtmlGenerationError) throw error
    throw new HtmlGenerationError("INVALID_DATA", { cause: error })
  }
}

export function validateHtmlGenerationOutput(value: unknown, reportedSize?: number): { html: string; size: number } {
  if (typeof value !== "string" || !isWellFormedUnicode(value)) {
    throw new HtmlGenerationError("RENDER_FAILED")
  }
  const size = Buffer.byteLength(value, "utf8")
  if (size > HTML_GENERATION_OUTPUT_MAX_BYTES) {
    throw new HtmlGenerationError("OUTPUT_TOO_LARGE")
  }
  if (reportedSize !== undefined && (!Number.isSafeInteger(reportedSize) || reportedSize < 0 || reportedSize !== size)) {
    throw new HtmlGenerationError("RENDER_FAILED")
  }
  return { html: value, size }
}

export function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      index += 1
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}

function validateJsonObject(value: unknown): asserts value is JsonObject {
  if (!isPlainRecord(value)) throw new TypeError("Top-level data must be a plain object")
  validateJsonValue(value, new WeakSet<object>())
}

function validateJsonValue(value: unknown, active: WeakSet<object>): asserts value is JsonValue {
  if (value === null || typeof value === "boolean") return
  if (typeof value === "string") {
    if (!isWellFormedUnicode(value)) throw new TypeError("String is not well-formed Unicode")
    return
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Number must be finite")
    return
  }
  if (typeof value !== "object") throw new TypeError("Unsupported JSON value")
  if (active.has(value)) throw new TypeError("Cyclic data is not supported")
  active.add(value)
  try {
    if (Array.isArray(value)) {
      validateArray(value, active)
      return
    }
    if (!isPlainRecord(value)) throw new TypeError("Object must be plain")
    validateRecord(value, active)
  } finally {
    active.delete(value)
  }
}

function validateArray(value: unknown[], active: WeakSet<object>): void {
  if (Reflect.ownKeys(value).some((key) => typeof key === "symbol")) {
    throw new TypeError("Symbol keys are not supported")
  }
  const names = Object.getOwnPropertyNames(value)
  if (names.some((name) => name !== "length" && !isCanonicalArrayIndex(name, value.length))) {
    throw new TypeError("Custom array properties are not supported")
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new TypeError("Sparse arrays are not supported")
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      throw new TypeError("Array accessors and non-enumerable values are not supported")
    }
    validateJsonValue(descriptor.value, active)
  }
}

function validateRecord(value: Record<string, unknown>, active: WeakSet<object>): void {
  if (Reflect.ownKeys(value).some((key) => typeof key === "symbol")) {
    throw new TypeError("Symbol keys are not supported")
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!isWellFormedUnicode(key)) throw new TypeError("Object key is not well-formed Unicode")
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || descriptor.get || descriptor.set || !descriptor.enumerable) {
      throw new TypeError("Accessors and non-enumerable properties are not supported")
    }
    validateJsonValue(descriptor.value, active)
  }
}

function isCanonicalArrayIndex(value: string, length: number): boolean {
  if (!/^(0|[1-9]\d*)$/.test(value)) return false
  const index = Number(value)
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === value
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort()
  return keys.length === expected.length && expected.slice().sort().every((key, index) => key === keys[index])
}
