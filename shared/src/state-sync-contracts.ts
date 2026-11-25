import { z } from "zod"

// Keep schema composition and JSON Schema generation on the same Zod instance.
export { z as stateSyncZod }

const utf8Encoder = new TextEncoder()

export function utf8JsonByteLength(value: unknown): number {
  try {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) return Number.POSITIVE_INFINITY
    return utf8Encoder.encode(serialized).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && Object.prototype.toString.call(v) === "[object Object]"
}

export const STATE_SYNC_OPEN_BASE = "/api/open/v1/state-sync"
export const STATE_SYNC_PATH_SEGMENT_REGEX = /^[a-zA-Z0-9._:-]{1,64}$/u
export const STATE_SYNC_CUSTOM_DOC_ID_REGEX = /^[a-zA-Z0-9._:-]{3,64}$/u
export const STATE_SYNC_CLIENT_ID_REGEX = /^[a-zA-Z0-9._:-]{1,64}$/u
export const STATE_SYNC_CANONICAL_INDEX_REGEX = /^(0|[1-9]\d*)$/u
export const STATE_SYNC_MAX_PATH_DEPTH = 16
export const STATE_SYNC_MAX_VALUE_DEPTH = 32
export const STATE_SYNC_DOC_MAX_BYTES = 262144
export const STATE_SYNC_WRITE_MAX_BYTES = 65536
export const STATE_SYNC_WS_FRAME_MAX_BYTES = 131072
export const STATE_SYNC_META_MAX_BYTES = 2048
export const STATE_SYNC_MAX_SUBSCRIBED_PATHS = 32
export const STATE_SYNC_MAX_ON_DISCONNECT_ACTIONS = 8
export const STATE_SYNC_TTL_MIN_SECONDS = 60
export const STATE_SYNC_TTL_MAX_SECONDS = 2592000
export const STATE_SYNC_TTL_DEFAULT_SECONDS = 86400
export const STATE_SYNC_MAX_DOCS_DEFAULT = 100
export const STATE_SYNC_MAX_DOCS_CAP = 500

export const STATE_SYNC_TOKEN_ROLES = ["read", "write", "create_write"] as const
export type StateSyncRole = (typeof STATE_SYNC_TOKEN_ROLES)[number]

export const STATE_SYNC_MUTATION_OPS = ["set", "patch", "delete"] as const
export type StateSyncMutationOp = (typeof STATE_SYNC_MUTATION_OPS)[number]

export const STATE_SYNC_WS_CLOSE_CODES = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  AUTH_FAILED: 4001,
  REVOKED: 4003,
  ROLE_CHANGED: 4004,
  TIMEOUT_OR_SLOW: 4008,
  LIMIT_EXCEEDED: 4029,
} as const

export function parseStateSyncPath(path: string): { ok: true; segments: string[]; normalized: string } | { ok: false; message: string } {
  if (typeof path !== "string" || path.length === 0) {
    return { ok: false, message: "路径不能为空。" }
  }
  if (!path.startsWith("/")) {
    return { ok: false, message: "路径必须以 / 开头。" }
  }
  if (path === "/") {
    return { ok: true, segments: [], normalized: "/" }
  }
  if (path.endsWith("/")) {
    return { ok: false, message: "子路径不能以 / 结尾。" }
  }

  const rawSegments = path.slice(1).split("/")
  if (rawSegments.length > STATE_SYNC_MAX_PATH_DEPTH) {
    return { ok: false, message: `路径深度不能超过 ${STATE_SYNC_MAX_PATH_DEPTH} 层。` }
  }

  for (const seg of rawSegments) {
    if (seg.length === 0) {
      return { ok: false, message: "路径中不能包含空段。" }
    }
    if (seg === "__proto__" || seg === "constructor" || seg === "prototype") {
      return { ok: false, message: "路径段不能包含 __proto__、constructor 或 prototype。" }
    }
    if (!STATE_SYNC_PATH_SEGMENT_REGEX.test(seg)) {
      return { ok: false, message: `路径段 "${seg}" 包含非法字符或长度超出限制。` }
    }
  }

  return { ok: true, segments: rawSegments, normalized: "/" + rawSegments.join("/") }
}

export function isAncestorOrEqualPath(ancestor: string, target: string): boolean {
  if (typeof ancestor !== "string" || typeof target !== "string") return false
  if (!ancestor.startsWith("/") || !target.startsWith("/")) return false
  if (ancestor === target) return true
  if (ancestor === "/") return true
  return target.startsWith(ancestor.endsWith("/") ? ancestor : ancestor + "/")
}

