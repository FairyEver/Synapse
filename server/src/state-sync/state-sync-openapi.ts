import {
  stateSyncPresenceMemberSchema,
  stateSyncSpaceCreateSchema,
  stateSyncSpaceUpdateSchema,
  stateSyncTokenCreateSchema,
  stateSyncZod as z,
} from "@synapse/shared/state-sync-contracts"
import {
  STATE_SYNC_MANAGE_SCOPE,
  STATE_SYNC_READ_SCOPE,
  STATE_SYNC_WRITE_SCOPE,
} from "../api-keys/api-key-capabilities"

export const STATE_SYNC_JSON_SCHEMA = {
  oneOf: [
    { type: "string" },
    { type: "number" },
    { type: "boolean" },
    { type: "null" },
    { type: "array", items: { $ref: "#/components/schemas/StateSyncJsonValue" } },
    { type: "object", additionalProperties: { $ref: "#/components/schemas/StateSyncJsonValue" } },
  ],
} as const

export const STATE_SYNC_OPEN_API_SCHEMAS = {
  StateSyncJsonValue: STATE_SYNC_JSON_SCHEMA,
} as const

function toSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _dialect, $defs: _localDefs, ...rest } = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>
  return JSON.parse(JSON.stringify(rest, (key, value: unknown) => {
    if (key === "$ref" && typeof value === "string" && value.startsWith("#/$defs/")) {
      return "#/components/schemas/StateSyncJsonValue"
    }
    return value
  })) as Record<string, unknown>
}

const commonHeaders = {
  "X-Request-Id": { $ref: "#/components/headers/RequestId" },
  "Cache-Control": { $ref: "#/components/headers/NoStore" },
} as const

const stateSyncErrorSchema = {
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
            "SPACE_ACCESS_DENIED",
            "SPACE_NOT_FOUND",
            "TOKEN_LIMIT_EXCEEDED",
            "TOKEN_NOT_FOUND",
            "FORBIDDEN_ROLE",
            "DOC_NOT_FOUND",
            "DOC_ALREADY_EXISTS",
            "DOC_LIMIT_EXCEEDED",
            "TTL_POLICY_VIOLATION",
            "REV_CONFLICT",
            "PATH_CONFLICT",
            "REQUEST_TOO_LARGE",
            "DOC_TOO_LARGE",
            "PAYLOAD_TOO_LARGE",
            "RATE_LIMITED",
            "SHUTTING_DOWN",
            "PERSIST_FAILED",
            "INTERNAL_ERROR",
          ],
        },
        message: { type: "string" },
        currentRev: {
          type: "integer",
          minimum: 0,
          description: "REV_CONFLICT 时返回的服务端当前最新版本号。",
        },
      },
    },
  },
} as const

const errorRes = (description: string, extraHeaders?: Record<string, unknown>) => ({
  description,
  headers: {
    ...commonHeaders,
    ...extraHeaders,
  },
  content: { "application/json": { schema: stateSyncErrorSchema } },
})

const rateLimitedRes = (description = "请求过于频繁（RATE_LIMITED，响应头含 Retry-After）。") =>
  errorRes(description, {
    "Retry-After": {
      description: "限流恢复前需等待的秒数。",
      schema: { type: "integer", minimum: 1 },
    },
  })

const jsonRes = (description: string, schema: Record<string, unknown>) => ({
  description,
  headers: commonHeaders,
  content: { "application/json": { schema } },
})

