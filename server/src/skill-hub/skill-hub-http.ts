import { hubError } from "./skill-hub-error"

export function parseHubInput<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw hubError(400, "HUB_INVALID_INPUT", "Skill Hub 请求参数无效。")
  return parsed.data
}

export function hubPageQuery(query: Record<string, unknown>, ...booleanFields: string[]): Record<string, unknown> {
  const normalized = { ...query }
  if (typeof query.limit === "string" && /^\d{1,3}$/.test(query.limit)) normalized.limit = Number(query.limit)
  for (const field of booleanFields) {
    if (query[field] === "true" || query[field] === "false") normalized[field] = query[field] === "true"
  }
  return normalized
}