export function validateStateSyncJsonValue(
  value: unknown,
  opts?: { maxBytes?: number; maxDepth?: number; requirePlainObject?: boolean },
): { ok: true; bytes: number } | { ok: false; code: "INVALID_INPUT" | "PAYLOAD_TOO_LARGE"; message: string } {
  if (opts?.requirePlainObject && !isPlainObject(value)) {
    return { ok: false, code: "INVALID_INPUT", message: "值必须为普通 JSON 对象。" }
  }

  let serialized: string
  try {
    const res = JSON.stringify(value)
    if (res === undefined) {
      return { ok: false, code: "INVALID_INPUT", message: "值无法序列化为有效 JSON。" }
    }
    serialized = res
  } catch {
    return { ok: false, code: "INVALID_INPUT", message: "值包含循环引用或非法的 JSON 数据。" }
  }

  const bytes = utf8Encoder.encode(serialized).byteLength
  const maxBytes = opts?.maxBytes ?? STATE_SYNC_DOC_MAX_BYTES
  if (bytes > maxBytes) {
    return { ok: false, code: "PAYLOAD_TOO_LARGE", message: `载荷大小 (${bytes} 字节) 超过允许上限 (${maxBytes} 字节)。` }
  }

  const maxDepth = opts?.maxDepth ?? STATE_SYNC_MAX_VALUE_DEPTH
  function checkNode(node: unknown, depth: number): { ok: true } | { ok: false; message: string } {
    if (depth > maxDepth) {
      return { ok: false, message: `JSON 嵌套深度超过上限 (${maxDepth} 层)。` }
    }
    if (typeof node === "undefined") {
      return { ok: false, message: "JSON 值中不能包含 undefined。" }
    }
    if (typeof node === "number") {
      if (!Number.isFinite(node)) {
        return { ok: false, message: "数字必须为有限数值 (不能为 NaN 或 Infinity)。" }
      }
      return { ok: true }
    }
    if (node === null || typeof node === "string" || typeof node === "boolean") {
      return { ok: true }
    }
    if (typeof node !== "object") {
      return { ok: false, message: `非法的数据类型: ${typeof node}。` }
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        const sub = checkNode(item, depth + 1)
        if (!sub.ok) return sub
      }
      return { ok: true }
    }
    if (!isPlainObject(node)) {
      return { ok: false, message: "对象必须为普通 JSON 对象 (不能为 Date、Map、Set、RegExp 等)。" }
    }

    const keys = Object.keys(node)
    for (const key of keys) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        return { ok: false, message: `禁止使用属性名 "${key}"。` }
      }
      const sub = checkNode((node as Record<string, unknown>)[key], depth + 1)
      if (!sub.ok) return sub
    }
    return { ok: true }
  }

  const check = checkNode(value, 0)
  if (!check.ok) {
    return { ok: false, code: "INVALID_INPUT", message: check.message }
  }

  return { ok: true, bytes }
}

export function readStateSyncPath(
  root: Record<string, unknown>,
  path: string,
): { exists: boolean; value: unknown } {
  const parsed = parseStateSyncPath(path)
  if (!parsed.ok) {
    return { exists: false, value: undefined }
  }
  if (parsed.segments.length === 0) {
    return { exists: true, value: structuredClone(root) }
  }

  let curr: unknown = root
  for (const segment of parsed.segments) {
    if (curr === null || typeof curr !== "object") {
      return { exists: false, value: undefined }
    }
    if (Array.isArray(curr)) {
      if (!STATE_SYNC_CANONICAL_INDEX_REGEX.test(segment)) {
        return { exists: false, value: undefined }
      }
      const idx = Number(segment)
      if (idx >= curr.length) {
        return { exists: false, value: undefined }
      }
      curr = curr[idx]
    } else {
      if (!Object.prototype.hasOwnProperty.call(curr, segment)) {
        return { exists: false, value: undefined }
      }
      curr = (curr as Record<string, unknown>)[segment]
    }
  }

  return { exists: true, value: structuredClone(curr) }
}

