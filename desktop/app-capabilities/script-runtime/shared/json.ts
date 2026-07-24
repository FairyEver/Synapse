export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue }
export type JsonObject = { readonly [key: string]: JsonValue }

export const SCRIPT_INPUT_MAX_BYTES = 1024 * 1024
export const SCRIPT_RESULT_MAX_BYTES = 1024 * 1024
export const SCRIPT_LOG_MAX_BYTES = 1024 * 1024
export const SCRIPT_SOURCE_MAX_BYTES = 1024 * 1024

type ProxyDetector = (value: object) => boolean

/**
 * Validates ordinary values without reading properties. This function cannot
 * identify Proxies; privileged boundaries must use the detector-based serializer.
 */
export function assertStrictJson(value: unknown, label = "value"): asserts value is JsonValue {
  serializeStrictJsonValue(value, label)
}

export function serializeStrictJsonObjectWithProxyDetector(
  value: unknown,
  label: string,
  isProxy: ProxyDetector,
): string {
  if (value === null || typeof value !== "object") {
    throw new TypeError(`${label} must be a strict JSON object`)
  }
  if (isProxy(value)) throw new TypeError(`${label} contains a Proxy`)
  if (Array.isArray(value)) throw new TypeError(`${label} must be a strict JSON object`)
  return serializeStrictJsonValueWithProxyDetector(value, label, isProxy)
}

export function serializeStrictJsonValueWithProxyDetector(
  value: unknown,
  label: string,
  isProxy: ProxyDetector,
): string {
  return serializeStrictJsonValue(value, label, isProxy)
}

