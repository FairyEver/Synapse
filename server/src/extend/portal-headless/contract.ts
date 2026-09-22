import { RequestValidationException } from "../../common/request-validation.exception"
import { z } from "zod"

const id = z.string().trim().min(1).max(200)
const page = { offset: z.number().int().min(0).max(10_000).default(0), limit: z.number().int().min(1).max(50).default(20) }
export const catalogInput = z.discriminatedUnion("op", [
  z.object({ op: z.literal("domains"), ...page }).strict(),
  z.object({ op: z.literal("pages"), domain: id, ...page }).strict(),
  z.object({ op: z.literal("page"), pageId: id }).strict(),
  z.object({ op: z.literal("search"), query: z.string().trim().min(1).max(500), ...page }).strict(),
  z.object({ op: z.literal("recommend"), query: z.string().trim().min(1).max(500) }).strict(),
])
export const describeInput = z.object({ kind: z.enum(["capability", "schema", "method"]), capabilityId: id, id: id.optional() }).strict()
export const readInput = z.object({ capabilityId: id, arguments: z.record(z.string(), z.unknown()).default({}) }).strict()
export const portalHeaders = z.object({
  token: z.string().min(1).max(16384).regex(/^[^\r\n]+$/),
  tenantId: z.string().min(1).max(128).regex(/^[^\r\n]+$/),
  language: z.enum(["zh-CN", "en-US"]).default("zh-CN"),
}).strict()
export type PortalCredentials = z.infer<typeof portalHeaders>
export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const fields = parsed.error.issues.slice(0, 20).map((issue) => {
      // Paths and messages must never echo arbitrary record keys, input values or credentials.
      const path = issue.path.every((part) => typeof part === "string" && requestFieldNames.has(part)) ? issue.path.join(".") || "$" : "$"
      let value = input
      for (const part of issue.path) value = value && typeof value === "object" && Object.hasOwn(value, part)
        ? (value as Record<PropertyKey, unknown>)[part] : undefined
      const required = issue.code === "invalid_type" && value === undefined
      return { path, code: required ? "required" : issue.code,
        message: required ? "缺少必填参数" : issue.code === "unrecognized_keys" ? "包含不支持的参数" : "参数类型、格式或取值不符合契约" }
    })
    throw new RequestValidationException(fields)
  }
  return parsed.data
}

const requestFieldNames = new Set(["op", "offset", "limit", "domain", "pageId", "query", "kind", "capabilityId", "id", "arguments", "token", "tenantId", "language", "date", "pageNo", "pageSize", "dictType"])
