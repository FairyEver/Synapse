import { afterEach, describe, expect, it, vi } from "vitest"
import { STATE_SYNC_WS_CLOSE_CODES } from "@synapse/shared/state-sync-contracts"
import {
  STATE_SYNC_MANAGE_SCOPE,
  STATE_SYNC_READ_SCOPE,
  STATE_SYNC_WRITE_SCOPE,
} from "../api-keys/api-key-capabilities"
import { ApiKeyChangeNotifier } from "../api-keys/api-key-change-notifier"
import { loadStateSyncConfig } from "./state-sync-config"
import { StateSyncDebugTicketStore } from "./state-sync-debug-ticket"
import { StateSyncHub, type StateSyncSocketAdapter } from "./state-sync-hub"
import { StateSyncService } from "./state-sync.service"

function createFakeSocket(): {
  socket: StateSyncSocketAdapter
  closed: Array<{ code: number; reason: string }>
  sent: Record<string, unknown>[]
} {
  const closed: Array<{ code: number; reason: string }> = []
  const sent: Record<string, unknown>[] = []
  return {
    closed,
    sent,
    socket: {
      bufferedAmount: 0,
      send(data: string) {
        sent.push(JSON.parse(data) as Record<string, unknown>)
      },
      close(code: number, reason: string) {
        closed.push({ code, reason })
      },
    },
  }
}

type SpaceRow = {
  id: string
  ownerId: string
  name: string
  description: string
  defaultDocTtlSeconds: number | null
  maxDocs: number
  createdAt: Date
  updatedAt: Date
}

type TokenRow = {
  id: string
  spaceId: string
  name: string
  role: string
  tokenHash: string
  tokenPrefix: string
  lastUsedAt: Date | null
  revokedAt: Date | null
  createdAt: Date
}

