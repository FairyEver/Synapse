import { describe, expect, it } from "vitest"
import {
  STATE_SYNC_CANONICAL_INDEX_REGEX,
  STATE_SYNC_CLIENT_ID_REGEX,
  STATE_SYNC_CUSTOM_DOC_ID_REGEX,
  STATE_SYNC_DOC_MAX_BYTES,
  STATE_SYNC_MAX_DOCS_CAP,
  STATE_SYNC_MAX_DOCS_DEFAULT,
  STATE_SYNC_MAX_ON_DISCONNECT_ACTIONS,
  STATE_SYNC_MAX_PATH_DEPTH,
  STATE_SYNC_MAX_SUBSCRIBED_PATHS,
  STATE_SYNC_MAX_VALUE_DEPTH,
  STATE_SYNC_META_MAX_BYTES,
  STATE_SYNC_MUTATION_OPS,
  STATE_SYNC_PATH_SEGMENT_REGEX,
  STATE_SYNC_TOKEN_ROLES,
  STATE_SYNC_TTL_DEFAULT_SECONDS,
  STATE_SYNC_TTL_MAX_SECONDS,
  STATE_SYNC_TTL_MIN_SECONDS,
  STATE_SYNC_WRITE_MAX_BYTES,
  STATE_SYNC_WS_CLOSE_CODES,
  STATE_SYNC_WS_FRAME_MAX_BYTES,
  applyStateSyncMutation,
  isAncestorOrEqualPath,
  parseStateSyncPath,
  readStateSyncPath,
  refineStateSyncMutation,
  stateSyncDocCreateSchema,
  stateSyncKeyResourcesSchema,
  stateSyncMetaSchema,
  stateSyncMutateHttpSchema,
  stateSyncOnDisconnectActionSchema,
  stateSyncPathSchema,
  stateSyncRoleSchema,
  stateSyncSpaceCreateSchema,
  stateSyncSpaceUpdateSchema,
  stateSyncTokenCreateSchema,
  stateSyncWsClientFrameSchema,
  stateSyncWsServerFrameSchema,
  validateStateSyncJsonValue,
} from "./state-sync-contracts.js"

describe("state-sync-contracts constants", () => {
  it("exposes all spec constants and limits", () => {
    expect(STATE_SYNC_MAX_PATH_DEPTH).toBe(16)
    expect(STATE_SYNC_MAX_VALUE_DEPTH).toBe(32)
    expect(STATE_SYNC_DOC_MAX_BYTES).toBe(262144)
    expect(STATE_SYNC_WRITE_MAX_BYTES).toBe(65536)
    expect(STATE_SYNC_WS_FRAME_MAX_BYTES).toBe(131072)
    expect(STATE_SYNC_META_MAX_BYTES).toBe(2048)
    expect(STATE_SYNC_MAX_SUBSCRIBED_PATHS).toBe(32)
    expect(STATE_SYNC_MAX_ON_DISCONNECT_ACTIONS).toBe(8)
    expect(STATE_SYNC_TTL_MIN_SECONDS).toBe(60)
    expect(STATE_SYNC_TTL_MAX_SECONDS).toBe(2592000)
    expect(STATE_SYNC_TTL_DEFAULT_SECONDS).toBe(86400)
    expect(STATE_SYNC_MAX_DOCS_DEFAULT).toBe(100)
    expect(STATE_SYNC_MAX_DOCS_CAP).toBe(500)
    expect(STATE_SYNC_TOKEN_ROLES).toEqual(["read", "write", "create_write"])
    expect(STATE_SYNC_MUTATION_OPS).toEqual(["set", "patch", "delete"])
    expect(STATE_SYNC_WS_CLOSE_CODES).toEqual({
      NORMAL: 1000,
      GOING_AWAY: 1001,
      AUTH_FAILED: 4001,
      REVOKED: 4003,
      ROLE_CHANGED: 4004,
      TIMEOUT_OR_SLOW: 4008,
      LIMIT_EXCEEDED: 4029,
    })

    expect(STATE_SYNC_PATH_SEGMENT_REGEX.test("board_0.test:1")).toBe(true)
    expect(STATE_SYNC_PATH_SEGMENT_REGEX.test("board/0")).toBe(false)
    expect(STATE_SYNC_CUSTOM_DOC_ID_REGEX.test("room-123.alpha")).toBe(true)
    expect(STATE_SYNC_CUSTOM_DOC_ID_REGEX.test("ro")).toBe(false)
    expect(STATE_SYNC_CLIENT_ID_REGEX.test("player-1_x:9")).toBe(true)
  })
})