export function applyStateSyncMutation(
  root: Record<string, unknown>,
  input: {
    op: "set" | "patch" | "delete"
    path: string
    value?: unknown
    maxDocBytes?: number
  },
):
  | { ok: true; nextRoot: Record<string, unknown>; changed: boolean; bytes: number }
  | { ok: false; code: "INVALID_INPUT" | "PATH_CONFLICT" | "DOC_TOO_LARGE"; message: string } {
  const parsed = parseStateSyncPath(input.path)
  if (!parsed.ok) {
    return { ok: false, code: "INVALID_INPUT", message: parsed.message }
  }

  if (input.op !== "set" && input.op !== "patch" && input.op !== "delete") {
    return { ok: false, code: "INVALID_INPUT", message: `不支持的操作类型: ${input.op}` }
  }

  if (input.op === "delete" && parsed.segments.length === 0) {
    return { ok: false, code: "INVALID_INPUT", message: "禁止删除根路径 /。" }
  }

  if (input.op === "set" && input.value === undefined) {
    return { ok: false, code: "INVALID_INPUT", message: "set 操作必须提供非 undefined 的 value。" }
  }

  if (input.op === "set" && parsed.segments.length === 0) {
    if (!isPlainObject(input.value)) {
      return { ok: false, code: "INVALID_INPUT", message: "根节点必须为普通 JSON 对象。" }
    }
  }

  if (input.op === "patch" && !isPlainObject(input.value)) {
    return { ok: false, code: "INVALID_INPUT", message: "patch 载荷必须为普通 JSON 对象。" }
  }

  const maxDocBytes = input.maxDocBytes ?? STATE_SYNC_DOC_MAX_BYTES

  if (input.value !== undefined) {
    const valCheck = validateStateSyncJsonValue(input.value, { maxBytes: maxDocBytes })
    if (!valCheck.ok) {
      return {
        ok: false,
        code: valCheck.code === "PAYLOAD_TOO_LARGE" ? "DOC_TOO_LARGE" : "INVALID_INPUT",
        message: valCheck.message,
      }
    }
  }

  const nextRoot = structuredClone(root)
  let changed = false

  if (parsed.segments.length === 0) {
    // Root level mutation
    if (input.op === "set") {
      const targetVal = input.value as Record<string, unknown>
      changed = JSON.stringify(nextRoot) !== JSON.stringify(targetVal)
      for (const key of Object.keys(nextRoot)) {
        delete nextRoot[key]
      }
      Object.assign(nextRoot, structuredClone(targetVal))
    } else if (input.op === "patch") {
      const partial = input.value as Record<string, unknown>
      for (const [k, v] of Object.entries(partial)) {
        if (!Object.prototype.hasOwnProperty.call(nextRoot, k) || JSON.stringify(nextRoot[k]) !== JSON.stringify(v)) {
          changed = true
        }
        nextRoot[k] = structuredClone(v)
      }
    }
  } else {
    // Nested mutation
    const parentSegments = parsed.segments.slice(0, -1)
    const targetKey = parsed.segments[parsed.segments.length - 1]

    let curr: Record<string, unknown> = nextRoot
    for (let i = 0; i < parentSegments.length; i++) {
      const seg = parentSegments[i]
      if (!Object.prototype.hasOwnProperty.call(curr, seg) || curr[seg] === undefined) {
        if (input.op === "delete") {
          // Deleting inside a non-existent parent => idempotent noop
          const bytes = utf8JsonByteLength(nextRoot)
          return { ok: true, nextRoot, changed: false, bytes }
        }
        curr[seg] = {}
        changed = true
        curr = curr[seg] as Record<string, unknown>
      } else {
        const nextNode = curr[seg]
        if (!isPlainObject(nextNode)) {
          return { ok: false, code: "PATH_CONFLICT", message: `路径段 "${seg}" 发生冲突：中间节点不是普通对象。` }
        }
        curr = nextNode
      }
    }

    if (input.op === "set") {
      const hasKey = Object.prototype.hasOwnProperty.call(curr, targetKey)
      const beforeStr = hasKey ? JSON.stringify(curr[targetKey]) : undefined
      const afterStr = JSON.stringify(input.value)
      if (!hasKey || beforeStr !== afterStr) {
        changed = true
      }
      curr[targetKey] = structuredClone(input.value)
    } else if (input.op === "patch") {
      if (!Object.prototype.hasOwnProperty.call(curr, targetKey) || curr[targetKey] === undefined) {
        curr[targetKey] = {}
        changed = true
      } else if (!isPlainObject(curr[targetKey])) {
        return { ok: false, code: "PATH_CONFLICT", message: `目标节点不是普通对象，无法执行 patch。` }
      }
      const targetObj = curr[targetKey] as Record<string, unknown>
      const partial = input.value as Record<string, unknown>
      for (const [k, v] of Object.entries(partial)) {
        if (!Object.prototype.hasOwnProperty.call(targetObj, k) || JSON.stringify(targetObj[k]) !== JSON.stringify(v)) {
          changed = true
        }
        targetObj[k] = structuredClone(v)
      }
    } else if (input.op === "delete") {
      if (Object.prototype.hasOwnProperty.call(curr, targetKey)) {
        delete curr[targetKey]
        changed = true
      } else {
        changed = false
      }
    }
  }

  const finalSerialized = JSON.stringify(nextRoot)
  const totalBytes = utf8Encoder.encode(finalSerialized).byteLength
  if (totalBytes > maxDocBytes) {
    return { ok: false, code: "DOC_TOO_LARGE", message: `文档总大小 (${totalBytes} 字节) 超过上限 (${maxDocBytes} 字节)。` }
  }

  return { ok: true, nextRoot, changed, bytes: totalBytes }
}

