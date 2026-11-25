import { z } from "zod"

// Keep schema composition and JSON Schema generation on the same Zod instance.
export { z as channelZod }

const utf8Encoder = new TextEncoder()

function utf8JsonByteLength(value: unknown): number {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) return Number.POSITIVE_INFINITY
  return utf8Encoder.encode(serialized).byteLength
}

export const CHANNEL_OPEN_BASE = "/api/open/v1/channels"
export const CHANNEL_EVENT_NAME_REGEX = /^[a-zA-Z0-9._:-]{1,64}$/u
export const CHANNEL_EVENT_FILTER_REGEX = /^(?:[a-zA-Z0-9._:-]{1,64}|[a-zA-Z0-9._:-]{1,62}\.\*)$/u
export const CHANNEL_CLIENT_ID_REGEX = /^[a-zA-Z0-9._:-]{1,64}$/u
export const CHANNEL_PAYLOAD_MAX_BYTES = 65536
export const CHANNEL_META_MAX_BYTES = 2048
export const CHANNEL_WS_FRAME_MAX_BYTES = 131072
export const CHANNEL_MAX_EVENT_FILTERS = 20

export const CHANNEL_TOKEN_ROLES = ["subscribe", "publish", "pubsub"] as const
export type ChannelRole = typeof CHANNEL_TOKEN_ROLES[number]

export const CHANNEL_WS_CLOSE_CODES = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  AUTH_FAILED: 4001,
  REVOKED: 4003,
  ROLE_CHANGED: 4004,
  TIMEOUT_OR_SLOW: 4008,
  LIMIT_EXCEEDED: 4029,
} as const

export const channelJsonValueSchema = z.json().meta({ id: "ChannelJsonValue" })
export const channelRoleSchema = z.enum(CHANNEL_TOKEN_ROLES)
export const channelEventNameSchema = z.string().regex(CHANNEL_EVENT_NAME_REGEX, "事件名仅支持字母、数字及 . _ : -，最长 64 字符。")
export const channelEventFilterSchema = z.string().regex(CHANNEL_EVENT_FILTER_REGEX, "事件筛选仅支持精确事件名或尾部 .* 前缀通配。")
export const channelClientIdSchema = z.string().regex(CHANNEL_CLIENT_ID_REGEX, "clientId 仅支持字母、数字及 . _ : -，最长 64 字符。")
export const channelClientNameSchema = z.string().trim().min(1).max(64)

export const channelPayloadSchema = channelJsonValueSchema.refine(
  (value) => utf8JsonByteLength(value) <= CHANNEL_PAYLOAD_MAX_BYTES,
  "事件载荷序列化后不能超过 64 KiB。",
)

export const channelMetaSchema = z.record(z.string(), channelJsonValueSchema).refine(
  (value) => utf8JsonByteLength(value) <= CHANNEL_META_MAX_BYTES,
  "meta 序列化后不能超过 2 KiB。",
)

export const channelKeyResourcesSchema = z.object({
  mode: z.enum(["selected", "all_owned"]),
  channelIds: z.array(z.string().min(1).max(128)).max(500),
}).strict().refine(
  (value) => new Set(value.channelIds).size === value.channelIds.length && (value.mode !== "all_owned" || value.channelIds.length === 0),
  "频道资源范围无效。",
)

export const channelCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).default(""),
}).strict()

export const channelUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).optional(),
}).strict().refine(
  (value) => value.name !== undefined || value.description !== undefined,
  "至少提供一个待更新字段。",
)

export const channelTokenCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  role: channelRoleSchema,
}).strict()

function validateRetainTargetCombination(
  value: { readonly retain?: boolean; readonly targetClientId?: string },
  ctx: z.RefinementCtx,
): void {
  if (value.retain && value.targetClientId) {
    ctx.addIssue({
      code: "custom",
      path: ["retain"],
      message: "定向投递事件不允许同时启用 retain。",
    })
  }
}

export const channelPublishHttpSchema = z.object({
  event: channelEventNameSchema,
  payload: channelPayloadSchema,
  retain: z.boolean().optional().default(false),
  targetClientId: channelClientIdSchema.optional(),
  senderClientId: channelClientIdSchema.optional(),
  senderName: channelClientNameSchema.optional(),
}).strict().superRefine(validateRetainTargetCombination)

const wsRequestIdSchema = z.string().min(1).max(128)

const wsAuthFrameSchema = z.object({
  type: z.literal("auth"),
  token: z.string().min(1).max(512),
  clientId: channelClientIdSchema.optional(),
  clientName: channelClientNameSchema.optional(),
  meta: channelMetaSchema.optional(),
  events: z.array(channelEventFilterSchema).max(CHANNEL_MAX_EVENT_FILTERS).optional(),
  afterSeq: z.number().int().min(0).optional(),
  includeRetained: z.boolean().optional().default(true),
}).strict()

const wsPublishFrameSchema = z.object({
  type: z.literal("publish"),
  id: wsRequestIdSchema.optional(),
  event: channelEventNameSchema,
  payload: channelPayloadSchema,
  retain: z.boolean().optional().default(false),
  echo: z.boolean().optional().default(false),
  targetClientId: channelClientIdSchema.optional(),
}).strict().superRefine(validateRetainTargetCombination)

const wsRetainedClearFrameSchema = z.object({
  type: z.literal("retained.clear"),
  id: wsRequestIdSchema.optional(),
  event: channelEventNameSchema,
}).strict()

