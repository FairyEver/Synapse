import { z } from "zod"
import { assertStrictJson, type JsonValue } from "./json"

const SCRIPT_BINDING_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const RESERVED_SCRIPT_BINDING_NAMES = new Set(["__proto__", "prototype", "constructor"])
const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]))
const pathSegmentSchema = z.union([z.string(), z.number().int().nonnegative()])

export const scriptBindingNameSchema = z.string()
  .regex(SCRIPT_BINDING_NAME_RE, "输入名称必须以字母或下划线开头，且最多 64 个字符")
  .refine((name) => !RESERVED_SCRIPT_BINDING_NAMES.has(name), "输入名称为保留名称")

export const workflowScriptInputBindingSchema = z.object({
  name: scriptBindingNameSchema,
  source: z.discriminatedUnion("type", [
    z.object({ type: z.literal("static_json"), value: jsonValueSchema }),
    z.object({ type: z.literal("param"), param: z.string().min(1) }),
    z.object({ type: z.literal("node_output"), node: z.string().min(1) }),
    z.object({
      type: z.literal("node_value"),
      node: z.string().min(1),
      output: z.string().min(1),
      path: z.array(pathSegmentSchema).default([]),
    }),
    z.object({ type: z.literal("secret"), name: z.string().min(1) }),
  ]),
})

export const automationScriptInputBindingSchema = z.object({
  name: scriptBindingNameSchema,
  source: z.discriminatedUnion("type", [
    z.object({ type: z.literal("static"), value: jsonValueSchema }),
    z.object({ type: z.literal("trigger"), path: z.array(pathSegmentSchema).default([]) }),
    z.object({ type: z.literal("secret"), name: z.string().min(1) }),
  ]),
})

export type WorkflowScriptInputBinding = z.infer<typeof workflowScriptInputBindingSchema>
export type AutomationScriptInputBinding = z.infer<typeof automationScriptInputBindingSchema>

export function buildJsonInput(
  bindings: readonly { readonly name: string; readonly value: JsonValue }[],
): Record<string, JsonValue> {
  const input: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>
  for (const binding of bindings) {
    if (Object.prototype.hasOwnProperty.call(input, binding.name)) {
      throw new Error(`输入名称重复：${binding.name}`)
    }
    input[binding.name] = binding.value
  }
  return input
}

export function readJsonPath(value: JsonValue, path: readonly (string | number)[]): JsonValue {
  let current: JsonValue = value
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment >= current.length) {
        throw new Error(`结构化输入路径不存在：${String(segment)}`)
      }
      current = current[segment]!
      continue
    }
    if (
      current === null
      || Array.isArray(current)
      || typeof current !== "object"
      || !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      throw new Error(`结构化输入路径不存在：${segment}`)
    }
    current = current[segment]!
  }
  return current
}

export type ScriptTextParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false }

export function parseScriptJsonText(value: string): ScriptTextParseResult<JsonValue> {
  try {
    const parsed: unknown = JSON.parse(value)
    assertStrictJson(parsed)
    return { ok: true, value: parsed }
  } catch {
    return { ok: false }
  }
}

export function parseScriptPathText(
  value: string,
): ScriptTextParseResult<Array<string | number>> {
  try {
    const parsed: unknown = JSON.parse(value)
    if (
      !Array.isArray(parsed)
      || parsed.some((segment) =>
        typeof segment !== "string"
        && !(typeof segment === "number" && Number.isInteger(segment) && segment >= 0))
    ) {
      return { ok: false }
    }
    return { ok: true, value: parsed }
  } catch {
    return { ok: false }
  }
}
