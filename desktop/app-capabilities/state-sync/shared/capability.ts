import {
  STATE_SYNC_DOC_MAX_BYTES,
  STATE_SYNC_TTL_MAX_SECONDS,
  STATE_SYNC_TTL_MIN_SECONDS,
  refineStateSyncMutation,
  stateSyncCustomDocIdSchema,
  stateSyncMutateHttpSchema,
  stateSyncPathSchema,
  stateSyncSpaceCreateSchema,
  stateSyncSpaceUpdateSchema,
  stateSyncTokenCreateSchema,
  stateSyncZod as z,
  validateStateSyncJsonValue,
} from "@synapse/shared/state-sync-contracts"
import type { CapabilityDomainDefinition, McpToolDefinition } from "../../../synapse-capabilities/shared/types"

const spacePath = "/spaces/:spaceId"
const tokensPath = "/spaces/:spaceId/tokens"
const tokenPath = "/spaces/:spaceId/tokens/:tokenId"
const docsPath = "/spaces/:spaceId/docs"
const docPath = "/spaces/:spaceId/docs/:docId"

const pathId = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u)
const docPathId = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/u).refine(
  (value) => value !== "." && value !== ".." && !value.includes(".."),
  "房间 ID 不能包含路径穿越段。",
)

const stateSyncDocCreateBodySchema = z.object({
  docId: stateSyncCustomDocIdSchema
    .optional()
    .describe("Optional custom room/document ID (3-64 chars: letters, digits, . _ : -). Omit to let the server generate an ssd_ ID."),
  initialData: z.record(z.string(), z.unknown())
    .optional()
    .describe("Optional initial root JSON object for the room (max 256 KiB).")
    .superRefine((val, ctx) => {
      if (val === undefined) return
      const res = validateStateSyncJsonValue(val, {
        requirePlainObject: true,
        maxBytes: STATE_SYNC_DOC_MAX_BYTES,
      })
      if (!res.ok) {
        ctx.addIssue({
          code: "custom",
          message: res.message,
        })
      }
    }),
  ttlSeconds: z.number()
    .int()
    .min(STATE_SYNC_TTL_MIN_SECONDS)
    .max(STATE_SYNC_TTL_MAX_SECONDS)
    .nullable()
    .optional()
    .describe("Optional room TTL in seconds (60-2592000), or null for no expiration. Defaults to the space setting."),
}).strict()

type OperationOptions = {
  body?: z.ZodObject<z.ZodRawShape>
  query?: Record<string, z.ZodTypeAny>
  mutates?: boolean
}

function operation(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  title: string,
  description: string,
  options: OperationOptions = {},
) {
  const baseShape: Record<string, z.ZodTypeAny> = {
    ...(options.body?.shape ?? {}),
    ...(options.query ?? {}),
    ...(path.includes(":spaceId") ? { spaceId: pathId.describe("State sync space ID from space list or create result.") } : {}),
    ...(path.includes(":tokenId") ? { tokenId: pathId.describe("Space token ID from token list or create result.") } : {}),
    ...(path.includes(":docId") ? { docId: docPathId.describe("Room/document ID inside the state sync space.") } : {}),
  }
  let input: z.ZodTypeAny = z.strictObject(baseShape)
  if (options.body === stateSyncSpaceUpdateSchema) {
    input = input.refine(
      (value) => {
        const record = value as {
          name?: unknown
          description?: unknown
          defaultDocTtlSeconds?: unknown
          maxDocs?: unknown
        }
        return (
          record.name !== undefined
          || record.description !== undefined
          || record.defaultDocTtlSeconds !== undefined
          || record.maxDocs !== undefined
        )
      },
      "至少提供一个待更新字段。",
    )
  }
  if (options.body === stateSyncMutateHttpSchema) {
    input = input.superRefine((value, ctx) => {
      const record = value as { op: "set" | "patch" | "delete"; path: string; value?: unknown }
      refineStateSyncMutation(record, ctx)
    })
  }
  return { method, path, title, description, input, ...options }
}

