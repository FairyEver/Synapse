import { BadRequestException } from "@nestjs/common"
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
const date = z.iso.date()
/** 首期明确开放的只读能力；SDK 的 write/effect/invoke 仍需在每次调用时复核。 */
export const readParameters = {
  "meeting-room-usage": z.object({ date: date.optional() }).strict(),
  "perf-year-agreement-list": z.object({ pageNo: z.number().int().min(1).max(10_000).default(1), pageSize: z.number().int().min(1).max(50).default(20) }).strict(),
  "base-dict-get": z.object({ dictType: z.literal("protocol_status") }).strict(),
} as const
export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw new BadRequestException({ code: "INVALID_REQUEST", message: "扩展请求参数无效，请按接口契约填写。" })
  return parsed.data
}