type DocRow = {
  id: string
  spaceId: string
  data: Record<string, unknown>
  rev: bigint
  ttlSeconds: number | null
  expiresAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const activeServices: StateSyncService[] = []

afterEach(() => {
  while (activeServices.length > 0) {
    activeServices.pop()?.onModuleDestroy()
  }
})

function createHarness(envOverrides: Record<string, string> = {}) {
  const spaces = new Map<string, SpaceRow>()
  const tokens = new Map<string, TokenRow>()
  const docs = new Map<string, DocRow>()
  let idSeq = 0

  const docKey = (spaceId: string, id: string) => `${spaceId}:${id}`

  const matchesDocWhere = (doc: DocRow, where?: Record<string, unknown>): boolean => {
    if (!where) return true
    if (typeof where.spaceId === "string" && doc.spaceId !== where.spaceId) return false
    if (typeof where.id === "string" && doc.id !== where.id) return false
    if (Array.isArray(where.OR)) {
      const orMatched = where.OR.some((clause: Record<string, unknown>) => matchesDocWhere(doc, clause))
      if (!orMatched) return false
    }
    if ("expiresAt" in where) {
      const cond = where.expiresAt as null | { not?: null; lt?: Date; gt?: Date }
      if (cond === null) {
        if (doc.expiresAt !== null) return false
      } else if (typeof cond === "object") {
        if (cond.not === null && doc.expiresAt === null) return false
        if (cond.lt instanceof Date) {
          if (!doc.expiresAt || !(doc.expiresAt.getTime() < cond.lt.getTime())) return false
        }
        if (cond.gt instanceof Date) {
          if (!doc.expiresAt || !(doc.expiresAt.getTime() > cond.gt.getTime())) return false
        }
      }
    }
    return true
  }

  const countForSpace = (spaceId: string) => {
    const now = new Date()
    return {
      tokens: [...tokens.values()].filter((t) => t.spaceId === spaceId && t.revokedAt === null).length,
      docs: [...docs.values()].filter((d) => d.spaceId === spaceId && (d.expiresAt === null || d.expiresAt.getTime() > now.getTime())).length,
    }
  }

  const prisma = {
    stateSyncSpace: {
      create: vi.fn(async ({ data }) => {
        const now = new Date("2026-11-25T10:00:00.000Z")
        const row: SpaceRow = {
          id: data.id ?? `ss_${++idSeq}`,
          ownerId: data.ownerId,
          name: data.name,
          description: data.description ?? "",
          defaultDocTtlSeconds: data.defaultDocTtlSeconds === undefined ? 86400 : data.defaultDocTtlSeconds,
          maxDocs: data.maxDocs ?? 100,
          createdAt: now,
          updatedAt: now,
        }
        spaces.set(row.id, row)
        return row
      }),
      findMany: vi.fn(async ({ where }) => {
        return [...spaces.values()]
          .filter((s) => {
            if (where?.ownerId && s.ownerId !== where.ownerId) return false
            if (where?.id?.in && !where.id.in.includes(s.id)) return false
            return true
          })
          .map((s) => ({ ...s, _count: countForSpace(s.id) }))
      }),
      findFirst: vi.fn(async ({ where }) => {
        for (const s of spaces.values()) {
          if (where?.id && s.id !== where.id) continue
          if (where?.ownerId && s.ownerId !== where.ownerId) continue
          return { ...s, _count: countForSpace(s.id) }
        }
        return null
      }),
      findUnique: vi.fn(async ({ where }) => {
        const s = spaces.get(where.id)
        return s ? { ...s, owner: { status: "active" }, _count: countForSpace(s.id) } : null
      }),
      update: vi.fn(async ({ where, data }) => {
        const s = spaces.get(where.id)!
        const next: SpaceRow = { ...s, ...data, updatedAt: new Date("2026-11-25T11:00:00.000Z") }
        spaces.set(s.id, next)
        return { ...next, _count: countForSpace(s.id) }
      }),
      deleteMany: vi.fn(async ({ where }) => {
        const existed = spaces.delete(where.id)
        if (existed) {
          for (const [k, d] of docs) {
            if (d.spaceId === where.id) docs.delete(k)
          }
          for (const [k, t] of tokens) {
            if (t.spaceId === where.id) tokens.delete(k)
          }
        }
        return { count: existed ? 1 : 0 }
      }),
    },
    stateSyncToken: {
      count: vi.fn(async ({ where }) => {
        return [...tokens.values()].filter((t) => t.spaceId === where.spaceId && t.revokedAt === null).length
      }),
      create: vi.fn(async ({ data }) => {
        const row: TokenRow = {
          id: data.id ?? `sst_${++idSeq}`,
          spaceId: data.spaceId,
          name: data.name,
          role: data.role,
          tokenHash: data.tokenHash,
          tokenPrefix: data.tokenPrefix,
          lastUsedAt: null,
          revokedAt: null,
          createdAt: new Date("2026-11-25T10:00:00.000Z"),
        }
        tokens.set(row.id, row)
        return row
      }),
      findMany: vi.fn(async ({ where }) => {
        return [...tokens.values()].filter((t) => t.spaceId === where.spaceId && t.revokedAt === null)
      }),
      findUnique: vi.fn(async ({ where }) => {
        for (const t of tokens.values()) {
          if (t.tokenHash === where.tokenHash) {
            const sp = spaces.get(t.spaceId)
            return sp ? { ...t, space: { ...sp, owner: { status: "active" } } } : null
          }
        }
        return null
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        let count = 0
        for (const t of tokens.values()) {
          if (where?.id && t.id !== where.id) continue
          if (where?.spaceId && t.spaceId !== where.spaceId) continue
          if (where?.revokedAt === null && t.revokedAt !== null) continue
          Object.assign(t, data)
          count++
        }
        return { count }
      }),
    },
    stateSyncDoc: {
      count: vi.fn(async ({ where }) => {
        return [...docs.values()].filter((d) => matchesDocWhere(d, where)).length
      }),
      create: vi.fn(async ({ data }) => {
        const key = docKey(data.spaceId, data.id)
        if (docs.has(key)) {
          const err = new Error("Unique constraint failed") as Error & { code: string }
          err.code = "P2002"
          throw err
        }
        const now = new Date()
        const row: DocRow = {
          id: data.id,
          spaceId: data.spaceId,
          data: structuredClone(data.data ?? {}),
          rev: BigInt(data.rev ?? 0),
          ttlSeconds: data.ttlSeconds ?? null,
          expiresAt: data.expiresAt ?? null,
          createdAt: now,
          updatedAt: now,
        }
        docs.set(key, row)
        return row
      }),
      findUnique: vi.fn(async ({ where }) => {
        const key = docKey(where.spaceId_id.spaceId, where.spaceId_id.id)
        const found = docs.get(key)
        return found ? { ...found, data: structuredClone(found.data) } : null
      }),
      findMany: vi.fn(async ({ where, take }) => {
        const list = [...docs.values()]
          .filter((d) => matchesDocWhere(d, where))
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        return typeof take === "number" ? list.slice(0, take) : list
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        let count = 0
        for (const d of docs.values()) {
          if (!matchesDocWhere(d, where)) continue
          if (data.data !== undefined) d.data = structuredClone(data.data)
          if (data.rev !== undefined) d.rev = BigInt(data.rev)
          if (data.expiresAt !== undefined) d.expiresAt = data.expiresAt
          d.updatedAt = new Date()
          count++
        }
        return { count }
      }),
      deleteMany: vi.fn(async ({ where }) => {
        let count = 0
        for (const [k, d] of [...docs.entries()]) {
          if (!matchesDocWhere(d, where)) continue
          docs.delete(k)
          count++
        }
        return { count }
      }),
    },
    $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => {
      const spacesSnap = new Map(spaces)
      const tokensSnap = new Map(tokens)
      const docsSnap = new Map([...docs].map(([k, v]) => [k, { ...v, data: structuredClone(v.data) }]))
      try {
        return await work(prisma)
      } catch (err) {
        spaces.clear()
        for (const [k, v] of spacesSnap) spaces.set(k, v)
        tokens.clear()
        for (const [k, v] of tokensSnap) tokens.set(k, v)
        docs.clear()
        for (const [k, v] of docsSnap) docs.set(k, v)
        throw err
      }
    }),
  }

  const apiKeyService = {
    verifyOpenApiSecret: vi.fn().mockResolvedValue(null),
    touchLastUsed: vi.fn().mockResolvedValue(undefined),
  }
  const notifier = new ApiKeyChangeNotifier()
  const hub = new StateSyncHub(loadStateSyncConfig(envOverrides))
  const debugTickets = new StateSyncDebugTicketStore()
  const service = new StateSyncService(
    prisma as never,
    apiKeyService as never,
    notifier,
    hub,
    debugTickets,
  )
  service.onModuleInit()
  activeServices.push(service)

  return { service, prisma, apiKeyService, notifier, hub, debugTickets, spaces, tokens, docs }
}

