import { z } from "zod"

import { automationConditionSchema, automationConditionsSchema } from "./schedule-constraints"

/** V2 内的格式修订；configVersion 仍只表示用户编辑次数。 */
export const AUTOMATION_FORMAT_REVISION = 1
export const AUTOMATION_UPGRADE_MESSAGE = "自动化配置需要更新，请升级客户端后操作"

export const automationPolicySchema = z.object({
  missedRunPolicy: z.enum(["skip", "run_once"]),
  overlapPolicy: z.literal("skip"),
}).strict()

export const automationScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("global") }).strict(),
  z.object({ type: z.literal("project"), projectId: z.string().min(1) }).strict(),
])

const refSchema = z.object({ type: z.string().min(1), config: z.record(z.string(), z.unknown()) }).strict()

// IPC 和 capability service 使用同一写入契约，未知字段不能在传输时被静默移除。
export const automationCreateInputSchema = z.object({
  name: z.string().min(1), description: z.string().optional(), enabled: z.boolean().optional(),
  scope: automationScopeSchema, cwd: z.string().optional(), trigger: refSchema, executor: refSchema,
  conditions: automationConditionsSchema.optional(), policy: automationPolicySchema.partial().optional(),
}).strict()

export const automationUpdateInputSchema = automationCreateInputSchema.partial().extend({
  conditions: automationConditionsSchema.nullable().optional(),
}).strict()

type CompatibilityItem = {
  readonly schemaVersion: number
  readonly formatRevision?: unknown
  readonly scope: unknown
  readonly policy: unknown
  readonly conditions?: unknown
}

export type AutomationCompatibilityIssue = { readonly field: string; readonly message: string }

/** 存储允许未来语义，但只有本客户端理解的格式才可编辑和运行。 */
export function automationFormatIssue(item: CompatibilityItem): AutomationCompatibilityIssue | undefined {
  if (item.schemaVersion !== 2) return { field: "schemaVersion", message: AUTOMATION_UPGRADE_MESSAGE }
  const revision = item.formatRevision === undefined ? 1 : item.formatRevision
  if (revision !== AUTOMATION_FORMAT_REVISION) return { field: "formatRevision", message: AUTOMATION_UPGRADE_MESSAGE }
  const scope = item.scope as { type?: unknown } | null
  if (!scope || !automationScopeSchema.options.some(option => option.shape.type.safeParse(scope.type).success) ||
    automationConfigIssue(automationScopeSchema, scope as Record<string, unknown>)) {
    return { field: "scope", message: AUTOMATION_UPGRADE_MESSAGE }
  }
  if (!automationPolicySchema.safeParse(item.policy).success) return { field: "policy", message: AUTOMATION_UPGRADE_MESSAGE }
  if (item.conditions !== undefined) {
    const conditions = item.conditions as { operator?: unknown; items?: { type?: unknown }[] } | null
    if (!conditions || !automationConditionsSchema.shape.operator.safeParse(conditions.operator).success || !Array.isArray(conditions.items) ||
      conditions.items.some(condition => !condition || !automationConditionSchema.options.some(option => option.shape.type.safeParse(condition.type).success)) ||
      automationConfigIssue(automationConditionsSchema, conditions as Record<string, unknown>)) {
      return { field: "conditions", message: AUTOMATION_UPGRADE_MESSAGE }
    }
  }
  return undefined
}

export class AutomationCompatibilityError extends Error {
  constructor() {
    super(AUTOMATION_UPGRADE_MESSAGE)
    this.name = "AutomationCompatibilityError"
  }
}

/** 同时识别 strict schema 拒绝和普通 object schema 静默删除的未知键。 */
export function automationConfigIssue(schema: z.ZodType, config: Record<string, unknown>): boolean {
  const parsed = schema.safeParse(config)
  return parsed.success
    ? hasRemovedFields(config, parsed.data)
    : hasUnknownKeyIssues(parsed.error.issues) || hasUndeclaredFields(schema, config)
}

export function parseAutomationConfig<T>(schema: z.ZodType<T>, config: Record<string, unknown>): T {
  if (automationConfigIssue(schema, config)) throw new AutomationCompatibilityError()
  return schema.parse(config)
}

function hasUnknownKeyIssues(issues: readonly z.core.$ZodIssue[]): boolean {
  return issues.some(issue => issue.code === "unrecognized_keys" ||
    issue.code === "invalid_union" && issue.errors.some(hasUnknownKeyIssues))
}

// 验证失败时也检查声明形状，避免已知错误掩盖未来字段；不改变包自己的 schema。
function hasUndeclaredFields(schema: z.core.$ZodType, input: unknown): boolean {
  if (input === undefined || input === null) return false
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodDefault ||
    schema instanceof z.ZodPrefault || schema instanceof z.ZodCatch || schema instanceof z.ZodReadonly || schema instanceof z.ZodLazy) {
    return hasUndeclaredFields(schema.unwrap(), input)
  }
  if (schema instanceof z.ZodPipe) return hasUndeclaredFields(schema.in, input)
  if (schema instanceof z.ZodArray && Array.isArray(input)) {
    return input.some(value => hasUndeclaredFields(schema.element, value))
  }
  if (schema instanceof z.ZodUnion) {
    const options = schema instanceof z.ZodDiscriminatedUnion && typeof input === "object"
      ? schema.options.filter(option => option instanceof z.ZodObject &&
        (option.shape[schema.def.discriminator] as z.ZodType).safeParse((input as Record<string, unknown>)[schema.def.discriminator]).success)
      : schema.options
    return options.length > 0 && options.every(option => hasUndeclaredFields(option, input))
  }
  if (typeof input !== "object" || Array.isArray(input)) return false
  if (schema instanceof z.ZodRecord) {
    return Object.values(input).some(value => hasUndeclaredFields(schema.valueType, value))
  }
  if (!(schema instanceof z.ZodObject)) return false
  return Object.entries(input).some(([key, value]) => {
    if (value === undefined) return false
    if (Object.hasOwn(schema.shape, key)) return hasUndeclaredFields(schema.shape[key]!, value)
    const catchall = schema.def.catchall
    return !catchall || catchall instanceof z.ZodNever || hasUndeclaredFields(catchall, value)
  })
}

function hasRemovedFields(input: unknown, output: unknown): boolean {
  if (Array.isArray(input)) {
    return Array.isArray(output) && input.some((value, index) => hasRemovedFields(value, output[index]))
  }
  if (!input || typeof input !== "object" || !output || typeof output !== "object") return false
  return Object.entries(input).some(([key, value]) => value !== undefined &&
    (!Object.hasOwn(output, key) || hasRemovedFields(value, (output as Record<string, unknown>)[key])))
}