describe("parseStateSyncPath", () => {
  it("accepts valid root and nested paths", () => {
    const root = parseStateSyncPath("/")
    expect(root).toEqual({ ok: true, segments: [], normalized: "/" })

    const board = parseStateSyncPath("/board/0")
    expect(board).toEqual({ ok: true, segments: ["board", "0"], normalized: "/board/0" })

    const playerHp = parseStateSyncPath("/players/p1/hp")
    expect(playerHp).toEqual({ ok: true, segments: ["players", "p1", "hp"], normalized: "/players/p1/hp" })
  })

  it("rejects invalid paths: empty, missing leading slash, trailing slash, double slashes", () => {
    expect(parseStateSyncPath("").ok).toBe(false)
    expect(parseStateSyncPath("board").ok).toBe(false)
    expect(parseStateSyncPath("/board/").ok).toBe(false)
    expect(parseStateSyncPath("/a//b").ok).toBe(false)
  })

  it("rejects prototype pollution segments and dangerous keys", () => {
    expect(parseStateSyncPath("/__proto__/x").ok).toBe(false)
    expect(parseStateSyncPath("/x/__proto__").ok).toBe(false)
    expect(parseStateSyncPath("/constructor").ok).toBe(false)
    expect(parseStateSyncPath("/a/prototype/b").ok).toBe(false)
  })

  it("rejects depth exceeding 16", () => {
    const depth16 = "/" + Array.from({ length: 16 }, (_, i) => `seg${i}`).join("/")
    expect(parseStateSyncPath(depth16).ok).toBe(true)

    const depth17 = "/" + Array.from({ length: 17 }, (_, i) => `seg${i}`).join("/")
    const res = parseStateSyncPath(depth17)
    expect(res.ok).toBe(false)
  })

  it("rejects invalid segment characters and segment lengths > 64", () => {
    expect(parseStateSyncPath("/a b/c").ok).toBe(false)
    expect(parseStateSyncPath("/a@b").ok).toBe(false)
    const longSegment = "/" + "a".repeat(65)
    expect(parseStateSyncPath(longSegment).ok).toBe(false)
  })
})

describe("isAncestorOrEqualPath", () => {
  it("determines ancestor relationships correctly", () => {
    expect(isAncestorOrEqualPath("/", "/")).toBe(true)
    expect(isAncestorOrEqualPath("/", "/board")).toBe(true)
    expect(isAncestorOrEqualPath("/", "/players/p1/hp")).toBe(true)
    expect(isAncestorOrEqualPath("/board", "/board")).toBe(true)
    expect(isAncestorOrEqualPath("/board", "/board/0")).toBe(true)
    expect(isAncestorOrEqualPath("/board", "/board-2")).toBe(false)
    expect(isAncestorOrEqualPath("/board/0", "/board")).toBe(false)
    expect(isAncestorOrEqualPath("/players/p1", "/players/p2")).toBe(false)
  })
})