describe("StateSyncService", () => {
  it("enforces space token role matrix (read, write, create_write) and rejects custom docId / null TTL bypass", async () => {
    const { service } = createHarness()
    const consoleActor = { kind: "console" as const, userId: "u1" }
    const space = await service.createSpace(consoleActor, {
      name: "井字棋空间",
      description: "双人对战",
      defaultDocTtlSeconds: 3600,
      maxDocs: 10,
    })

    const readTok = await service.createToken(consoleActor, space.id, { name: "观战", role: "read" })
    const writeTok = await service.createToken(consoleActor, space.id, { name: "玩家", role: "write" })
    const createWriteTok = await service.createToken(consoleActor, space.id, { name: "开房玩家", role: "create_write" })

    const readActor = await service.authenticateOpenCredential(`Bearer ${readTok.secret}`, space.id)
    const writeActor = await service.authenticateOpenCredential(`Bearer ${writeTok.secret}`, space.id)
    const createWriteActor = await service.authenticateOpenCredential(`Bearer ${createWriteTok.secret}`, space.id)

    expect(readActor?.kind).toBe("space_token")
    expect(writeActor?.kind).toBe("space_token")
    expect(createWriteActor?.kind).toBe("space_token")

    // Cross-space token check fails auth
    await expect(service.authenticateOpenCredential(`Bearer ${createWriteTok.secret}`, "ss_other")).resolves.toBeNull()

    // Normal JWT is never accepted by authenticateOpenCredential
    await expect(
      service.authenticateOpenCredential("Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1MSJ9.sig", space.id),
    ).resolves.toBeNull()

    // read token cannot POST /docs
    await expect(service.createDoc(readActor!, space.id, { initialData: {} }))
      .rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN_ROLE" })

    // write token cannot POST /docs
    await expect(service.createDoc(writeActor!, space.id, { initialData: {} }))
      .rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN_ROLE" })

    // create_write token rejects custom docId with 403
    await expect(service.createDoc(createWriteActor!, space.id, { docId: "custom-room-1" }))
      .rejects.toMatchObject({ statusCode: 403 })

    // create_write token rejects ttlSeconds: null when space has finite defaultDocTtlSeconds
    await expect(service.createDoc(createWriteActor!, space.id, { ttlSeconds: null }))
      .rejects.toMatchObject({ statusCode: 403 })

    // create_write token rejects ttlSeconds exceeding space defaultDocTtlSeconds
    await expect(service.createDoc(createWriteActor!, space.id, { ttlSeconds: 7200 }))
      .rejects.toMatchObject({ statusCode: 403 })

    // create_write token creates random ssd_... doc
    const created = await service.createDoc(createWriteActor!, space.id, {
      initialData: { board: { "0": "X" } },
      ttlSeconds: 1800,
    })
    expect(created.docId).toMatch(/^ssd_[A-Za-z0-9_-]{22}$/u)
    expect(created.rev).toBe(0)
    expect(created.expiresAt).not.toBeNull()
    expect(created.wsPath).toBe(`/api/open/v1/state-sync/spaces/${space.id}/docs/${created.docId}/ws`)

    // read token can GET doc & presence, cannot PATCH
    await expect(service.getDoc(readActor!, space.id, created.docId, "/board/0")).resolves.toMatchObject({
      spaceId: space.id,
      docId: created.docId,
      path: "/board/0",
      exists: true,
      value: "X",
      rev: 0,
    })
    await expect(service.getPresence(readActor!, space.id, created.docId)).resolves.toEqual({
      spaceId: space.id,
      docId: created.docId,
      count: 0,
      members: [],
    })
    await expect(service.mutateDoc(readActor!, space.id, created.docId, { op: "set", path: "/board/1", value: "O" }))
      .rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN_ROLE" })

    // write token can GET & PATCH known doc
    await expect(service.mutateDoc(writeActor!, space.id, created.docId, { op: "set", path: "/board/1", value: "O" }))
      .resolves.toMatchObject({ rev: 1, changed: true })
    await expect(service.getDoc(writeActor!, space.id, created.docId, "/board/1")).resolves.toMatchObject({
      exists: true,
      value: "O",
      rev: 1,
    })

    // create_write token cannot list docs, delete doc, list spaces, or manage tokens
    await expect(service.listDocs(createWriteActor!, space.id))
      .rejects.toMatchObject({ statusCode: 403, code: "INSUFFICIENT_SCOPE" })
    await expect(service.deleteDoc(createWriteActor!, space.id, created.docId))
      .rejects.toMatchObject({ statusCode: 403, code: "INSUFFICIENT_SCOPE" })
    await expect(service.listSpaces(createWriteActor!))
      .rejects.toMatchObject({ statusCode: 403, code: "INSUFFICIENT_SCOPE" })
    await expect(service.listTokens(createWriteActor!, space.id))
      .rejects.toMatchObject({ statusCode: 403, code: "INSUFFICIENT_SCOPE" })
  })

  it("enforces UserApiKey scope & space isolation and propagates ApiKeyChangeNotifier events to StateSyncHub", async () => {
    const { service, apiKeyService, notifier, hub } = createHarness()
    const consoleActor = { kind: "console" as const, userId: "u1" }
    const sp1 = await service.createSpace(consoleActor, { name: "Space 1" })
    const sp2 = await service.createSpace(consoleActor, { name: "Space 2" })
    const doc1 = await service.createDoc(consoleActor, sp1.id, { docId: "room-1", initialData: { v: 1 } })
    const doc2 = await service.createDoc(consoleActor, sp2.id, { docId: "room-2", initialData: { v: 2 } })

    // 1. selected + state_sync.manage CANNOT create spaces, and is restricted to stateSyncSpaceIds
    apiKeyService.verifyOpenApiSecret.mockResolvedValueOnce({
      userId: "u1",
      apiKeyId: "k_sel",
      scopes: [STATE_SYNC_MANAGE_SCOPE, STATE_SYNC_READ_SCOPE],
      stateSyncAccessMode: "selected",
      stateSyncSpaceIds: [sp1.id],
    })
    const selActor = await service.authenticateOpenCredential(`Bearer syn_sk_${"a".repeat(43)}`, null)
    await expect(service.createSpace(selActor!, { name: "Forbidden" }))
      .rejects.toMatchObject({ statusCode: 403, code: "INSUFFICIENT_SCOPE" })

    const listed = await service.listSpaces(selActor!)
    expect(listed.data.map((s) => s.id)).toEqual([sp1.id])
    await expect(service.getSpace(selActor!, sp2.id))
      .rejects.toMatchObject({ statusCode: 403, code: "SPACE_ACCESS_DENIED" })
    await expect(service.getDoc(selActor!, sp2.id, doc2.docId))
      .rejects.toMatchObject({ statusCode: 403, code: "SPACE_ACCESS_DENIED" })

    // 2. all_owned + state_sync.write (no manage) CANNOT create spaces or delete docs
    apiKeyService.verifyOpenApiSecret.mockResolvedValueOnce({
      userId: "u1",
      apiKeyId: "k_write",
      scopes: [STATE_SYNC_WRITE_SCOPE],
      stateSyncAccessMode: "all_owned",
      stateSyncSpaceIds: [],
    })
    const writeKeyActor = await service.authenticateOpenCredential(`Bearer syn_sk_${"b".repeat(43)}`, null)
    await expect(service.createSpace(writeKeyActor!, { name: "NoManage" }))
      .rejects.toMatchObject({ statusCode: 403, code: "INSUFFICIENT_SCOPE" })
    await expect(service.deleteDoc(writeKeyActor!, sp1.id, doc1.docId))
      .rejects.toMatchObject({ statusCode: 403, code: "INSUFFICIENT_SCOPE" })

    // 3. all_owned + state_sync.manage CAN create spaces, create custom docId, list & delete docs
    apiKeyService.verifyOpenApiSecret.mockResolvedValueOnce({
      userId: "u1",
      apiKeyId: "k_mgr",
      scopes: [STATE_SYNC_MANAGE_SCOPE],
      stateSyncAccessMode: "all_owned",
      stateSyncSpaceIds: [],
    })
    const mgrActor = await service.authenticateOpenCredential(`Bearer syn_sk_${"c".repeat(43)}`, null)
    const sp3 = await service.createSpace(mgrActor!, { name: "Space 3", defaultDocTtlSeconds: null })
    expect(sp3.name).toBe("Space 3")
    const customDoc = await service.createDoc(mgrActor!, sp3.id, { docId: "lobby-main", ttlSeconds: null })
    expect(customDoc.docId).toBe("lobby-main")
    const docList = await service.listDocs(mgrActor!, sp3.id)
    expect(docList.data.map((d) => d.docId)).toEqual(["lobby-main"])
    await expect(service.deleteDoc(mgrActor!, sp3.id, "lobby-main")).resolves.toEqual({ deleted: true })

    // 4. ApiKeyChangeNotifier events propagate to StateSyncHub.handleApiKeyChange
    const snap1 = await service.loadDocForGateway(sp1.id, doc1.docId)
    const snap2 = await service.loadDocForGateway(sp2.id, doc2.docId)
    const sock1 = createFakeSocket()
    const sock2 = createFakeSocket()

    hub.registerConnection({
      spaceId: sp1.id, docId: doc1.docId, ownerId: "u1",
      credentialType: "api_key", credentialId: "k_live",
      role: "create_write", isObserver: false,
      clientId: "c1", clientName: null, meta: {},
      socket: sock1.socket, docSnapshot: snap1!,
    })
    hub.registerConnection({
      spaceId: sp2.id, docId: doc2.docId, ownerId: "u1",
      credentialType: "api_key", credentialId: "k_live",
      role: "create_write", isObserver: false,
      clientId: "c2", clientName: null, meta: {},
      socket: sock2.socket, docSnapshot: snap2!,
    })

    // Downgrade k_live: drop sp2 (4003) and narrow sp1 to read-only (4004)
    notifier.emit({
      kind: "updated",
      userId: "u1",
      apiKeyId: "k_live",
      scopes: [STATE_SYNC_READ_SCOPE],
      channelAccessMode: "selected",
      channelIds: [],
      stateSyncAccessMode: "selected",
      stateSyncSpaceIds: [sp1.id],
    })

    expect(sock2.closed[0]?.code).toBe(STATE_SYNC_WS_CLOSE_CODES.REVOKED)
    expect(sock1.closed[0]?.code).toBe(STATE_SYNC_WS_CLOSE_CODES.ROLE_CHANGED)
  })

  it("enforces maxDocs ceiling, persists PATCH synchronously to PG with live Hub broadcast, and returns 409 REV_CONFLICT with currentRev", async () => {
    const { service, hub, docs } = createHarness()
    const consoleActor = { kind: "console" as const, userId: "u1" }
    const space = await service.createSpace(consoleActor, { name: "限额空间", maxDocs: 2 })

    const d1 = await service.createDoc(consoleActor, space.id, { docId: "doc-1", initialData: { score: 0 } })
    await service.createDoc(consoleActor, space.id, { docId: "doc-2" })

    // 3rd doc exceeds maxDocs=2
    await expect(service.createDoc(consoleActor, space.id, { docId: "doc-3" }))
      .rejects.toMatchObject({ statusCode: 422, code: "DOC_LIMIT_EXCEEDED" })

    // Once doc-2 expires, it no longer counts against maxDocs
    docs.get(`${space.id}:doc-2`)!.expiresAt = new Date(Date.now() - 5_000)
    await expect(service.createDoc(consoleActor, space.id, { docId: "doc-3" }))
      .resolves.toMatchObject({ docId: "doc-3", rev: 0 })

    // Attach a live WS subscriber to doc-1
    const snap = await service.loadDocForGateway(space.id, d1.docId)
    const subscriber = createFakeSocket()
    const reg = hub.registerConnection({
      spaceId: space.id, docId: d1.docId, ownerId: "u1",
      credentialType: "space_token", credentialId: "sst_sub",
      role: "read", isObserver: false,
      clientId: "viewer-1", clientName: "观众", meta: {},
      paths: ["/"], socket: subscriber.socket, docSnapshot: snap!,
    })
    expect(reg.ok).toBe(true)

    // HTTP PATCH persists synchronously to PG AND broadcasts to live subscriber
    const patched = await service.mutateDoc(consoleActor, space.id, d1.docId, {
      op: "patch",
      path: "/",
      value: { score: 42, phase: "playing" },
      expectedRev: 0,
      actorClientId: "referee",
      actorName: "裁判",
    })
    expect(patched).toMatchObject({ rev: 1, changed: true })

    // PG row updated immediately (synchronous persistence, no debounce wait)
    const persisted = docs.get(`${space.id}:${d1.docId}`)
    expect(persisted?.rev).toBe(1n)
    expect(persisted?.data).toEqual({ score: 42, phase: "playing" })

    // Live WS subscriber received mutation broadcast
    expect(subscriber.sent).toHaveLength(1)
    expect(subscriber.sent[0]).toMatchObject({
      type: "mutation",
      rev: 1,
      op: "patch",
      path: "/",
      value: { score: 42, phase: "playing" },
      actor: { clientId: "referee", clientName: "裁判" },
    })

    // Stale expectedRev returns 409 REV_CONFLICT with currentRev: 1
    await expect(
      service.mutateDoc(consoleActor, space.id, d1.docId, {
        op: "set",
        path: "/score",
        value: 99,
        expectedRev: 0,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "REV_CONFLICT",
      currentRev: 1,
    })

    // Deleting doc disconnects live WS subscriber with 4003
    await expect(service.deleteDoc(consoleActor, space.id, d1.docId)).resolves.toEqual({ deleted: true })
    expect(subscriber.closed[0]?.code).toBe(STATE_SYNC_WS_CLOSE_CODES.REVOKED)
  })

  it("sweeps expired idle docs while preserving active docs and non-expired docs", async () => {
    const { service, hub, docs } = createHarness()
    const consoleActor = { kind: "console" as const, userId: "u1" }
    const space = await service.createSpace(consoleActor, { name: "清理空间", defaultDocTtlSeconds: 60 })

    await service.createDoc(consoleActor, space.id, { docId: "expired-idle" })
    await service.createDoc(consoleActor, space.id, { docId: "expired-active" })
    await service.createDoc(consoleActor, space.id, { docId: "fresh-doc" })

    const past = new Date(Date.now() - 10_000)
    const future = new Date(Date.now() + 60_000)
    docs.get(`${space.id}:expired-idle`)!.expiresAt = past
    docs.get(`${space.id}:expired-active`)!.expiresAt = past
    docs.get(`${space.id}:fresh-doc`)!.expiresAt = future

    // Register an active connection on expired-active
    const activeSock = createFakeSocket()
    hub.registerConnection({
      spaceId: space.id, docId: "expired-active", ownerId: "u1",
      credentialType: "space_token", credentialId: "sst_1",
      role: "write", isObserver: false,
      clientId: "p1", clientName: null, meta: {},
      socket: activeSock.socket,
      docSnapshot: {
        spaceId: space.id, docId: "expired-active", data: {}, rev: 0n, ttlSeconds: 60, expiresAt: past,
      },
    })

    const sweepResult = await service.sweepExpiredDocs(new Date())
    expect(sweepResult.deletedCount).toBe(1)
    expect(sweepResult.skippedActiveCount).toBe(1)

    expect(docs.has(`${space.id}:expired-idle`)).toBe(false)
    expect(docs.has(`${space.id}:expired-active`)).toBe(true)
    expect(docs.has(`${space.id}:fresh-doc`)).toBe(true)
  })

  it("serves Console preflight with SDK metadata and single-use WS debug tickets", async () => {
    const { service } = createHarness()
    const consoleActor = { kind: "console" as const, userId: "u1" }

    const preflight = service.getPreflight(consoleActor)
    expect(preflight).toMatchObject({
      ready: true,
      accountId: "u1",
      publicHttpBaseUrl: expect.stringContaining("/api/open/v1/state-sync"),
      publicWsBaseUrl: expect.stringContaining("/api/open/v1/state-sync"),
      sdkManifestUrl: expect.stringContaining("/sdk/manifest.json"),
      latestStateSyncSdkVersion: expect.any(String),
    })

    const space = await service.createSpace(consoleActor, { name: "调试空间" })
    const doc = await service.createDoc(consoleActor, space.id, { docId: "dbg-room" })
    const tok = await service.createToken(consoleActor, space.id, { name: "r", role: "read" })
    const openActor = await service.authenticateOpenCredential(`Bearer ${tok.secret}`, space.id)

    // Non-console cannot call getPreflight or issueDebugTicket
    expect(() => service.getPreflight(openActor!)).toThrowError()
    await expect(service.issueDebugTicket(openActor!, space.id, doc.docId))
      .rejects.toMatchObject({ statusCode: 403, code: "INSUFFICIENT_SCOPE" })

    // Console issues single-use debug ticket -> authenticates WS as observer once, then fails reuse
    const issued = await service.issueDebugTicket(consoleActor, space.id, doc.docId)
    const wsCred1 = await service.authenticateWsToken(space.id, doc.docId, issued.ticket)
    expect(wsCred1).toMatchObject({
      spaceId: space.id,
      docId: doc.docId,
      ownerId: "u1",
      credentialType: "console_ticket",
      role: "read",
      isObserver: true,
    })
    const wsCred2 = await service.authenticateWsToken(space.id, doc.docId, issued.ticket)
    expect(wsCred2).toBeNull()

    // authenticateWsToken accepts space token, disconnects on revokeToken, and rejects revoked token
    const wsTokCred = await service.authenticateWsToken(space.id, doc.docId, tok.secret)
    expect(wsTokCred).toMatchObject({
      spaceId: space.id,
      docId: doc.docId,
      credentialType: "space_token",
      credentialId: tok.token.id,
      role: "read",
      isObserver: false,
    })

    const snap = await service.loadDocForGateway(space.id, doc.docId)
    const tokSock = createFakeSocket()
    service.hub.registerConnection({
      spaceId: space.id, docId: doc.docId, ownerId: "u1",
      credentialType: "space_token", credentialId: tok.token.id,
      role: "read", isObserver: false,
      clientId: "c-tok", clientName: null, meta: {},
      socket: tokSock.socket, docSnapshot: snap!,
    })
    await expect(service.revokeToken(consoleActor, space.id, tok.token.id)).resolves.toEqual({ revoked: true })
    expect(tokSock.closed[0]?.code).toBe(STATE_SYNC_WS_CLOSE_CODES.REVOKED)
    await expect(service.authenticateWsToken(space.id, doc.docId, tok.secret)).resolves.toBeNull()
  })

  it("persistHubDoc count === 0 evicts phantom Hub handle and surfaces DOC_NOT_FOUND (404), not 500", async () => {
    const { service, hub, docs } = createHarness()
    const consoleActor = { kind: "console" as const, userId: "u1" }
    const space = await service.createSpace(consoleActor, { name: "落盘测试空间" })
    const doc = await service.createDoc(consoleActor, space.id, { docId: "phantom-doc", initialData: { count: 0 } })

    const snap = await service.loadDocForGateway(space.id, doc.docId)
    const subscriber = createFakeSocket()
    hub.registerConnection({
      spaceId: space.id,
      docId: doc.docId,
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "sst_1",
      role: "read",
      isObserver: false,
      clientId: "sub-1",
      clientName: null,
      meta: {},
      socket: subscriber.socket,
      docSnapshot: snap!,
    })

    // Simulate PG row deletion behind Hub's back
    docs.delete(`${space.id}:${doc.docId}`)

    // Mutate triggers sync persist, updateMany count===0, evicts phantom handle, and surfaces 404 DOC_NOT_FOUND
    await expect(
      service.mutateDoc(consoleActor, space.id, doc.docId, {
        op: "set",
        path: "/count",
        value: 1,
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "DOC_NOT_FOUND",
    })

    // Phantom handle must be evicted from Hub
    expect(hub.getDocHandle(space.id, doc.docId)).toBeNull()

    // Live socket must be closed with 4003 REVOKED
    expect(subscriber.closed[0]?.code).toBe(STATE_SYNC_WS_CLOSE_CODES.REVOKED)

    // Subsequent mutate also rejects with 404 immediately
    await expect(
      service.mutateDoc(consoleActor, space.id, doc.docId, {
        op: "set",
        path: "/count",
        value: 2,
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "DOC_NOT_FOUND",
    })
  })

  it("createDoc custom-ID replacement respects dirty/renewed Hub expiresAt and does not evict Hub on rolled-back transaction (e.g. DOC_LIMIT_EXCEEDED)", async () => {
    const { service, hub, docs } = createHarness()
    const consoleActor = { kind: "console" as const, userId: "u1" }
    const space = await service.createSpace(consoleActor, { name: "并发建房空间", maxDocs: 1 })

    // 1. Existing doc expired in PG, but Hub handle is dirty -> rejected with 409
    const d1 = await service.createDoc(consoleActor, space.id, { docId: "custom-1", initialData: { v: 1 } })
    const snap1 = await service.loadDocForGateway(space.id, d1.docId)
    hub.loadOrAttachDoc(snap1!)
    docs.get(`${space.id}:${d1.docId}`)!.expiresAt = new Date(Date.now() - 10_000)

    // Trigger mutation without sync persist to make it dirty
    await hub.mutate(space.id, d1.docId, { op: "set", path: "/v", value: 2, syncPersist: false })
    expect(hub.getDocHandle(space.id, d1.docId)?.dirty).toBe(true)

    await expect(
      service.createDoc(consoleActor, space.id, { docId: "custom-1" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "DOC_ALREADY_EXISTS",
    })

    // 2. Existing doc expired in PG, but Hub handle expiresAt is renewed to the future -> rejected with 409
    const sp2 = await service.createSpace(consoleActor, { name: "续期空间", maxDocs: 5 })
    const d2 = await service.createDoc(consoleActor, sp2.id, { docId: "custom-2" })
    const snap2 = await service.loadDocForGateway(sp2.id, d2.docId)
    hub.loadOrAttachDoc(snap2!)
    docs.get(`${sp2.id}:${d2.docId}`)!.expiresAt = new Date(Date.now() - 10_000)

    // Renew hub handle expiresAt into the future
    const liveDoc = (hub as unknown as { docs: Map<string, { expiresAt: Date | null; dirty: boolean }> }).docs.get(
      `${sp2.id}:${d2.docId}`,
    )
    expect(liveDoc).toBeDefined()
    liveDoc!.expiresAt = new Date(Date.now() + 60_000)
    liveDoc!.dirty = false

    await expect(
      service.createDoc(consoleActor, sp2.id, { docId: "custom-2" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "DOC_ALREADY_EXISTS",
    })

    // 3. Existing doc expired in PG & Hub, but transaction fails with DOC_LIMIT_EXCEEDED -> does NOT evict Hub entry
    const sp3 = await service.createSpace(consoleActor, { name: "限额回滚空间", maxDocs: 1 })
    // Create an active non-expired doc that consumes maxDocs=1 quota
    await service.createDoc(consoleActor, sp3.id, { docId: "active-doc", ttlSeconds: null })

    // Insert an expired doc row into docs map & attach in Hub
    const past = new Date(Date.now() - 20_000)
    docs.set(`${sp3.id}:expired-room`, {
      id: "expired-room",
      spaceId: sp3.id,
      data: { old: true },
      rev: 0n,
      ttlSeconds: 10,
      expiresAt: past,
      createdAt: past,
      updatedAt: past,
    })
    hub.loadOrAttachDoc({
      spaceId: sp3.id,
      docId: "expired-room",
      data: { old: true },
      rev: 0n,
      ttlSeconds: 10,
      expiresAt: past,
    })
    expect(hub.getDocHandle(sp3.id, "expired-room")).not.toBeNull()

    // Attempting to recreate "expired-room": deleted in tx, but activeCount (active-doc) >= maxDocs (1) throws 422
    await expect(
      service.createDoc(consoleActor, sp3.id, { docId: "expired-room" }),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "DOC_LIMIT_EXCEEDED",
    })

    // Transaction was rolled back: Hub handle must NOT have been evicted!
    expect(hub.getDocHandle(sp3.id, "expired-room")).not.toBeNull()
  })

  it("deleteSpace disconnects live WS with 4003 & debug ticket resolves role=\"read\" + isObserver=true", async () => {
    const { service, hub } = createHarness()
    const consoleActor = { kind: "console" as const, userId: "u1" }
    const space = await service.createSpace(consoleActor, { name: "删除空间测试" })
    const doc = await service.createDoc(consoleActor, space.id, { docId: "space-ws-doc" })

    // 1. deleteSpace disconnects live WS with 4003 REVOKED
    const snap = await service.loadDocForGateway(space.id, doc.docId)
    const subscriber = createFakeSocket()
    hub.registerConnection({
      spaceId: space.id,
      docId: doc.docId,
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "sst_1",
      role: "read",
      isObserver: false,
      clientId: "sub-1",
      clientName: null,
      meta: {},
      socket: subscriber.socket,
      docSnapshot: snap!,
    })

    await expect(service.deleteSpace(consoleActor, space.id)).resolves.toEqual({ deleted: true })
    expect(subscriber.closed[0]?.code).toBe(STATE_SYNC_WS_CLOSE_CODES.REVOKED)
    expect(subscriber.closed[0]?.reason).toBe("Space deleted")
    expect(hub.getDocHandle(space.id, doc.docId)).toBeNull()

    // 2. Debug ticket resolves role="read" and isObserver=true
    const sp2 = await service.createSpace(consoleActor, { name: "调试票据空间" })
    const doc2 = await service.createDoc(consoleActor, sp2.id, { docId: "dbg-doc" })
    const issued = await service.issueDebugTicket(consoleActor, sp2.id, doc2.docId)
    const wsCred = await service.authenticateWsToken(sp2.id, doc2.docId, issued.ticket)

    expect(wsCred).toEqual({
      spaceId: sp2.id,
      docId: doc2.docId,
      ownerId: "u1",
      credentialType: "console_ticket",
      credentialId: expect.stringMatching(/^dbg_[a-f0-9]+$/),
      role: "read",
      isObserver: true,
      docSnapshot: expect.objectContaining({
        spaceId: sp2.id,
        docId: doc2.docId,
        rev: 0n,
      }),
    })
  })

  it("returns HTTP 413 PAYLOAD_TOO_LARGE when a 70 KiB write exceeds the 64 KiB single-write limit", async () => {
    const { service } = createHarness()
    const consoleActor = { kind: "console" as const, userId: "u1" }
    const space = await service.createSpace(consoleActor, { name: "载荷上限空间" })
    const doc = await service.createDoc(consoleActor, space.id, { docId: "payload-limit-doc" })

    const seventyKiB = "x".repeat(70 * 1024)
    await expect(
      service.mutateDoc(consoleActor, space.id, doc.docId, {
        op: "set",
        path: "/blob",
        value: seventyKiB,
      }),
    ).rejects.toMatchObject({
      statusCode: 413,
      code: "PAYLOAD_TOO_LARGE",
    })
  })
})
