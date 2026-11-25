import {
  channelCreateSchema,
  channelPresenceMemberSchema,
  channelPublishHttpSchema,
  channelRetainedItemSchema,
  channelTokenCreateSchema,
  channelUpdateSchema,
  channelZod as z,
} from "@synapse/shared/channel-contracts"
import {
  CHANNELS_MANAGE_SCOPE,
  CHANNELS_PUBLISH_SCOPE,
  CHANNELS_SUBSCRIBE_SCOPE,
} from "../api-keys/api-key-capabilities"

export const CHANNEL_JSON_SCHEMA = {
  oneOf: [
    { type: "string" },
    { type: "number" },
    { type: "boolean" },
    { type: "null" },
    { type: "array", items: { $ref: "#/components/schemas/ChannelJsonValue" } },
    { type: "object", additionalProperties: { $ref: "#/components/schemas/ChannelJsonValue" } },
  ],
} as const

function toSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _dialect, $defs: _localDefs, ...rest } = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>
  return JSON.parse(JSON.stringify(rest, (key, value: unknown) => {
    if (key === "$ref" && typeof value === "string" && value.startsWith("#/$defs/")) {
      if (!["#/$defs/ChannelJsonValue", "#/$defs/__schema0"].includes(value)) {
        throw new Error(`Unexpected channel schema reference: ${value}`)
      }
      return "#/components/schemas/ChannelJsonValue"
    }
    return value
  })) as Record<string, unknown>
}

const commonHeaders = {
  "X-Request-Id": { $ref: "#/components/headers/RequestId" },
  "Cache-Control": { $ref: "#/components/headers/NoStore" },
} as const

const channelErrorSchema = {
  type: "object",
  required: ["requestId", "error"],
  additionalProperties: false,
  properties: {
    requestId: { type: "string" },
    error: {
      type: "object",
      required: ["code", "message"],
      additionalProperties: false,
      properties: {
        code: {
          type: "string",
          enum: [
            "INVALID_REQUEST",
            "INVALID_CREDENTIAL",
            "INSUFFICIENT_SCOPE",
            "CHANNEL_ACCESS_DENIED",
            "CHANNEL_NOT_FOUND",
            "TOKEN_LIMIT_EXCEEDED",
            "TOKEN_NOT_FOUND",
            "FORBIDDEN_ROLE",
            "REQUEST_TOO_LARGE",
            "RETAIN_LIMIT_EXCEEDED",
            "RATE_LIMITED",
            "INTERNAL_ERROR",
          ],
        },
        message: { type: "string" },
      },
    },
  },
} as const

const errorRes = (description: string) => ({
  description,
  headers: commonHeaders,
  content: { "application/json": { schema: channelErrorSchema } },
})

const jsonRes = (description: string, schema: Record<string, unknown>) => ({
  description,
  headers: commonHeaders,
  content: { "application/json": { schema } },
})