function serializeStrictJsonValue(
  value: unknown,
  label: string,
  isProxy?: ProxyDetector,
): string {
  const seen = new Set<object>()

  const visit = (candidate: unknown, path: string): string => {
    if (candidate === null) return "null"
    if (typeof candidate === "string" || typeof candidate === "boolean") {
      return JSON.stringify(candidate) as string
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) throw new TypeError(`${path} must contain only finite numbers`)
      return JSON.stringify(candidate) as string
    }
    if (typeof candidate !== "object") {
      throw new TypeError(`${path} is not strict JSON`)
    }
    if (isProxy?.(candidate)) throw new TypeError(`${path} contains a Proxy`)
    if (seen.has(candidate)) throw new TypeError(`${path} contains a circular reference`)
    seen.add(candidate)
    if (Array.isArray(candidate)) {
      const ownKeys = Reflect.ownKeys(candidate)
      const lengthDescriptor = Object.getOwnPropertyDescriptor(candidate, "length")
      if (
        !lengthDescriptor
        || !("value" in lengthDescriptor)
        || lengthDescriptor.enumerable
        || lengthDescriptor.configurable
        || typeof lengthDescriptor.value !== "number"
        || !Number.isInteger(lengthDescriptor.value)
        || lengthDescriptor.value < 0
        || ownKeys.length !== lengthDescriptor.value + 1
      ) {
        throw new TypeError(`${path} is not a dense JSON array`)
      }
      const items: string[] = []
      for (let index = 0; index < lengthDescriptor.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index))
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          throw new TypeError(`${path} is not a dense JSON array`)
        }
        items.push(visit(descriptor.value, `${path}[${index}]`))
      }
      seen.delete(candidate)
      return `[${items.join(",")}]`
    }
    const prototype = Object.getPrototypeOf(candidate)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} contains a non-plain object`)
    }
    const properties: string[] = []
    for (const key of Reflect.ownKeys(candidate)) {
      if (typeof key !== "string") {
        throw new TypeError(`${path} contains a non-string property`)
      }
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key)
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError(`${path}.${key} is not an enumerable data property`)
      }
      properties.push(`${JSON.stringify(key)}:${visit(descriptor.value, `${path}.${key}`)}`)
    }
    seen.delete(candidate)
    return `{${properties.join(",")}}`
  }

  return visit(value, label)
}

export function serializeStrictJson(value: unknown, maxBytes: number, label: string): string {
  const serialized = serializeStrictJsonValue(value, label)
  if (new TextEncoder().encode(serialized).byteLength > maxBytes) {
    throw new ScriptRuntimeError("OUTPUT_TOO_LARGE", `${label} exceeds the ${maxBytes} byte limit.`)
  }
  return serialized
}

export function parseStrictJson(text: string, label: string): JsonValue {
  try {
    const parsed: unknown = JSON.parse(text)
    assertStrictJson(parsed, label)
    return parsed
  } catch (error) {
    if (error instanceof ScriptRuntimeError) throw error
    throw new ScriptRuntimeError(
      "INVALID_RESULT",
      `${label} must be exactly one strict JSON value.`,
      containsMultipleJsonValues(text) ? "multiple_json_values" : "invalid_json",
    )
  }
}

function containsMultipleJsonValues(text: string): boolean {
  const firstStart = skipJsonWhitespace(text, 0)
  const firstEnd = scanJsonValueEnd(text, firstStart)
  if (firstEnd === null || !isValidJsonSlice(text, firstStart, firstEnd)) return false

  const secondStart = skipJsonWhitespace(text, firstEnd)
  if (secondStart >= text.length) return false
  const secondEnd = scanJsonValueEnd(text, secondStart)
  return secondEnd !== null && isValidJsonSlice(text, secondStart, secondEnd)
}

function scanJsonValueEnd(text: string, start: number): number | null {
  const first = text[start]
  if (first === "\"") return scanJsonStringEnd(text, start)
  if (first === "{" || first === "[") return scanCompositeJsonEnd(text, start)
  if (text.startsWith("true", start)) return start + 4
  if (text.startsWith("false", start)) return start + 5
  if (text.startsWith("null", start)) return start + 4
  return scanJsonNumberEnd(text, start)
}

function scanCompositeJsonEnd(text: string, start: number): number | null {
  const stack = [text[start] === "{" ? "}" : "]"]
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index]
    if (char === "\"") {
      const stringEnd = scanJsonStringEnd(text, index)
      if (stringEnd === null) return null
      index = stringEnd - 1
      continue
    }
    if (char === "{" || char === "[") {
      stack.push(char === "{" ? "}" : "]")
      continue
    }
    if (char !== "}" && char !== "]") continue
    if (stack.pop() !== char) return null
    if (stack.length === 0) return index + 1
  }
  return null
}

function scanJsonStringEnd(text: string, start: number): number | null {
  for (let index = start + 1; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code === 0x22) return index + 1
    if (code < 0x20) return null
    if (code !== 0x5c) continue
    index += 1
    if (index >= text.length) return null
    if (text[index] !== "u") continue
    for (let offset = 1; offset <= 4; offset += 1) {
      const hex = text[index + offset]
      if (!hex || !/[0-9a-f]/i.test(hex)) return null
    }
    index += 4
  }
  return null
}

function scanJsonNumberEnd(text: string, start: number): number | null {
  let index = start
  if (text[index] === "-") index += 1
  if (text[index] === "0") {
    index += 1
  } else {
    const integerStart = index
    while (isDigit(text[index])) index += 1
    if (index === integerStart) return null
  }
  if (text[index] === ".") {
    index += 1
    const fractionStart = index
    while (isDigit(text[index])) index += 1
    if (index === fractionStart) return null
  }
  if (text[index] === "e" || text[index] === "E") {
    index += 1
    if (text[index] === "+" || text[index] === "-") index += 1
    const exponentStart = index
    while (isDigit(text[index])) index += 1
    if (index === exponentStart) return null
  }
  return index
}

function skipJsonWhitespace(text: string, start: number): number {
  let index = start
  while (index < text.length) {
    const code = text.charCodeAt(index)
    if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) break
    index += 1
  }
  return index
}

function isValidJsonSlice(text: string, start: number, end: number): boolean {
  try {
    JSON.parse(text.slice(start, end))
    return true
  } catch {
    return false
  }
}

function isDigit(value: string | undefined): boolean {
  return value !== undefined && value >= "0" && value <= "9"
}

export type ScriptRuntimeErrorCode =
  | "INVALID_INPUT"
  | "SCRIPT_CONFIRMATION_REQUIRED"
  | "CAPABILITY_UNAVAILABLE"
  | "RUNNER_BUSY"
  | "RUNNER_START_FAILED"
  | "SCRIPT_FAILED"
  | "INVALID_RESULT"
  | "OUTPUT_TOO_LARGE"
  | "TIMEOUT"
  | "CANCELLED"

export type ScriptRuntimeErrorReason =
  | "missing"
  | "invalid_json"
  | "multiple_json_values"
  | "unsupported_value"

export class ScriptRuntimeError extends Error {
  readonly name = "ScriptRuntimeError"

  constructor(
    readonly code: ScriptRuntimeErrorCode,
    message: string,
    readonly reason?: ScriptRuntimeErrorReason,
  ) {
    super(message)
  }
}