// Zod Schemas
export const stateSyncRoleSchema = z.enum(STATE_SYNC_TOKEN_ROLES)

export const stateSyncKeyResourcesSchema = z.object({
  mode: z.enum(["selected", "all_owned"]),
  spaceIds: z.array(z.string().min(1).max(128)).max(500),
}).strict().refine(
  (value) => new Set(value.spaceIds).size === value.spaceIds.length && (value.mode !== "all_owned" || value.spaceIds.length === 0),
  "同步空间资源范围无效。",
)

export const stateSyncPathSchema = z.string().superRefine((val, ctx) => {
  const res = parseStateSyncPath(val)
  if (!res.ok) {
    ctx.addIssue({
      code: "custom",
      message: res.message,
    })
  }
})

export const stateSyncSpaceCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).default(""),
  defaultDocTtlSeconds: z.number().int().min(STATE_SYNC_TTL_MIN_SECONDS).max(STATE_SYNC_TTL_MAX_SECONDS).nullable().optional().default(STATE_SYNC_TTL_DEFAULT_SECONDS),
  maxDocs: z.number().int().min(1).max(STATE_SYNC_MAX_DOCS_CAP).optional().default(STATE_SYNC_MAX_DOCS_DEFAULT),
}).strict()

export const stateSyncSpaceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).optional(),
  defaultDocTtlSeconds: z.number().int().min(STATE_SYNC_TTL_MIN_SECONDS).max(STATE_SYNC_TTL_MAX_SECONDS).nullable().optional(),
  maxDocs: z.number().int().min(1).max(STATE_SYNC_MAX_DOCS_CAP).optional(),
}).strict().refine(
  (value) => value.name !== undefined || value.description !== undefined || value.defaultDocTtlSeconds !== undefined || value.maxDocs !== undefined,
  "至少提供一个待更新字段。",
)

export const stateSyncTokenCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  role: stateSyncRoleSchema,
}).strict()

export const stateSyncCustomDocIdSchema = z.string().regex(STATE_SYNC_CUSTOM_DOC_ID_REGEX, "自定义 docId 仅支持字母、数字及 . _ : -，长度为 3-64 字符。")

export const stateSyncDocCreateSchema = z.object({
  docId: stateSyncCustomDocIdSchema.optional(),
  initialData: z.custom<Record<string, unknown>>((v) => isPlainObject(v), "initialData 必须为普通 JSON 对象。").optional().superRefine((val, ctx) => {
    if (val === undefined) return
    const res = validateStateSyncJsonValue(val, { requirePlainObject: true, maxBytes: STATE_SYNC_DOC_MAX_BYTES })
    if (!res.ok) {
      ctx.addIssue({
        code: "custom",
        message: res.message,
      })
    }
  }),
  ttlSeconds: z.number().int().min(STATE_SYNC_TTL_MIN_SECONDS).max(STATE_SYNC_TTL_MAX_SECONDS).nullable().optional(),
}).strict()