describe("validateStateSyncJsonValue", () => {
  it("accepts CJK and spaced object keys", () => {
    const value = { "玩家 名称": "张三", "得分 分数": 100 }
    const res = validateStateSyncJsonValue(value)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.bytes).toBeGreaterThan(0)
    }
  })

  it("rejects nested __proto__, constructor, and prototype keys recursively", () => {
    const polluted = JSON.parse('{"a":{"__proto__":{"polluted":1}}}')
    const resProto = validateStateSyncJsonValue(polluted)
    expect(resProto.ok).toBe(false)
    if (!resProto.ok) {
      expect(resProto.code).toBe("INVALID_INPUT")
    }

    const ctorObj = { a: { constructor: 123 } }
    expect(validateStateSyncJsonValue(ctorObj).ok).toBe(false)

    const protoObj = { a: [{ b: { prototype: {} } }] }
    expect(validateStateSyncJsonValue(protoObj).ok).toBe(false)
  })

  it("rejects nesting depth > 32", () => {
    let deep: Record<string, unknown> = { end: 1 }
    for (let i = 0; i < 33; i++) {
      deep = { next: deep }
    }
    const res = validateStateSyncJsonValue(deep)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe("INVALID_INPUT")
    }
  })

  it("rejects CJK string whose .length < 65536 but UTF-8 byte length > 65536", () => {
    const cjk = "中".repeat(22000)
    expect(cjk.length).toBeLessThan(65536)
    // 22000 chars * 3 bytes + 2 quotes = 66002 bytes
    const res = validateStateSyncJsonValue(cjk, { maxBytes: 65536 })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe("PAYLOAD_TOO_LARGE")
    }
  })

  it("enforces requirePlainObject when requested", () => {
    expect(validateStateSyncJsonValue("str", { requirePlainObject: true }).ok).toBe(false)
    expect(validateStateSyncJsonValue([1, 2], { requirePlainObject: true }).ok).toBe(false)
    expect(validateStateSyncJsonValue(null, { requirePlainObject: true }).ok).toBe(false)
    expect(validateStateSyncJsonValue({ a: 1 }, { requirePlainObject: true }).ok).toBe(true)
  })
})

describe("readStateSyncPath", () => {
  const root = {
    board: [1, 2, { turn: "p1" }],
    players: {
      p1: { hp: 100, name: "Alice" },
      p2: { hp: 80, name: "Bob" },
    },
  }

  it("reads root and nested paths returning cloned values", () => {
    const rRoot = readStateSyncPath(root, "/")
    expect(rRoot.exists).toBe(true)
    expect(rRoot.value).toEqual(root)
    expect(rRoot.value).not.toBe(root)

    const rHp = readStateSyncPath(root, "/players/p1/hp")
    expect(rHp).toEqual({ exists: true, value: 100 })

    const rP1 = readStateSyncPath(root, "/players/p1")
    expect(rP1.exists).toBe(true)
    expect(rP1.value).toEqual({ hp: 100, name: "Alice" })
    expect(rP1.value).not.toBe(root.players.p1)
  })

  it("returns exists: false for non-existent paths", () => {
    expect(readStateSyncPath(root, "/missing")).toEqual({ exists: false, value: undefined })
    expect(readStateSyncPath(root, "/players/p3/hp")).toEqual({ exists: false, value: undefined })
  })
})