const wsPresenceUpdateFrameSchema = z.object({
  type: z.literal("presence.update"),
  clientName: channelClientNameSchema.optional(),
  meta: channelMetaSchema.optional(),
}).strict().refine(
  (value) => value.clientName !== undefined || value.meta !== undefined,
  "presence.update 至少需要提供 clientName 或 meta。",
)

const wsPingFrameSchema = z.object({
  type: z.literal("ping"),
}).strict()

export const channelWsClientFrameSchema = z.discriminatedUnion("type", [
  wsAuthFrameSchema,
  wsPublishFrameSchema,
  wsRetainedClearFrameSchema,
  wsPresenceUpdateFrameSchema,
  wsPingFrameSchema,
])

export const channelPresenceMemberSchema = z.object({
  connectionId: z.string().min(1),
  clientId: channelClientIdSchema,
  clientName: z.string().max(64).nullable(),
  role: channelRoleSchema,
  meta: channelMetaSchema,
  connectedAt: z.string(),
}).strict()

export const channelRetainedItemSchema = z.object({
  event: channelEventNameSchema,
  payload: channelJsonValueSchema,
  seq: z.number().int().min(0),
  senderClientId: z.string().nullable().optional(),
  senderName: z.string().nullable().optional(),
  updatedAt: z.string(),
}).strict()

export const channelEventSenderSchema = z.object({
  connectionId: z.string().nullable(),
  clientId: z.string().nullable(),
  clientName: z.string().nullable(),
}).strict()

const wsReadyServerFrameSchema = z.object({
  type: z.literal("ready"),
  channelId: z.string().min(1),
  connectionId: z.string().min(1),
  clientId: z.string().min(1),
  role: channelRoleSchema,
  latestSeq: z.number().int().min(0),
  replayTruncated: z.boolean(),
  presence: z.array(channelPresenceMemberSchema),
  retained: z.array(channelRetainedItemSchema).optional(),
}).strict()

const wsEventServerFrameSchema = z.object({
  type: z.literal("event"),
  seq: z.number().int().min(1),
  event: channelEventNameSchema,
  payload: channelJsonValueSchema,
  retain: z.boolean(),
  replayed: z.boolean(),
  targeted: z.boolean(),
  sender: channelEventSenderSchema,
  sentAt: z.string(),
}).strict()

const wsAckServerFrameSchema = z.object({
  type: z.literal("ack"),
  id: wsRequestIdSchema,
  seq: z.number().int().min(1).optional(),
  deliveredCount: z.number().int().min(0).optional(),
  retained: z.boolean().optional(),
  deleted: z.boolean().optional(),
}).strict().superRefine((value, ctx) => {
  const isPublishAck = value.seq !== undefined && value.deliveredCount !== undefined && value.retained !== undefined && value.deleted === undefined
  const isDeleteAck = value.deleted !== undefined && value.seq === undefined && value.deliveredCount === undefined && value.retained === undefined
  if (!isPublishAck && !isDeleteAck) {
    ctx.addIssue({
      code: "custom",
      message: "ack 帧必须是 publish 回执或 retained.clear 回执之一。",
    })
  }
})

const wsPresenceJoinServerFrameSchema = z.object({
  type: z.literal("presence.join"),
  member: channelPresenceMemberSchema,
}).strict()

const wsPresenceLeaveServerFrameSchema = z.object({
  type: z.literal("presence.leave"),
  member: channelPresenceMemberSchema,
}).strict()

const wsPresenceUpdateServerFrameSchema = z.object({
  type: z.literal("presence.update"),
  member: channelPresenceMemberSchema,
}).strict()

const wsPongServerFrameSchema = z.object({
  type: z.literal("pong"),
  serverTime: z.string(),
}).strict()

const wsErrorServerFrameSchema = z.object({
  type: z.literal("error"),
  id: wsRequestIdSchema.optional(),
  code: z.string().min(1),
  message: z.string().min(1),
}).strict()

export const channelWsServerFrameSchema = z.discriminatedUnion("type", [
  wsReadyServerFrameSchema,
  wsEventServerFrameSchema,
  wsAckServerFrameSchema,
  wsPresenceJoinServerFrameSchema,
  wsPresenceLeaveServerFrameSchema,
  wsPresenceUpdateServerFrameSchema,
  wsPongServerFrameSchema,
  wsErrorServerFrameSchema,
])

export function matchesChannelEventFilter(event: string, filters: readonly string[] | undefined): boolean {
  if (!filters || filters.length === 0) return true
  for (const filter of filters) {
    if (filter.endsWith(".*")) {
      const prefix = filter.slice(0, -1) // keeps trailing "."
      if (event.startsWith(prefix) && event.length > prefix.length) return true
    } else if (filter === event) {
      return true
    }
  }
  return false
}

export type ChannelKeyResources = z.infer<typeof channelKeyResourcesSchema>
export type ChannelCreateInput = z.infer<typeof channelCreateSchema>
export type ChannelUpdateInput = z.infer<typeof channelUpdateSchema>
export type ChannelTokenCreateInput = z.infer<typeof channelTokenCreateSchema>
export type ChannelPublishHttpInput = z.infer<typeof channelPublishHttpSchema>
export type ChannelWsClientFrame = z.infer<typeof channelWsClientFrameSchema>
export type ChannelWsServerFrame = z.infer<typeof channelWsServerFrameSchema>
export type ChannelPresenceMember = z.infer<typeof channelPresenceMemberSchema>
export type ChannelRetainedItem = z.infer<typeof channelRetainedItemSchema>
export type ChannelEventSender = z.infer<typeof channelEventSenderSchema>