const channelSummarySchema = {
  type: "object",
  required: ["id", "name", "description", "onlineCount", "tokenCount", "createdAt", "updatedAt"],
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    onlineCount: { type: "integer", minimum: 0 },
    tokenCount: { type: "integer", minimum: 0 },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const

const channelTokenSchema = {
  type: "object",
  required: ["id", "channelId", "name", "role", "prefix", "lastUsedAt", "createdAt"],
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    channelId: { type: "string" },
    name: { type: "string" },
    role: { type: "string", enum: ["subscribe", "publish", "pubsub"] },
    prefix: { type: "string" },
    lastUsedAt: { oneOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
    createdAt: { type: "string", format: "date-time" },
  },
} as const

const channelIdParam = {
  name: "channelId",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "频道 ID。",
} as const

export function channelOpenApiPaths() {
  const createBody = toSchema(channelCreateSchema)
  const updateBody = toSchema(channelUpdateSchema)
  const tokenCreateBody = toSchema(channelTokenCreateSchema)
  const publishBody = toSchema(channelPublishHttpSchema)
  const presenceMemberSchema = toSchema(channelPresenceMemberSchema)
  const retainedItemSchema = toSchema(channelRetainedItemSchema)

  return {
    "/channels": {
      get: {
        tags: ["Channels"],
        summary: "列出可见频道",
        operationId: "listChannels",
        security: [{ ApiKeyBearer: [] }],
        responses: {
          "200": jsonRes("频道目录列表。", {
            type: "object",
            required: ["data"],
            properties: { data: { type: "array", items: channelSummarySchema } },
          }),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("权限不足（INSUFFICIENT_SCOPE）。"),
        },
      },
      post: {
        tags: ["Channels"],
        summary: "创建频道",
        operationId: "createChannel",
        security: [{ ApiKeyBearer: [] }],
        "x-required-scope": CHANNELS_MANAGE_SCOPE,
        requestBody: {
          required: true,
          content: { "application/json": { schema: createBody } },
        },
        responses: {
          "201": jsonRes("已创建频道。", channelSummarySchema),
          "400": errorRes("请求体无效（INVALID_REQUEST）。"),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("需要 channels.manage 与“全部自有频道”范围（INSUFFICIENT_SCOPE）。"),
        },
      },
    },
    "/channels/{channelId}": {
      parameters: [channelIdParam],
      get: {
        tags: ["Channels"],
        summary: "读取频道详情",
        operationId: "getChannel",
        security: [{ ApiKeyBearer: [] }],
        responses: {
          "200": jsonRes("频道详情。", channelSummarySchema),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("无权访问该频道（CHANNEL_ACCESS_DENIED / INSUFFICIENT_SCOPE）。"),
          "404": errorRes("频道不存在（CHANNEL_NOT_FOUND）。"),
        },
      },
      patch: {
        tags: ["Channels"],
        summary: "更新频道名称或说明",
        operationId: "updateChannel",
        security: [{ ApiKeyBearer: [] }],
        "x-required-scope": CHANNELS_MANAGE_SCOPE,
        requestBody: {
          required: true,
          content: { "application/json": { schema: updateBody } },
        },
        responses: {
          "200": jsonRes("更新后的频道详情。", channelSummarySchema),
          "400": errorRes("请求体无效（INVALID_REQUEST）。"),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("权限不足（INSUFFICIENT_SCOPE / CHANNEL_ACCESS_DENIED）。"),
          "404": errorRes("频道不存在（CHANNEL_NOT_FOUND）。"),
        },
      },
      delete: {
        tags: ["Channels"],
        summary: "删除频道并断开全部连接",
        operationId: "deleteChannel",
        security: [{ ApiKeyBearer: [] }],
        "x-required-scope": CHANNELS_MANAGE_SCOPE,
        responses: {
          "200": jsonRes("已删除频道。", { type: "object", required: ["deleted"], properties: { deleted: { type: "boolean", const: true } } }),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("权限不足（INSUFFICIENT_SCOPE / CHANNEL_ACCESS_DENIED）。"),
          "404": errorRes("频道不存在（CHANNEL_NOT_FOUND）。"),
        },
      },
    },
    "/channels/{channelId}/tokens": {
      parameters: [channelIdParam],
      get: {
        tags: ["Channels"],
        summary: "列出频道有效凭证",
        operationId: "listChannelTokens",
        security: [{ ApiKeyBearer: [] }],
        "x-required-scope": CHANNELS_MANAGE_SCOPE,
        responses: {
          "200": jsonRes("凭证列表（不含明文）。", {
            type: "object",
            required: ["data"],
            properties: { data: { type: "array", items: channelTokenSchema } },
          }),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("权限不足（INSUFFICIENT_SCOPE / CHANNEL_ACCESS_DENIED）。"),
          "404": errorRes("频道不存在（CHANNEL_NOT_FOUND）。"),
        },
      },
      post: {
        tags: ["Channels"],
        summary: "签发频道专属凭证",
        operationId: "createChannelToken",
        security: [{ ApiKeyBearer: [] }],
        "x-required-scope": CHANNELS_MANAGE_SCOPE,
        requestBody: {
          required: true,
          content: { "application/json": { schema: tokenCreateBody } },
        },
        responses: {
          "201": jsonRes("新凭证（明文 secret 仅返回一次）。", {
            type: "object",
            required: ["token", "secret"],
            properties: { token: channelTokenSchema, secret: { type: "string" } },
          }),
          "400": errorRes("请求体无效（INVALID_REQUEST）。"),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("权限不足（INSUFFICIENT_SCOPE / CHANNEL_ACCESS_DENIED）。"),
          "404": errorRes("频道不存在（CHANNEL_NOT_FOUND）。"),
          "422": errorRes("超出单频道 20 个有效凭证上限（TOKEN_LIMIT_EXCEEDED）。"),
        },
      },
    },
    "/channels/{channelId}/tokens/{tokenId}": {
      parameters: [
        channelIdParam,
        { name: "tokenId", in: "path", required: true, schema: { type: "string" }, description: "凭证 ID。" },
      ],
      delete: {
        tags: ["Channels"],
        summary: "撤销频道专属凭证并踢断对应连接",
        operationId: "revokeChannelToken",
        security: [{ ApiKeyBearer: [] }],
        "x-required-scope": CHANNELS_MANAGE_SCOPE,
        responses: {
          "200": jsonRes("已撤销凭证。", { type: "object", required: ["revoked"], properties: { revoked: { type: "boolean", const: true } } }),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("权限不足（INSUFFICIENT_SCOPE / CHANNEL_ACCESS_DENIED）。"),
          "404": errorRes("凭证不存在或已撤销（TOKEN_NOT_FOUND）。"),
        },
      },
    },
    "/channels/{channelId}/events": {
      parameters: [channelIdParam],
      post: {
        tags: ["Channels"],
        summary: "无状态发布频道实时事件",
        operationId: "publishChannelEvent",
        security: [{ ApiKeyBearer: [] }],
        "x-required-scope": CHANNELS_PUBLISH_SCOPE,
        requestBody: {
          required: true,
          content: { "application/json": { schema: publishBody } },
        },
        responses: {
          "200": jsonRes("事件已投递。", {
            type: "object",
            required: ["seq", "deliveredCount", "retained", "sentAt"],
            properties: {
              seq: { type: "integer", minimum: 1 },
              deliveredCount: { type: "integer", minimum: 0 },
              retained: { type: "boolean" },
              sentAt: { type: "string", format: "date-time" },
            },
          }),
          "400": errorRes("事件参数无效或同时启用了 retain 与 targetClientId（INVALID_REQUEST）。"),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("角色或权限不足（FORBIDDEN_ROLE / INSUFFICIENT_SCOPE）。"),
          "404": errorRes("频道不存在（CHANNEL_NOT_FOUND）。"),
          "413": errorRes("请求体超过 128 KiB（REQUEST_TOO_LARGE）。"),
          "422": errorRes("超出单频道 20 个 Retain 事件上限（RETAIN_LIMIT_EXCEEDED）。"),
          "429": errorRes("发布过于频繁（RATE_LIMITED，响应头含 Retry-After）。"),
        },
      },
    },
    "/channels/{channelId}/presence": {
      parameters: [channelIdParam],
      get: {
        tags: ["Channels"],
        summary: "读取频道当前在线成员",
        operationId: "getChannelPresence",
        security: [{ ApiKeyBearer: [] }],
        responses: {
          "200": jsonRes("当前在线连接列表（不含隐身调试台）。", {
            type: "object",
            required: ["channelId", "count", "members"],
            properties: {
              channelId: { type: "string" },
              count: { type: "integer", minimum: 0 },
              members: { type: "array", items: presenceMemberSchema },
            },
          }),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("无权访问（CHANNEL_ACCESS_DENIED / INSUFFICIENT_SCOPE）。"),
          "404": errorRes("频道不存在（CHANNEL_NOT_FOUND）。"),
        },
      },
    },
    "/channels/{channelId}/retained": {
      parameters: [channelIdParam],
      get: {
        tags: ["Channels"],
        summary: "读取频道 Retain 最新状态快照",
        operationId: "listChannelRetained",
        security: [{ ApiKeyBearer: [] }],
        "x-required-scope": CHANNELS_SUBSCRIBE_SCOPE,
        responses: {
          "200": jsonRes("当前保留的最新状态快照列表。", {
            type: "object",
            required: ["channelId", "items"],
            properties: {
              channelId: { type: "string" },
              items: { type: "array", items: retainedItemSchema },
            },
          }),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("仅发布角色不可读取 Retain（FORBIDDEN_ROLE / INSUFFICIENT_SCOPE）。"),
          "404": errorRes("频道不存在（CHANNEL_NOT_FOUND）。"),
        },
      },
    },
    "/channels/{channelId}/retained/{event}": {
      parameters: [
        channelIdParam,
        { name: "event", in: "path", required: true, schema: { type: "string" }, description: "待清除的 Retain 事件名。" },
      ],
      delete: {
        tags: ["Channels"],
        summary: "静默清除指定事件名的 Retain 快照",
        operationId: "clearChannelRetained",
        security: [{ ApiKeyBearer: [] }],
        "x-required-scope": CHANNELS_PUBLISH_SCOPE,
        responses: {
          "200": jsonRes("清除结果（静默删除，不广播事件帧）。", {
            type: "object",
            required: ["deleted"],
            properties: { deleted: { type: "boolean" } },
          }),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("仅订阅角色不可清除 Retain（FORBIDDEN_ROLE / INSUFFICIENT_SCOPE）。"),
          "404": errorRes("频道不存在（CHANNEL_NOT_FOUND）。"),
        },
      },
    },
  } as const
}
