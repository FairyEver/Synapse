import { BadRequestException } from "@nestjs/common"
import { z } from "zod"
import { badRequestFromZodError } from "../common/zod-validation"
import {
  CLIENT_TELEMETRY_BATCH_LIMIT,
  CLIENT_TELEMETRY_MAX_CLOCK_SKEW_MS,
  CLIENT_TELEMETRY_MAX_EVENT_AGE_MS,
  CLIENT_TELEMETRY_RETENTION_DAYS,
} from "./client-telemetry.constants"

const stableEventKey = /^[a-z][a-z0-9._-]{0,63}$/u
const stableDimension = /^[a-z0-9][a-z0-9._-]{0,63}$/u
const uuidLike = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu

export const clientTelemetryEventSchema = z.object({
  eventId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/u),
  category: z.enum(["lifecycle", "navigation", "interaction", "operation", "error"]),
  eventKey: z.string().regex(stableEventKey).refine((value) => !uuidLike.test(value)),
  component: z.string().regex(stableDimension),
  action: z.string().regex(stableDimension),
  outcome: z.enum(["success", "failure", "cancelled"]).optional(),
  durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).optional(),
  moduleId: z.string().regex(stableDimension).optional(),
  windowType: z.string().regex(stableDimension).max(32),
  clientInstanceId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/u),
  sessionId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/u),
  appVersion: z.string().min(1).max(32).regex(/^[A-Za-z0-9.+_-]+$/u),
  platform: z.string().min(1).max(32).regex(/^[A-Za-z0-9._-]+$/u),
  occurredAt: z.iso.datetime({ offset: true }),
}).strict()

export const clientTelemetryBatchSchema = z.object({
  events: z.array(clientTelemetryEventSchema).min(1).max(CLIENT_TELEMETRY_BATCH_LIMIT),
}).strict()

export type ClientTelemetryEventInput = z.infer<typeof clientTelemetryEventSchema>

export function parseClientTelemetryBatch(input: unknown, now = new Date()): ClientTelemetryEventInput[] {
  const parsed = clientTelemetryBatchSchema.safeParse(input)
  if (!parsed.success) {
    throw badRequestFromZodError(parsed.error, "埋点数据无效。")
  }
  const minimum = now.getTime() - CLIENT_TELEMETRY_MAX_EVENT_AGE_MS
  const maximum = now.getTime() + CLIENT_TELEMETRY_MAX_CLOCK_SKEW_MS
  for (const event of parsed.data.events) {
    const occurredAt = Date.parse(event.occurredAt)
    if (occurredAt < minimum || occurredAt > maximum) {
      throw new BadRequestException("埋点时间无效。")
    }
  }
  return parsed.data.events
}

const telemetryStatsQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  timezoneOffsetMinutes: z.coerce.number().int().min(-840).max(840).default(0),
  identity: z.enum(["all", "authenticated", "anonymous"]).default("all"),
  userId: z.string().min(1).max(64).optional(),
  moduleId: z.string().regex(stableDimension).optional(),
  eventKey: z.string().regex(stableEventKey).optional(),
  appVersion: z.string().min(1).max(32).optional(),
  platform: z.string().min(1).max(32).optional(),
  windowType: z.string().regex(stableDimension).max(32).optional(),
}).strict()

export type ClientTelemetryStatsQuery = {
  readonly from: Date
  readonly to: Date
  readonly timezoneOffsetMinutes: number
  readonly identity: "all" | "authenticated" | "anonymous"
  readonly userId?: string
  readonly moduleId?: string
  readonly eventKey?: string
  readonly appVersion?: string
  readonly platform?: string
  readonly windowType?: string
}

export function parseClientTelemetryStatsQuery(
  input: Record<string, unknown>,
  now = new Date(),
): ClientTelemetryStatsQuery {
  const parsed = telemetryStatsQuerySchema.safeParse(input)
  if (!parsed.success) {
    throw badRequestFromZodError(parsed.error, "统计查询参数无效。")
  }
  const to = parsed.data.to ? new Date(parsed.data.to) : now
  const from = parsed.data.from
    ? new Date(parsed.data.from)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
  if (from >= to) throw new BadRequestException("统计开始时间必须早于结束时间。")
  if (to.getTime() - from.getTime() > CLIENT_TELEMETRY_RETENTION_DAYS * 24 * 60 * 60 * 1000) {
    throw new BadRequestException(`统计范围不能超过 ${CLIENT_TELEMETRY_RETENTION_DAYS} 天。`)
  }
  if (parsed.data.identity === "anonymous" && parsed.data.userId) {
    throw new BadRequestException("匿名统计不能指定用户。")
  }
  return { ...parsed.data, from, to }
}