export const stateSyncOperations = {
  "app.state_sync.publish_preflight.get": operation(
    "GET",
    "/preflight",
    "状态同步发布前检查",
    "Before creating a state sync space or generating zero-backend multiplayer games/collaborative webpages (状态同步、多人联机小游戏、共享 JSON 状态树、野狗、SDK 链接/版本), check the signed-in account, public HTTP/WS base URLs, audience (local_only, public, or environment_mismatch), sdkManifestUrl (/sdk/manifest.json), latestStateSyncSdkVersion, and ready-to-use SDK script URLs. Does not create or mutate resources.",
  ),
  "app.state_sync.space.list": operation(
    "GET",
    "/spaces",
    "列出同步空间",
    "List all state sync spaces (同步空间) owned by the signed-in user with docCount, onlineCount, tokenCount, defaultDocTtlSeconds, and maxDocs.",
  ),
  "app.state_sync.space.get": operation(
    "GET",
    spacePath,
    "读取同步空间详情",
    "Read a single owned state sync space's metadata, TTL/doc limits, active room count, online count, and active token count.",
  ),
  "app.state_sync.space.create": operation(
    "POST",
    "/spaces",
    "创建同步空间",
    "Create a new state sync space (新建同步空间) for multiplayer game rooms or realtime shared JSON state trees. Returns space id and limits.",
    { body: stateSyncSpaceCreateSchema, mutates: true },
  ),
  "app.state_sync.space.update": operation(
    "PATCH",
    spacePath,
    "修改同步空间配置",
    "Update an owned state sync space's display name, description, defaultDocTtlSeconds, or maxDocs.",
    { body: stateSyncSpaceUpdateSchema, mutates: true },
  ),
  "app.state_sync.space.delete": operation(
    "DELETE",
    spacePath,
    "删除同步空间",
    "Permanently delete an owned state sync space, disconnect all live WebSocket clients (4003), and destroy all its tokens and rooms/documents.",
    { mutates: true },
  ),
  "app.state_sync.token.list": operation(
    "GET",
    tokensPath,
    "列出空间凭证",
    "List active role-scoped space tokens (prefix, role, lastUsedAt) for an owned state sync space. Never returns plaintext secrets.",
  ),
  "app.state_sync.token.create": operation(
    "POST",
    tokensPath,
    "签发空间凭证",
    "Issue a role-scoped space token (read, write, or create_write; max 20 active per space). Returns plaintext sys_ secret only once. Space tokens with create_write can create random-ID rooms from browsers without exposing personal API keys.",
    { body: stateSyncTokenCreateSchema, mutates: true },
  ),
  "app.state_sync.token.revoke": operation(
    "DELETE",
    tokenPath,
    "撤销空间凭证",
    "Revoke a space token and immediately disconnect all live WebSocket connections authenticated with that token (4003).",
    { mutates: true },
  ),
  "app.state_sync.doc.list": operation(
    "GET",
    docsPath,
    "列出空间房间",
    "List active (non-expired) rooms/documents inside an owned state sync space with rev, onlineCount, and expiresAt. Supports cursor-based pagination (limit 1-200, cursor).",
    {
      query: {
        limit: z.number().int().min(1).max(200).optional().describe("Maximum rooms to return (1-200, default 50)."),
        cursor: z.string().trim().min(1).max(128).optional().describe("Opaque docId cursor from previous nextCursor."),
      },
    },
  ),
  "app.state_sync.doc.create": operation(
    "POST",
    docsPath,
    "创建状态房间",
    "Create a room/document inside an owned state sync space with optional custom docId (management privilege), initialData JSON object, and ttlSeconds.",
    { body: stateSyncDocCreateBodySchema, mutates: true },
  ),
  "app.state_sync.doc.get": operation(
    "GET",
    docPath,
    "读取状态房间快照",
    "Read a room/document's current JSON snapshot (root '/' or a specific nested path like '/board/0'), rev, exists flag, and expiresAt.",
    {
      query: {
        path: stateSyncPathSchema.optional().describe("Optional JSON path starting with '/' (defaults to root '/')."),
      },
    },
  ),
  "app.state_sync.doc.mutate": operation(
    "PATCH",
    docPath,
    "写入状态房间",
    "Apply an atomic set, patch, or delete mutation at a JSON path inside a room/document with optional expectedRev CAS check, broadcasting live updates to connected WebSocket clients.",
    { body: stateSyncMutateHttpSchema, mutates: true },
  ),
  "app.state_sync.doc.delete": operation(
    "DELETE",
    docPath,
    "删除状态房间",
    "Permanently delete a room/document from an owned state sync space and immediately disconnect all live WebSocket clients in that room (4003).",
    { mutates: true },
  ),
} as const

export type StateSyncAction = keyof typeof stateSyncOperations

export function isStateSyncAction(action: string): action is StateSyncAction {
  return Object.hasOwn(stateSyncOperations, action)
}

const actions = Object.keys(stateSyncOperations) as StateSyncAction[]
const toolName = (action: StateSyncAction) => action.replaceAll(".", "_")

export const STATE_SYNC_DOMAIN: CapabilityDomainDefinition = {
  id: "state_sync",
  capabilities: actions.map((id) => {
    const { title, description, mutates } = stateSyncOperations[id]
    return { id, title, description, mutates: Boolean(mutates) }
  }),
}

export const STATE_SYNC_MCP_TOOL_ACTIONS = Object.fromEntries(actions.map((action) => [toolName(action), action]))

export function buildStateSyncTools(): McpToolDefinition[] {
  return actions.map((action) => {
    const { description, input } = stateSyncOperations[action]
    const { $schema: _dialect, ...schema } = z.toJSONSchema(input, { io: "input" })
    if (!schema.properties) throw new Error("State sync discovery requires object input")
    return {
      name: toolName(action),
      description: description + " Permissions: network.connect; signed-in desktop account and state sync space ownership.",
      inputSchema: { ...schema, type: "object", properties: schema.properties, additionalProperties: false },
    }
  })
}