describe("applyStateSyncMutation", () => {
  it("set('/a/b/c', 1) auto-creates intermediate objects", () => {
    const original: Record<string, unknown> = {}
    const res = applyStateSyncMutation(original, {
      op: "set",
      path: "/a/b/c",
      value: 1,
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.nextRoot).toEqual({ a: { b: { c: 1 } } })
      expect(res.changed).toBe(true)
    }
    expect(original).toEqual({})
  })

  it("set('/a/b', 2) on { a: 5 } returns PATH_CONFLICT without mutating input", () => {
    const original: Record<string, unknown> = { a: 5 }
    const res = applyStateSyncMutation(original, {
      op: "set",
      path: "/a/b",
      value: 2,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe("PATH_CONFLICT")
    }
    expect(original).toEqual({ a: 5 })
  })

  it("set('/', 'not-object') and delete('/') return INVALID_INPUT; set('/', {}) succeeds", () => {
    const original: Record<string, unknown> = { a: 1 }

    const resNonObj = applyStateSyncMutation(original, {
      op: "set",
      path: "/",
      value: "not-object",
    })
    expect(resNonObj.ok).toBe(false)
    if (!resNonObj.ok) {
      expect(resNonObj.code).toBe("INVALID_INPUT")
    }

    const resDelRoot = applyStateSyncMutation(original, {
      op: "delete",
      path: "/",
    })
    expect(resDelRoot.ok).toBe(false)
    if (!resDelRoot.ok) {
      expect(resDelRoot.code).toBe("INVALID_INPUT")
    }

    const resEmptyRoot = applyStateSyncMutation(original, {
      op: "set",
      path: "/",
      value: {},
    })
    expect(resEmptyRoot.ok).toBe(true)
    if (resEmptyRoot.ok) {
      expect(resEmptyRoot.nextRoot).toEqual({})
      expect(resEmptyRoot.changed).toBe(true)
    }
  })

  it("patch('/p1', { ready: true, note: null }) shallow-merges and preserves null", () => {
    const original: Record<string, unknown> = {
      p1: { ready: false, score: 10, note: "hello" },
    }
    const res = applyStateSyncMutation(original, {
      op: "patch",
      path: "/p1",
      value: { ready: true, note: null },
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.nextRoot).toEqual({
        p1: { ready: true, score: 10, note: null },
      })
      expect(res.changed).toBe(true)
    }
  })

  it("patch('/arr', { a: 1 }) when /arr is [] returns PATH_CONFLICT", () => {
    const original: Record<string, unknown> = { arr: [] }
    const res = applyStateSyncMutation(original, {
      op: "patch",
      path: "/arr",
      value: { a: 1 },
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe("PATH_CONFLICT")
    }
  })

  it("delete('/missing/key') returns { ok: true, changed: false }", () => {
    const original: Record<string, unknown> = { existing: 1 }
    const res = applyStateSyncMutation(original, {
      op: "delete",
      path: "/missing/key",
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.changed).toBe(false)
      expect(res.nextRoot).toEqual({ existing: 1 })
    }
  })

  it("returns DOC_TOO_LARGE without mutating original tree when size exceeds limit", () => {
    const original: Record<string, unknown> = { note: "start" }
    const hugePayload = "x".repeat(STATE_SYNC_DOC_MAX_BYTES + 10)
    const res = applyStateSyncMutation(original, {
      op: "set",
      path: "/huge",
      value: hugePayload,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe("DOC_TOO_LARGE")
    }
    expect(original).toEqual({ note: "start" })
  })
})

describe("Zod schemas", () => {
  it("validates stateSyncRoleSchema", () => {
    expect(stateSyncRoleSchema.safeParse("read").success).toBe(true)
    expect(stateSyncRoleSchema.safeParse("write").success).toBe(true)
    expect(stateSyncRoleSchema.safeParse("create_write").success).toBe(true)
    expect(stateSyncRoleSchema.safeParse("admin").success).toBe(false)
  })

  it("validates stateSyncKeyResourcesSchema", () => {
    expect(stateSyncKeyResourcesSchema.safeParse({ mode: "selected", spaceIds: ["ss_1"] }).success).toBe(true)
    expect(stateSyncKeyResourcesSchema.safeParse({ mode: "all_owned", spaceIds: [] }).success).toBe(true)
    expect(stateSyncKeyResourcesSchema.safeParse({ mode: "all_owned", spaceIds: ["ss_1"] }).success).toBe(false)
    expect(stateSyncKeyResourcesSchema.safeParse({ mode: "selected", spaceIds: ["ss_1", "ss_1"] }).success).toBe(false)
  })

  it("validates stateSyncPathSchema", () => {
    expect(stateSyncPathSchema.safeParse("/").success).toBe(true)
    expect(stateSyncPathSchema.safeParse("/board/0").success).toBe(true)
    expect(stateSyncPathSchema.safeParse("board").success).toBe(false)
    expect(stateSyncPathSchema.safeParse("/__proto__").success).toBe(false)
  })

  it("validates space create and update schemas", () => {
    expect(stateSyncSpaceCreateSchema.safeParse({
      name: "五子棋空间",
      description: "小游戏测试",
      defaultDocTtlSeconds: 86400,
      maxDocs: 100,
    }).success).toBe(true)

    expect(stateSyncSpaceUpdateSchema.safeParse({
      name: "更新空间名称",
    }).success).toBe(true)

    expect(stateSyncSpaceUpdateSchema.safeParse({}).success).toBe(false)
  })

  it("validates stateSyncTokenCreateSchema", () => {
    expect(stateSyncTokenCreateSchema.safeParse({
      name: "房间凭证",
      role: "create_write",
    }).success).toBe(true)

    expect(stateSyncTokenCreateSchema.safeParse({
      name: "无效凭证",
      role: "owner",
    }).success).toBe(false)
  })

  it("validates stateSyncDocCreateSchema", () => {
    expect(stateSyncDocCreateSchema.safeParse({
      docId: "room_alpha.1",
      initialData: { board: {} },
      ttlSeconds: 3600,
    }).success).toBe(true)

    expect(stateSyncDocCreateSchema.safeParse({
      docId: "r", // too short (min 3)
    }).success).toBe(false)
  })

  it("validates stateSyncMutateHttpSchema", () => {
    expect(stateSyncMutateHttpSchema.safeParse({
      op: "patch",
      path: "/players/p1",
      value: { score: 10 },
      expectedRev: 5,
    }).success).toBe(true)

    expect(stateSyncMutateHttpSchema.safeParse({
      op: "delete",
      path: "/",
    }).success).toBe(false)
  })

  it("validates stateSyncWsClientFrameSchema", () => {
    // auth frame
    expect(stateSyncWsClientFrameSchema.safeParse({
      type: "auth",
      token: "sys_test123",
      paths: ["/", "/board"],
      sinceRev: 10,
    }).success).toBe(true)

    // auth with > 32 paths
    const tooManyPaths = Array.from({ length: 33 }, (_, i) => `/path${i}`)
    expect(stateSyncWsClientFrameSchema.safeParse({
      type: "auth",
      token: "sys_test123",
      paths: tooManyPaths,
    }).success).toBe(false)

    // mutate frame with expectedRev
    expect(stateSyncWsClientFrameSchema.safeParse({
      type: "mutate",
      id: "req-1",
      op: "set",
      path: "/board/0",
      value: 1,
      expectedRev: 12,
    }).success).toBe(true)

    expect(stateSyncWsClientFrameSchema.safeParse({
      type: "mutate",
      id: "req-1",
      op: "set",
      path: "/board/0",
      value: 1,
      expectedRev: -1,
    }).success).toBe(false)

    // onDisconnect.set max 8 actions and forbids delete "/"
    expect(stateSyncWsClientFrameSchema.safeParse({
      type: "onDisconnect.set",
      id: "req-d1",
      actions: [
        { op: "delete", path: "/players/p1" },
        { op: "patch", path: "/status", value: { disconnected: true } },
      ],
    }).success).toBe(true)

    expect(stateSyncWsClientFrameSchema.safeParse({
      type: "onDisconnect.set",
      id: "req-d2",
      actions: [
        { op: "delete", path: "/" },
      ],
    }).success).toBe(false)

    const nineActions = Array.from({ length: 9 }, (_, i) => ({
      op: "delete" as const,
      path: `/p${i}`,
    }))
    expect(stateSyncWsClientFrameSchema.safeParse({
      type: "onDisconnect.set",
      actions: nineActions,
    }).success).toBe(false)
  })

  it("validates stateSyncWsServerFrameSchema", () => {
    expect(stateSyncWsServerFrameSchema.safeParse({
      type: "ready",
      spaceId: "ss_1",
      docId: "ssd_1",
      connectionId: "conn_1",
      clientId: "p1",
      role: "create_write",
      rev: 0,
      replayTruncated: false,
      presence: [],
      snapshots: [{ path: "/", exists: true, value: {} }],
    }).success).toBe(true)

    expect(stateSyncWsServerFrameSchema.safeParse({
      type: "mutation",
      rev: 1,
      op: "patch",
      path: "/p1",
      value: { x: 10 },
      replayed: false,
      ts: new Date().toISOString(),
    }).success).toBe(true)

    expect(stateSyncWsServerFrameSchema.safeParse({
      type: "snapshot",
      rev: 2,
      path: "/p1",
      exists: true,
      value: { x: 10 },
    }).success).toBe(true)

    expect(stateSyncWsServerFrameSchema.safeParse({
      type: "ack",
      id: "req-1",
      rev: 1,
      changed: true,
    }).success).toBe(true)

    expect(stateSyncWsServerFrameSchema.safeParse({
      type: "pong",
      serverTime: new Date().toISOString(),
    }).success).toBe(true)

    expect(stateSyncWsServerFrameSchema.safeParse({
      type: "error",
      id: "req-1",
      code: "REV_CONFLICT",
      message: "Version mismatch",
      currentRev: 5,
    }).success).toBe(true)
  })
})

describe("Fix Round 1: Contract tightening and edge-case validation", () => {
  it("Finding 1: rejects op 'set' when value is undefined in mutation engine and schemas", () => {
    const root = { a: 1 }

    // applyStateSyncMutation
    const res = applyStateSyncMutation(root, {
      op: "set",
      path: "/b",
      value: undefined,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.code).toBe("INVALID_INPUT")
    }
    expect(root).toEqual({ a: 1 })

    // stateSyncMutateHttpSchema
    expect(stateSyncMutateHttpSchema.safeParse({
      op: "set",
      path: "/b",
    }).success).toBe(false)

    expect(stateSyncMutateHttpSchema.safeParse({
      op: "set",
      path: "/b",
      value: undefined,
    }).success).toBe(false)

    // stateSyncOnDisconnectActionSchema
    expect(stateSyncOnDisconnectActionSchema.safeParse({
      op: "set",
      path: "/status",
    }).success).toBe(false)

    // wsMutateFrameSchema
    expect(stateSyncWsClientFrameSchema.safeParse({
      type: "mutate",
      id: "m-1",
      op: "set",
      path: "/b",
    }).success).toBe(false)

    expect(stateSyncWsClientFrameSchema.safeParse({
      type: "mutate",
      id: "m-2",
      op: "set",
      path: "/b",
      value: undefined,
    }).success).toBe(false)

    // Valid set with null or value succeeds
    expect(stateSyncMutateHttpSchema.safeParse({
      op: "set",
      path: "/b",
      value: null,
    }).success).toBe(true)
  })

  it("Finding 2: patch on non-existent path with {} creates nodes and returns changed: true", () => {
    const original: Record<string, unknown> = {}
    const res = applyStateSyncMutation(original, {
      op: "patch",
      path: "/nested/node",
      value: {},
    })

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.changed).toBe(true)
      expect(res.nextRoot).toEqual({ nested: { node: {} } })
    }

    // Applying patch {} on an existing empty node returns changed: false
    const existing = { nested: { node: {} } }
    const res2 = applyStateSyncMutation(existing, {
      op: "patch",
      path: "/nested/node",
      value: {},
    })
    expect(res2.ok).toBe(true)
    if (res2.ok) {
      expect(res2.changed).toBe(false)
      expect(res2.nextRoot).toEqual({ nested: { node: {} } })
    }
  })

  it("Finding 3: validateStateSyncJsonValue rejects undefined members, non-finite numbers, and non-plain objects", () => {
    // undefined members in object or array
    expect(validateStateSyncJsonValue({ a: undefined }).ok).toBe(false)
    expect(validateStateSyncJsonValue([1, undefined, 2]).ok).toBe(false)

    // Non-finite numbers
    expect(validateStateSyncJsonValue(NaN).ok).toBe(false)
    expect(validateStateSyncJsonValue(Infinity).ok).toBe(false)
    expect(validateStateSyncJsonValue(-Infinity).ok).toBe(false)
    expect(validateStateSyncJsonValue({ val: NaN }).ok).toBe(false)

    // Non-plain objects (Date, Map, Set, RegExp)
    expect(validateStateSyncJsonValue(new Date()).ok).toBe(false)
    expect(validateStateSyncJsonValue(new Map()).ok).toBe(false)
    expect(validateStateSyncJsonValue(new Set()).ok).toBe(false)
    expect(validateStateSyncJsonValue(/regex/).ok).toBe(false)
    expect(validateStateSyncJsonValue({ created: new Date() }).ok).toBe(false)
    expect(validateStateSyncJsonValue({ map: new Map() }).ok).toBe(false)

    // Functions / Symbols
    expect(validateStateSyncJsonValue({ fn: () => {} }).ok).toBe(false)
  })

  it("Finding 3: patch safely handles Object.prototype keys without prototype pollution or false comparison", () => {
    const root: Record<string, unknown> = { obj: {} }

    // Patching 'toString' onto an empty object must mark changed: true and set own property
    const res1 = applyStateSyncMutation(root, {
      op: "patch",
      path: "/obj",
      value: { toString: "custom_to_string" },
    })
    expect(res1.ok).toBe(true)
    if (res1.ok) {
      expect(res1.changed).toBe(true)
      expect(Object.prototype.hasOwnProperty.call(res1.nextRoot.obj, "toString")).toBe(true)
      expect((res1.nextRoot.obj as Record<string, unknown>).toString).toBe("custom_to_string")
    }

    // Re-patching identical 'toString' must return changed: false
    const res2 = applyStateSyncMutation(res1.ok ? res1.nextRoot : {}, {
      op: "patch",
      path: "/obj",
      value: { toString: "custom_to_string" },
    })
    expect(res2.ok).toBe(true)
    if (res2.ok) {
      expect(res2.changed).toBe(false)
    }

    // Root-level patch with 'valueOf'
    const rootRes = applyStateSyncMutation({}, {
      op: "patch",
      path: "/",
      value: { valueOf: 42 },
    })
    expect(rootRes.ok).toBe(true)
    if (rootRes.ok) {
      expect(rootRes.changed).toBe(true)
      expect(Object.prototype.hasOwnProperty.call(rootRes.nextRoot, "valueOf")).toBe(true)
    }
  })

  it("Finding 4: meta validation in WS auth and presence.update frames validates safely and prevents throwing", () => {
    // Valid meta succeeds
    const validAuth = stateSyncWsClientFrameSchema.safeParse({
      type: "auth",
      token: "sys_token",
      meta: { role: "moderator", color: "#ffffff" },
    })
    expect(validAuth.success).toBe(true)

    // Circular meta does not throw and fails validation
    const circular: Record<string, unknown> = { name: "test" }
    circular.self = circular

    expect(() => {
      const authWithCircular = stateSyncWsClientFrameSchema.safeParse({
        type: "auth",
        token: "sys_token",
        meta: circular,
      })
      expect(authWithCircular.success).toBe(false)
    }).not.toThrow()

    expect(() => {
      const presenceWithCircular = stateSyncWsClientFrameSchema.safeParse({
        type: "presence.update",
        meta: circular,
      })
      expect(presenceWithCircular.success).toBe(false)
    }).not.toThrow()

    // Non-plain object in meta is rejected
    expect(stateSyncWsClientFrameSchema.safeParse({
      type: "auth",
      token: "sys_token",
      meta: { ts: new Date() },
    }).success).toBe(false)

    // Undefined member in meta is rejected
    expect(stateSyncWsClientFrameSchema.safeParse({
      type: "auth",
      token: "sys_token",
      meta: { user: undefined },
    }).success).toBe(false)

    // Dangerous keys in meta are rejected
    const protoMeta = JSON.parse('{"__proto__":{"polluted":true}}')
    expect(stateSyncWsClientFrameSchema.safeParse({
      type: "auth",
      token: "sys_token",
      meta: protoMeta,
    }).success).toBe(false)

    // Meta exceeding 2 KiB is rejected
    const hugeMeta = { data: "x".repeat(STATE_SYNC_META_MAX_BYTES + 10) }
    expect(stateSyncWsClientFrameSchema.safeParse({
      type: "auth",
      token: "sys_token",
      meta: hugeMeta,
    }).success).toBe(false)
  })

  it("Cleanups: readStateSyncPath validates canonical array index /^(0|[1-9]\\d*)$/", () => {
    expect(STATE_SYNC_CANONICAL_INDEX_REGEX.test("0")).toBe(true)
    expect(STATE_SYNC_CANONICAL_INDEX_REGEX.test("1")).toBe(true)
    expect(STATE_SYNC_CANONICAL_INDEX_REGEX.test("123")).toBe(true)
    expect(STATE_SYNC_CANONICAL_INDEX_REGEX.test("00")).toBe(false)
    expect(STATE_SYNC_CANONICAL_INDEX_REGEX.test("01")).toBe(false)
    expect(STATE_SYNC_CANONICAL_INDEX_REGEX.test("+1")).toBe(false)
    expect(STATE_SYNC_CANONICAL_INDEX_REGEX.test("-1")).toBe(false)
    expect(STATE_SYNC_CANONICAL_INDEX_REGEX.test("1.0")).toBe(false)
    expect(STATE_SYNC_CANONICAL_INDEX_REGEX.test("length")).toBe(false)

    const root = {
      items: ["zero", "one", "two"],
    }

    expect(readStateSyncPath(root, "/items/0")).toEqual({ exists: true, value: "zero" })
    expect(readStateSyncPath(root, "/items/1")).toEqual({ exists: true, value: "one" })
    expect(readStateSyncPath(root, "/items/2")).toEqual({ exists: true, value: "two" })

    // Non-canonical index or out-of-bounds returns exists: false
    expect(readStateSyncPath(root, "/items/00")).toEqual({ exists: false, value: undefined })
    expect(readStateSyncPath(root, "/items/01")).toEqual({ exists: false, value: undefined })
    expect(readStateSyncPath(root, "/items/1.0")).toEqual({ exists: false, value: undefined })
    expect(readStateSyncPath(root, "/items/3")).toEqual({ exists: false, value: undefined })
    expect(readStateSyncPath(root, "/items/length")).toEqual({ exists: false, value: undefined })
  })

  it("tags oversized >64 KiB mutations with PAYLOAD_TOO_LARGE issue params and accepts optional ready.replayedCount", () => {
    const seventyKiB = "a".repeat(70 * 1024)
    const httpParsed = stateSyncMutateHttpSchema.safeParse({
      op: "set",
      path: "/blob",
      value: seventyKiB,
    })
    expect(httpParsed.success).toBe(false)
    if (!httpParsed.success) {
      const issue = httpParsed.error.issues[0] as { params?: Record<string, unknown> } | undefined
      expect(issue?.params?.errorCode).toBe("PAYLOAD_TOO_LARGE")
    }

    const wsParsed = stateSyncWsClientFrameSchema.safeParse({
      type: "mutate",
      id: "m-big",
      op: "set",
      path: "/blob",
      value: seventyKiB,
    })
    expect(wsParsed.success).toBe(false)
    if (!wsParsed.success) {
      const issue = wsParsed.error.issues[0] as { params?: Record<string, unknown> } | undefined
      expect(issue?.params?.errorCode).toBe("PAYLOAD_TOO_LARGE")
    }

    expect(stateSyncWsServerFrameSchema.safeParse({
      type: "ready",
      spaceId: "ss_1",
      docId: "ssd_1",
      connectionId: "conn_1",
      clientId: "p1",
      role: "write",
      rev: 5,
      replayTruncated: false,
      replayedCount: 0,
      presence: [],
      snapshots: [],
    }).success).toBe(true)
  })
})