export function refineStateSyncMutation(
  data: { op: StateSyncMutationOp; path: string; value?: unknown },
  ctx: z.RefinementCtx,
): void {
  if (data.op === "delete" && data.path === "/") {
    ctx.addIssue({
      code: "custom",
      path: ["path"],
      message: "禁止删除根路径 /。",
    })
  }
  if (data.op === "set" && data.value === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["value"],
      message: "set 操作必须提供 value。",
    })
  }
  if (data.op === "patch" && !isPlainObject(data.value)) {
    ctx.addIssue({
      code: "custom",
      path: ["value"],
      message: "patch 载荷必须为普通 JSON 对象。",
    })
  }
  if (data.op === "set" && data.path === "/" && !isPlainObject(data.value)) {
    ctx.addIssue({
      code: "custom",
      path: ["value"],
      message: "根节点必须为普通 JSON 对象。",
    })
  }
  if (data.value !== undefined) {
    const valRes = validateStateSyncJsonValue(data.value, { maxBytes: STATE_SYNC_WRITE_MAX_BYTES })
    if (!valRes.ok) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: valRes.message,
      })
    }
  }
}

export const stateSyncMetaSchema = z.custom<Record<string, unknown>>((v) => isPlainObject(v), "meta 必须为普通 JSON 对象。").optional().superRefine((v, ctx) => {
  if (v === undefined) return
  const res = validateStateSyncJsonValue(v, {
    maxBytes: STATE_SYNC_META_MAX_BYTES,
    requirePlainObject: true,
  })
  if (!res.ok) {
    ctx.addIssue({
      code: "custom",
      message: res.message,
    })
  }
})

export const stateSyncMutateHttpSchema = z.object({
  op: z.enum(STATE_SYNC_MUTATION_OPS),
  path: stateSyncPathSchema,
  value: z.unknown().optional(),
  expectedRev: z.number().int().min(0).optional(),
  actorClientId: z.string().regex(STATE_SYNC_CLIENT_ID_REGEX).optional(),
  actorName: z.string().trim().min(1).max(64).optional(),
}).strict().superRefine(refineStateSyncMutation)

export const stateSyncOnDisconnectActionSchema = z.object({
  op: z.enum(STATE_SYNC_MUTATION_OPS),
  path: stateSyncPathSchema,
  value: z.unknown().optional(),
}).strict().superRefine(refineStateSyncMutation)

const wsRequestIdSchema = z.string().min(1).max(128)

const wsAuthFrameSchema = z.object({
  type: z.literal("auth"),
  token: z.string().min(1).max(512),
  clientId: z.string().regex(STATE_SYNC_CLIENT_ID_REGEX).optional(),
  clientName: z.string().trim().min(1).max(64).optional(),
  meta: stateSyncMetaSchema,
  paths: z.array(stateSyncPathSchema).max(STATE_SYNC_MAX_SUBSCRIBED_PATHS).optional(),
  sinceRev: z.number().int().min(0).optional(),
}).strict()

const wsSubscribeFrameSchema = z.object({
  type: z.literal("subscribe"),
  id: wsRequestIdSchema.optional(),
  paths: z.array(stateSyncPathSchema).min(1).max(STATE_SYNC_MAX_SUBSCRIBED_PATHS),
}).strict()

const wsUnsubscribeFrameSchema = z.object({
  type: z.literal("unsubscribe"),
  id: wsRequestIdSchema.optional(),
  paths: z.array(stateSyncPathSchema).min(1).max(STATE_SYNC_MAX_SUBSCRIBED_PATHS),
}).strict()

const wsMutateFrameSchema = z.object({
  type: z.literal("mutate"),
  id: wsRequestIdSchema.optional(),
  op: z.enum(STATE_SYNC_MUTATION_OPS),
  path: stateSyncPathSchema,
  value: z.unknown().optional(),
  expectedRev: z.number().int().min(0).optional(),
  echo: z.boolean().optional().default(false),
}).strict().superRefine(refineStateSyncMutation)

const wsOnDisconnectSetFrameSchema = z.object({
  type: z.literal("onDisconnect.set"),
  id: wsRequestIdSchema.optional(),
  actions: z.array(stateSyncOnDisconnectActionSchema).max(STATE_SYNC_MAX_ON_DISCONNECT_ACTIONS),
}).strict()

const wsOnDisconnectClearFrameSchema = z.object({
  type: z.literal("onDisconnect.clear"),
  id: wsRequestIdSchema.optional(),
}).strict()

const wsPresenceUpdateFrameSchema = z.object({
  type: z.literal("presence.update"),
  clientName: z.string().trim().min(1).max(64).optional(),
  meta: stateSyncMetaSchema,
}).strict().refine(
  (v) => v.clientName !== undefined || v.meta !== undefined,
  "presence.update 至少需要提供 clientName 或 meta。",
)

const wsPingFrameSchema = z.object({
  type: z.literal("ping"),
}).strict()