const spaceSummarySchema = {
  type: "object",
  required: [
    "id",
    "name",
    "description",
    "defaultDocTtlSeconds",
    "maxDocs",
    "docCount",
    "onlineCount",
    "tokenCount",
    "createdAt",
    "updatedAt",
  ],
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    defaultDocTtlSeconds: { oneOf: [{ type: "integer" }, { type: "null" }] },
    maxDocs: { type: "integer", minimum: 1 },
    docCount: { type: "integer", minimum: 0 },
    onlineCount: { type: "integer", minimum: 0 },
    tokenCount: { type: "integer", minimum: 0 },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const

const tokenSummarySchema = {
  type: "object",
  required: ["id", "spaceId", "name", "role", "prefix", "lastUsedAt", "createdAt"],
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    spaceId: { type: "string" },
    name: { type: "string" },
    role: { type: "string", enum: ["read", "write", "create_write"] },
    prefix: { type: "string" },
    lastUsedAt: { oneOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
    createdAt: { type: "string", format: "date-time" },
  },
} as const

const docSummarySchema = {
  type: "object",
  required: ["spaceId", "docId", "rev", "onlineCount", "ttlSeconds", "expiresAt", "createdAt", "updatedAt"],
  additionalProperties: false,
  properties: {
    spaceId: { type: "string" },
    docId: { type: "string" },
    rev: { type: "integer", minimum: 0 },
    onlineCount: { type: "integer", minimum: 0 },
    ttlSeconds: { oneOf: [{ type: "integer" }, { type: "null" }] },
    expiresAt: { oneOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const

const spaceIdParam = {
  name: "spaceId",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "同步空间 ID。",
} as const

const docIdParam = {
  name: "docId",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "房间（文档）ID。",
} as const

export function stateSyncOpenApiPaths() {
  const createSpaceBody = toSchema(stateSyncSpaceCreateSchema)
  const updateSpaceBody = toSchema(stateSyncSpaceUpdateSchema)
  const createTokenBody = toSchema(stateSyncTokenCreateSchema)
  const presenceMemberSchema = toSchema(stateSyncPresenceMemberSchema)

  const docCreateBody = {
    type: "object",
    additionalProperties: false,
    properties: {
      docId: {
        type: "string",
        pattern: "^[a-zA-Z0-9._:-]{3,64}$",
        description: "自定义房间 ID（仅具备管理权限时生效，否则留空自动生成）。",
      },
      initialData: {
        type: "object",
        additionalProperties: { $ref: "#/components/schemas/StateSyncJsonValue" },
        description: "房间初始数据，必须为普通 JSON 对象，最大 256 KiB。",
      },
      ttlSeconds: {
        oneOf: [
          { type: "integer", minimum: 60, maximum: 2592000 },
          { type: "null" },
        ],
        description: "房间生存时间（秒）；默认使用空间配置（86400 秒），传 null 表示永不过期（需管理权限）。",
      },
    },
  } as const

  const mutateDocBody = {
    type: "object",
    required: ["op", "path"],
    additionalProperties: false,
    properties: {
      op: { type: "string", enum: ["set", "patch", "delete"] },
      path: { type: "string", description: "以 / 开头的状态路径，深度最多 16 层。" },
      value: {
        $ref: "#/components/schemas/StateSyncJsonValue",
        description: "更新值（set/patch 必需；patch 须为对象；最大 64 KiB）。",
      },
      expectedRev: {
        type: "integer",
        minimum: 0,
        description: "乐观并发控制版本号；与服务端不一致时返回 409 REV_CONFLICT 及当前版本号。",
      },
      actorClientId: { type: "string", pattern: "^[a-zA-Z0-9._:-]{1,64}$" },
      actorName: { type: "string", minLength: 1, maxLength: 64 },
    },
  } as const

  return {
    "/state-sync/spaces": {
      get: {
        tags: ["State Sync"],
        summary: "列出可见同步空间",
        operationId: "listStateSyncSpaces",
        security: [{ ApiKeyBearer: [] }],
        "x-required-scope": STATE_SYNC_MANAGE_SCOPE,
        responses: {
          "200": jsonRes("同步空间列表。", {
            type: "object",
            required: ["data"],
            properties: { data: { type: "array", items: spaceSummarySchema } },
          }),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("权限不足（INSUFFICIENT_SCOPE）。"),
        },
      },
      post: {
        tags: ["State Sync"],
        summary: "创建同步空间",
        operationId: "createStateSyncSpace",
        security: [{ ApiKeyBearer: [] }],
        "x-required-scope": STATE_SYNC_MANAGE_SCOPE,
        requestBody: {
          required: true,
          content: { "application/json": { schema: createSpaceBody } },
        },
        responses: {
          "201": jsonRes("已创建同步空间。", spaceSummarySchema),
          "400": errorRes("请求体无效（INVALID_REQUEST）。"),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("需要 state_sync.manage 与“全部自有空间”范围（INSUFFICIENT_SCOPE）。"),
        },
      },
    },
    "/state-sync/spaces/{spaceId}": {
      parameters: [spaceIdParam],
      get: {
        tags: ["State Sync"],
        summary: "读取同步空间详情",
        operationId: "getStateSyncSpace",
        security: [{ ApiKeyBearer: [] }],
        "x-required-scope": STATE_SYNC_MANAGE_SCOPE,
        responses: {
          "200": jsonRes("同步空间详情。", spaceSummarySchema),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("无权访问该同步空间（SPACE_ACCESS_DENIED / INSUFFICIENT_SCOPE）。"),
          "404": errorRes("同步空间不存在（SPACE_NOT_FOUND）。"),
        },
      },
      patch: {
        tags: ["State Sync"],
        summary: "更新同步空间配置",
        operationId: "updateStateSyncSpace",
        security: [{ ApiKeyBearer: [] }],
        "x-required-scope": STATE_SYNC_MANAGE_SCOPE,
        requestBody: {
          required: true,
          content: { "application/json": { schema: updateSpaceBody } },
        },
        responses: {
          "200": jsonRes("更新后的同步空间详情。", spaceSummarySchema),
          "400": errorRes("请求体无效（INVALID_REQUEST）。"),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("权限不足（INSUFFICIENT_SCOPE / SPACE_ACCESS_DENIED）。"),
          "404": errorRes("同步空间不存在（SPACE_NOT_FOUND）。"),
        },
      },
      delete: {
        tags: ["State Sync"],
        summary: "删除同步空间并断开全部连接",
        operationId: "deleteStateSyncSpace",
        security: [{ ApiKeyBearer: [] }],
        "x-required-scope": STATE_SYNC_MANAGE_SCOPE,
        responses: {
          "200": jsonRes("已删除同步空间。", {
            type: "object",
            required: ["deleted"],
            properties: { deleted: { type: "boolean", const: true } },
          }),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("权限不足（INSUFFICIENT_SCOPE / SPACE_ACCESS_DENIED）。"),
          "404": errorRes("同步空间不存在（SPACE_NOT_FOUND）。"),
        },
      },
    },
    "/state-sync/spaces/{spaceId}/tokens": {
      parameters: [spaceIdParam],
      get: {
        tags: ["State Sync"],
        summary: "列出空间有效凭证",
        operationId: "listStateSyncTokens",
        security: [{ ApiKeyBearer: [] }],
        "x-required-scope": STATE_SYNC_MANAGE_SCOPE,
        responses: {
          "200": jsonRes("凭证列表（不含明文密钥）。", {
            type: "object",
            required: ["data"],
            properties: { data: { type: "array", items: tokenSummarySchema } },
          }),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("权限不足（INSUFFICIENT_SCOPE / SPACE_ACCESS_DENIED）。"),
          "404": errorRes("同步空间不存在（SPACE_NOT_FOUND）。"),
        },
      },
      post: {
        tags: ["State Sync"],
        summary: "签发空间专属凭证",
        operationId: "createStateSyncToken",
        security: [{ ApiKeyBearer: [] }],
        "x-required-scope": STATE_SYNC_MANAGE_SCOPE,
        requestBody: {
          required: true,
          content: { "application/json": { schema: createTokenBody } },
        },
        responses: {
          "201": jsonRes("新凭证（明文 secret 仅返回一次）。", {
            type: "object",
            required: ["token", "secret"],
            properties: { token: tokenSummarySchema, secret: { type: "string" } },
          }),
          "400": errorRes("请求体无效（INVALID_REQUEST）。"),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("权限不足（INSUFFICIENT_SCOPE / SPACE_ACCESS_DENIED）。"),
          "404": errorRes("同步空间不存在（SPACE_NOT_FOUND）。"),
          "422": errorRes("超出单空间凭证上限（TOKEN_LIMIT_EXCEEDED）。"),
        },
      },
    },
    "/state-sync/spaces/{spaceId}/tokens/{tokenId}": {
      parameters: [
        spaceIdParam,
        { name: "tokenId", in: "path", required: true, schema: { type: "string" }, description: "凭证 ID。" },
      ],
      delete: {
        tags: ["State Sync"],
        summary: "撤销空间专属凭证并踢断对应连接",
        operationId: "revokeStateSyncToken",
        security: [{ ApiKeyBearer: [] }],
        "x-required-scope": STATE_SYNC_MANAGE_SCOPE,
        responses: {
          "200": jsonRes("已撤销凭证。", {
            type: "object",
            required: ["revoked"],
            properties: { revoked: { type: "boolean", const: true } },
          }),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("权限不足（INSUFFICIENT_SCOPE / SPACE_ACCESS_DENIED）。"),
          "404": errorRes("凭证不存在或已撤销（TOKEN_NOT_FOUND）。"),
        },
      },
    },
    "/state-sync/spaces/{spaceId}/docs": {
      parameters: [spaceIdParam],
      get: {
        tags: ["State Sync"],
        summary: "列出空间内未过期房间",
        operationId: "listStateSyncDocs",
        security: [{ ApiKeyBearer: [] }],
        "x-required-scope": STATE_SYNC_MANAGE_SCOPE,
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200 }, description: "每页数量。" },
          { name: "cursor", in: "query", schema: { type: "string" }, description: "分页游标（上一页最后一条 docId）。" },
        ],
        responses: {
          "200": jsonRes("房间列表。", {
            type: "object",
            required: ["data", "nextCursor"],
            properties: {
              data: { type: "array", items: docSummarySchema },
              nextCursor: { oneOf: [{ type: "string" }, { type: "null" }] },
            },
          }),
          "400": errorRes("请求参数无效（INVALID_REQUEST）。"),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("权限不足（INSUFFICIENT_SCOPE / SPACE_ACCESS_DENIED）。"),
          "404": errorRes("同步空间不存在（SPACE_NOT_FOUND）。"),
        },
      },
      post: {
        tags: ["State Sync"],
        summary: "创建房间并初始化状态",
        operationId: "createStateSyncDoc",
        security: [{ ApiKeyBearer: [] }],
        requestBody: {
          required: false,
          content: { "application/json": { schema: docCreateBody } },
        },
        responses: {
          "201": jsonRes("房间创建成功，返回版本号与 WebSocket 路径。", {
            type: "object",
            required: ["spaceId", "docId", "rev", "expiresAt", "wsPath"],
            properties: {
              spaceId: { type: "string" },
              docId: { type: "string" },
              rev: { type: "integer", minimum: 0 },
              expiresAt: { oneOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
              wsPath: { type: "string" },
            },
          }),
          "400": errorRes("房间参数无效（INVALID_REQUEST）。"),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("角色或权限不足（FORBIDDEN_ROLE / INSUFFICIENT_SCOPE / TTL_POLICY_VIOLATION）。"),
          "404": errorRes("同步空间不存在（SPACE_NOT_FOUND）。"),
          "409": errorRes("房间 ID 已存在（DOC_ALREADY_EXISTS）。"),
          "413": errorRes("初始数据超过 256 KiB 上限（REQUEST_TOO_LARGE / DOC_TOO_LARGE）。"),
          "422": errorRes("超出空间未过期房间配额上限（DOC_LIMIT_EXCEEDED）。"),
          "429": rateLimitedRes(),
        },
      },
    },
    "/state-sync/spaces/{spaceId}/docs/{docId}": {
      parameters: [docIdParam, spaceIdParam],
      get: {
        tags: ["State Sync"],
        summary: "读取房间指定路径的最新状态快照",
        operationId: "getStateSyncDoc",
        security: [{ ApiKeyBearer: [] }],
        "x-required-scope": STATE_SYNC_READ_SCOPE,
        parameters: [
          { name: "path", in: "query", schema: { type: "string" }, description: "目标路径，默认 / 根路径。" },
        ],
        responses: {
          "200": jsonRes("状态快照与版本号。", {
            type: "object",
            required: ["spaceId", "docId", "path", "exists", "value", "rev", "expiresAt"],
            properties: {
              spaceId: { type: "string" },
              docId: { type: "string" },
              path: { type: "string" },
              exists: { type: "boolean" },
              value: { $ref: "#/components/schemas/StateSyncJsonValue" },
              rev: { type: "integer", minimum: 0 },
              expiresAt: { oneOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
            },
          }),
          "400": errorRes("路径格式无效（INVALID_REQUEST）。"),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("权限不足（INSUFFICIENT_SCOPE / SPACE_ACCESS_DENIED）。"),
          "404": errorRes("房间不存在或已过期（DOC_NOT_FOUND）。"),
        },
      },
      patch: {
        tags: ["State Sync"],
        summary: "变更房间状态（支持 CAS 乐观并发控制）",
        operationId: "mutateStateSyncDoc",
        security: [{ ApiKeyBearer: [] }],
        "x-required-scope": STATE_SYNC_WRITE_SCOPE,
        requestBody: {
          required: true,
          content: { "application/json": { schema: mutateDocBody } },
        },
        responses: {
          "200": jsonRes("状态变更已提交，返回新版本号与是否有变化。", {
            type: "object",
            required: ["rev", "changed", "expiresAt"],
            properties: {
              rev: { type: "integer", minimum: 0 },
              changed: { type: "boolean" },
              expiresAt: { oneOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
            },
          }),
          "400": errorRes("变更参数无效（INVALID_REQUEST）。"),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("角色或权限不足（FORBIDDEN_ROLE / INSUFFICIENT_SCOPE / SPACE_ACCESS_DENIED）。"),
          "404": errorRes("房间不存在或已过期（DOC_NOT_FOUND）。"),
          "409": errorRes("版本冲突（REV_CONFLICT，包含 currentRev）或路径冲突（PATH_CONFLICT）。"),
          "413": errorRes("写入载荷超限 64 KiB 或文档总大小超限 256 KiB（REQUEST_TOO_LARGE / DOC_TOO_LARGE / PAYLOAD_TOO_LARGE）。"),
          "429": rateLimitedRes(),
        },
      },
      delete: {
        tags: ["State Sync"],
        summary: "删除房间并断开全部连接",
        operationId: "deleteStateSyncDoc",
        security: [{ ApiKeyBearer: [] }],
        "x-required-scope": STATE_SYNC_MANAGE_SCOPE,
        responses: {
          "200": jsonRes("已删除房间。", {
            type: "object",
            required: ["deleted"],
            properties: { deleted: { type: "boolean", const: true } },
          }),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("权限不足（INSUFFICIENT_SCOPE / SPACE_ACCESS_DENIED）。"),
          "404": errorRes("房间不存在（DOC_NOT_FOUND）。"),
        },
      },
    },
    "/state-sync/spaces/{spaceId}/docs/{docId}/presence": {
      parameters: [docIdParam, spaceIdParam],
      get: {
        tags: ["State Sync"],
        summary: "读取房间当前在线成员",
        operationId: "getStateSyncPresence",
        security: [{ ApiKeyBearer: [] }],
        responses: {
          "200": jsonRes("当前在线成员列表。", {
            type: "object",
            required: ["spaceId", "docId", "count", "members"],
            properties: {
              spaceId: { type: "string" },
              docId: { type: "string" },
              count: { type: "integer", minimum: 0 },
              members: { type: "array", items: presenceMemberSchema },
            },
          }),
          "401": errorRes("凭证无效（INVALID_CREDENTIAL）。"),
          "403": errorRes("权限不足（INSUFFICIENT_SCOPE / SPACE_ACCESS_DENIED）。"),
          "404": errorRes("房间不存在或已过期（DOC_NOT_FOUND）。"),
        },
      },
    },
  } as const
}

export const STATE_SYNC_OPEN_API_PATHS = stateSyncOpenApiPaths()