export const stateSyncWsClientFrameSchema = z.discriminatedUnion("type", [
  wsAuthFrameSchema,
  wsSubscribeFrameSchema,
  wsUnsubscribeFrameSchema,
  wsMutateFrameSchema,
  wsOnDisconnectSetFrameSchema,
  wsOnDisconnectClearFrameSchema,
  wsPresenceUpdateFrameSchema,
  wsPingFrameSchema,
])

export const stateSyncPresenceMemberSchema = z.object({
  connectionId: z.string().min(1),
  clientId: z.string().regex(STATE_SYNC_CLIENT_ID_REGEX),
  clientName: z.string().max(64).nullable(),
  role: stateSyncRoleSchema,
  meta: z.record(z.string(), z.unknown()),
  connectedAt: z.string(),
}).strict()

const wsReadyServerFrameSchema = z.object({
  type: z.literal("ready"),
  spaceId: z.string().min(1),
  docId: z.string().min(1),
  connectionId: z.string().min(1),
  clientId: z.string().min(1),
  role: stateSyncRoleSchema,
  rev: z.number().int().min(0),
  expiresAt: z.string().nullable().optional(),
  replayTruncated: z.boolean(),
  presence: z.array(stateSyncPresenceMemberSchema),
  snapshots: z.array(z.object({
    path: z.string(),
    exists: z.boolean(),
    value: z.unknown(),
  })),
}).strict()

const wsMutationServerFrameSchema = z.object({
  type: z.literal("mutation"),
  rev: z.number().int().min(0),
  op: z.enum(STATE_SYNC_MUTATION_OPS),
  path: z.string(),
  value: z.unknown().optional(),
  replayed: z.boolean(),
  actor: z.object({
    connectionId: z.string().nullable().optional(),
    clientId: z.string().nullable().optional(),
    clientName: z.string().nullable().optional(),
  }).optional(),
  ts: z.string(),
}).strict()

const wsSnapshotServerFrameSchema = z.object({
  type: z.literal("snapshot"),
  rev: z.number().int().min(0),
  path: z.string(),
  exists: z.boolean(),
  value: z.unknown(),
}).strict()

const wsAckServerFrameSchema = z.object({
  type: z.literal("ack"),
  id: wsRequestIdSchema,
  rev: z.number().int().min(0).optional(),
  changed: z.boolean().optional(),
}).strict()

const wsPresenceJoinServerFrameSchema = z.object({
  type: z.literal("presence.join"),
  member: stateSyncPresenceMemberSchema,
}).strict()

const wsPresenceLeaveServerFrameSchema = z.object({
  type: z.literal("presence.leave"),
  member: stateSyncPresenceMemberSchema,
}).strict()

const wsPresenceUpdateServerFrameSchema = z.object({
  type: z.literal("presence.update"),
  member: stateSyncPresenceMemberSchema,
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
  currentRev: z.number().int().min(0).optional(),
}).strict()

export const stateSyncWsServerFrameSchema = z.discriminatedUnion("type", [
  wsReadyServerFrameSchema,
  wsMutationServerFrameSchema,
  wsSnapshotServerFrameSchema,
  wsAckServerFrameSchema,
  wsPresenceJoinServerFrameSchema,
  wsPresenceLeaveServerFrameSchema,
  wsPresenceUpdateServerFrameSchema,
  wsPongServerFrameSchema,
  wsErrorServerFrameSchema,
])

export type StateSyncKeyResources = z.infer<typeof stateSyncKeyResourcesSchema>
export type StateSyncSpaceCreateInput = z.infer<typeof stateSyncSpaceCreateSchema>
export type StateSyncSpaceUpdateInput = z.infer<typeof stateSyncSpaceUpdateSchema>
export type StateSyncTokenCreateInput = z.infer<typeof stateSyncTokenCreateSchema>
export type StateSyncDocCreateInput = z.infer<typeof stateSyncDocCreateSchema>
export type StateSyncMutateHttpInput = z.infer<typeof stateSyncMutateHttpSchema>
export type StateSyncOnDisconnectAction = z.infer<typeof stateSyncOnDisconnectActionSchema>
export type StateSyncWsClientFrame = z.infer<typeof stateSyncWsClientFrameSchema>
export type StateSyncWsServerFrame = z.infer<typeof stateSyncWsServerFrameSchema>
export type StateSyncPresenceMember = z.infer<typeof stateSyncPresenceMemberSchema>
