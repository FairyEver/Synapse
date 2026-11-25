import { afterEach, describe, expect, it, vi } from "vitest"
import { STATE_SYNC_WS_CLOSE_CODES } from "@synapse/shared/state-sync-contracts"
import { STATE_SYNC_READ_SCOPE, STATE_SYNC_WRITE_SCOPE } from "../api-keys/api-key-capabilities"
import { loadStateSyncConfig } from "./state-sync-config"
import { StateSyncDebugTicketStore, isStateSyncDebugTicket } from "./state-sync-debug-ticket"
import {
  StateSyncHub,
  type PersistDocInput,
  type StateSyncSocketAdapter,
} from "./state-sync-hub"
import {
  createStateSyncDocId,
  createStateSyncTokenSecret,
  getStateSyncTokenPrefix,
  hashStateSyncTokenSecret,
  isStateSyncTokenSecret,
} from "./state-sync-token"
import { StateSyncSubscriptionTrie } from "./state-sync-trie"

function createFakeSocket(options: { bufferedAmount?: number; throwOnSend?: boolean } = {}) {
  const sent: Record<string, unknown>[] = []
  const closed: Array<{ code: number; reason: string }> = []
  let buffered = options.bufferedAmount ?? 0
  let shouldThrow = options.throwOnSend ?? false

  const socket: StateSyncSocketAdapter = {
    get bufferedAmount() {
      return buffered
    },
    send(data: string) {
      if (shouldThrow) throw new Error("EPIPE")
      sent.push(JSON.parse(data) as Record<string, unknown>)
    },
    close(code: number, reason: string) {
      closed.push({ code, reason })
    },
  }

  return {
    socket,
    sent,
    closed,
    setBufferedAmount(next: number) {
      buffered = next
    },
    setThrowOnSend(next: boolean) {
      shouldThrow = next
    },
  }
}

function attachEmptyDoc(
  hub: StateSyncHub,
  spaceId = "ss_1",
  docId = "ssd_room1",
  data: Record<string, unknown> = {},
  rev = 0n,
  ttlSeconds: number | null = 3600,
) {
  return hub.loadOrAttachDoc({
    spaceId,
    docId,
    data,
    rev,
    ttlSeconds,
    expiresAt: ttlSeconds !== null ? new Date(Date.now() + ttlSeconds * 1000) : null,
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe("state-sync-config", () => {
  it("loads all Global Constraints defaults accurately", () => {
    const cfg = loadStateSyncConfig({})
    expect(cfg).toEqual({
      maxDocBytes: 262144,
      maxWriteBytes: 65536,
      maxWsFrameBytes: 131072,
      maxHttpBodyBytes: 262144,
      maxMetaBytes: 2048,
      maxPathDepth: 16,
      maxValueDepth: 32,
      maxSubscribedPaths: 32,
      maxOnDisconnectActions: 8,
      defaultMaxDocsPerSpace: 100,
      maxDocsPerSpaceCap: 500,
      maxTokensPerSpace: 20,
      maxConnectionsPerDoc: 50,
      maxObserversPerDoc: 5,
      maxConnectionsPerSpace: 200,
      maxConnectionsPerAccount: 300,
      maxGlobalConnections: 2000,
      wsRatePerSec: 20,
      wsBurst: 60,
      docWriteRatePerSec: 60,
      docWriteBurst: 120,
      docCreateRatePerMin: 10,
      docCreateBurst: 30,
      authTimeoutMs: 5000,
      heartbeatIntervalMs: 25000,
      maxMissedHeartbeats: 2,
      slowConsumerBytes: 524288,
      replayMaxItems: 100,
      replayWindowMs: 300000,
      flushDebounceMs: 500,
      flushMaxWaitMs: 2000,
      idleEvictMs: 300000,
      expirySweepIntervalMs: 300000,
      shutdownFlushTimeoutMs: 5000,
    })
  })

  it("supports positive integer environment overrides and ignores invalid values", () => {
    const cfg = loadStateSyncConfig({
      STATE_SYNC_MAX_CONNECTIONS_PER_DOC: "25",
      STATE_SYNC_FLUSH_DEBOUNCE_MS: "0",
      STATE_SYNC_REPLAY_MAX_ITEMS: "abc",
      STATE_SYNC_SHUTDOWN_FLUSH_TIMEOUT_MS: "8000",
    })
    expect(cfg.maxConnectionsPerDoc).toBe(25)
    expect(cfg.flushDebounceMs).toBe(500)
    expect(cfg.replayMaxItems).toBe(100)
    expect(cfg.shutdownFlushTimeoutMs).toBe(8000)
  })
})

describe("state-sync-token & state-sync-debug-ticket", () => {
  it("generates sys_ tokens, hashes deterministically, and creates 128-bit ssd_ doc IDs", () => {
    const secret = createStateSyncTokenSecret()
    expect(secret.startsWith("sys_")).toBe(true)
    expect(isStateSyncTokenSecret(secret)).toBe(true)
    expect(getStateSyncTokenPrefix(secret)).toBe(secret.slice(0, 12))
    expect(hashStateSyncTokenSecret(secret)).toHaveLength(64)
    expect(hashStateSyncTokenSecret(secret)).toBe(hashStateSyncTokenSecret(secret))
    expect(isStateSyncTokenSecret("syc_12345678901234567890123456789012")).toBe(false)

    const docId1 = createStateSyncDocId()
    const docId2 = createStateSyncDocId()
    expect(docId1).toMatch(/^ssd_[A-Za-z0-9_-]{22}$/)
    expect(docId2).toMatch(/^ssd_[A-Za-z0-9_-]{22}$/)
    expect(docId1).not.toBe(docId2)
  })

  it("issues single-use 60s debug tickets bound to spaceId and docId", () => {
    const store = new StateSyncDebugTicketStore()
    const now = 1_700_000_000_000
    const issued = store.issue("ss_1", "ssd_1", "user_1", now)
    expect(isStateSyncDebugTicket(issued.ticket)).toBe(true)

    // Mismatched spaceId or docId must not consume the ticket
    expect(store.consume(issued.ticket, "ss_other", "ssd_1", now + 1000)).toBeNull()
    expect(store.consume(issued.ticket, "ss_1", "ssd_other", now + 1000)).toBeNull()
    expect(store.consume(issued.ticket, "ss_1", "ssd_1", now + 1000)).toEqual({ ownerId: "user_1" })
    // Single-use
    expect(store.consume(issued.ticket, "ss_1", "ssd_1", now + 2000)).toBeNull()

    // Expiry after 60s
    const expiring = store.issue("ss_1", "ssd_1", "user_1", now)
    expect(store.consume(expiring.ticket, "ss_1", "ssd_1", now + 60_001)).toBeNull()
  })
})

describe("StateSyncSubscriptionTrie & ancestor overwrite deduplication (Review Focus #2)", () => {
  it("deduplicates overlapping ancestor and descendant subscriptions per connection", () => {
    const trie = new StateSyncSubscriptionTrie()
    trie.subscribe("connA", ["/players", "/players/p1"])
    trie.subscribe("connB", ["/players/p1"])
    trie.subscribe("connC", ["/players", "/board"])
    trie.subscribe("connRoot", ["/", "/players"])

    // Write at /players: connA & connC & connRoot get mutation only (deduped); connB gets snapshot for /players/p1
    const onDeletePlayers = trie.resolveAffected("/players")
    expect([...onDeletePlayers.mutationRecipients].sort()).toEqual(["connA", "connC", "connRoot"])
    expect(onDeletePlayers.snapshotRecipients.has("connA")).toBe(false)
    expect(onDeletePlayers.snapshotRecipients.get("connB")).toEqual(["/players/p1"])

    // Write at /: connRoot gets mutation; connA gets deduped ["/players"]; connB gets ["/players/p1"]; connC gets ["/board", "/players"]
    const onSetRoot = trie.resolveAffected("/")
    expect([...onSetRoot.mutationRecipients]).toEqual(["connRoot"])
    expect(onSetRoot.snapshotRecipients.get("connA")).toEqual(["/players"])
    expect(onSetRoot.snapshotRecipients.get("connB")).toEqual(["/players/p1"])
    expect(onSetRoot.snapshotRecipients.get("connC")?.slice().sort()).toEqual(["/board", "/players"])

    // Unsubscribe and removeConnection clean up cleanly
    trie.unsubscribe("connA", ["/players"])
    expect(trie.getSubscribedPaths("connA")).toEqual(["/players/p1"])
    trie.removeConnection("connB")
    expect(trie.getSubscribedPaths("connB")).toEqual([])
  })

  it("delivers deduplicated updates and exists:false snapshots on delete('/players') and set('/', {}) without stale data", async () => {
    const hub = new StateSyncHub(loadStateSyncConfig({}))
    attachEmptyDoc(hub, "ss_1", "ssd_1", {
      players: { p1: { hp: 100 }, p2: { hp: 80 } },
      board: { cell0: "X" },
    })

    const sockA = createFakeSocket()
    const sockB = createFakeSocket()
    const sockChildOnly = createFakeSocket()
    const sockDisjoint = createFakeSocket()

    const regA = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_1",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "tok_1",
      role: "read",
      isObserver: false,
      clientId: "client-a",
      clientName: "A",
      meta: {},
      paths: ["/players", "/players/p1"],
      socket: sockA.socket,
    })
    const regB = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_1",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "tok_2",
      role: "write",
      isObserver: false,
      clientId: "client-b",
      clientName: "B",
      meta: {},
      paths: ["/"],
      socket: sockB.socket,
    })
    const regChild = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_1",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "tok_1",
      role: "read",
      isObserver: false,
      clientId: "client-child",
      clientName: "Child",
      meta: {},
      paths: ["/players/p1"],
      socket: sockChildOnly.socket,
    })
    const regDisjoint = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_1",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "tok_1",
      role: "read",
      isObserver: false,
      clientId: "client-disjoint",
      clientName: "Disjoint",
      meta: {},
      paths: ["/players", "/board"],
      socket: sockDisjoint.socket,
    })

    expect(regA.ok && regB.ok && regChild.ok && regDisjoint.ok).toBe(true)
    if (!regA.ok || !regB.ok) return

    sockA.sent.length = 0
    sockB.sent.length = 0
    sockChildOnly.sent.length = 0
    sockDisjoint.sent.length = 0

    // 1. Client B runs delete("/players")
    const delRes = await hub.mutate("ss_1", "ssd_1", {
      op: "delete",
      path: "/players",
      sourceConnectionId: regB.connection.connectionId,
      actor: { connectionId: regB.connection.connectionId, clientId: "client-b", clientName: "B" },
    })
    expect(delRes.ok).toBe(true)

    // Client A subscribed to ["/players", "/players/p1"] receives exactly ONE deduplicated mutation (no redundant snapshot)
    expect(sockA.sent).toHaveLength(1)
    expect(sockA.sent[0]).toMatchObject({ type: "mutation", op: "delete", path: "/players", rev: 1 })
    // Child-only subscriber gets snapshot with exists: false for /players/p1
    expect(sockChildOnly.sent).toEqual([
      { type: "snapshot", rev: 1, path: "/players/p1", exists: false },
    ])
    // Hub doc itself has exists: false for /players/p1
    expect(hub.readDocPath("ss_1", "ssd_1", "/players/p1")).toMatchObject({ exists: false, value: undefined })

    // Re-seed /players/p1 and /board, then Client B runs set("/", {})
    await hub.mutate("ss_1", "ssd_1", {
      op: "set",
      path: "/players",
      value: { p1: { hp: 50 } },
      sourceConnectionId: regB.connection.connectionId,
    })
    sockA.sent.length = 0
    sockChildOnly.sent.length = 0
    sockDisjoint.sent.length = 0

    const resetRes = await hub.mutate("ss_1", "ssd_1", {
      op: "set",
      path: "/",
      value: {},
      sourceConnectionId: regB.connection.connectionId,
    })
    expect(resetRes.ok).toBe(true)

    // Client A subscribed to ["/players", "/players/p1"] receives ONE deduplicated snapshot for "/players" (exists: false)
    expect(sockA.sent).toEqual([
      { type: "snapshot", rev: 3, path: "/players", exists: false },
    ])
    // Child-only subscriber receives snapshot for "/players/p1" with exists: false
    expect(sockChildOnly.sent).toEqual([
      { type: "snapshot", rev: 3, path: "/players/p1", exists: false },
    ])
    // Disjoint subscriber receives snapshots for both "/players" and "/board" with exists: false
    expect(sockDisjoint.sent).toHaveLength(2)
    expect(sockDisjoint.sent.map((f) => ({ path: f.path, exists: f.exists })).sort((a, b) => String(a.path).localeCompare(String(b.path)))).toEqual([
      { path: "/board", exists: false },
      { path: "/players", exists: false },
    ])

    // Dynamic subscribe/unsubscribe
    const subRes = hub.updateSubscriptions("ss_1", "ssd_1", regA.connection.connectionId, "subscribe", ["/meta"])
    expect(subRes.ok).toBe(true)
    if (subRes.ok) {
      expect(subRes.snapshots).toEqual([{ path: "/meta", exists: false, value: undefined }])
      expect(subRes.rev).toBe(3n)
    }

    await hub.shutdown()
  })
})

describe("StateSyncHub serial writes, CAS expectedRev, and DOC_TOO_LARGE rollback (Review Focus #1)", () => {
  it("serializes concurrent writes strictly in FIFO order even with async syncPersist", async () => {
    const hub = new StateSyncHub(loadStateSyncConfig({}))
    const persistedRevs: bigint[] = []
    let releaseFirstPersist!: () => void
    const firstPersistBarrier = new Promise<void>((resolve) => {
      releaseFirstPersist = resolve
    })

    let callIndex = 0
    hub.configurePersister(async (doc) => {
      callIndex += 1
      if (callIndex === 1) {
        await firstPersistBarrier
      }
      persistedRevs.push(doc.rev)
    })

    attachEmptyDoc(hub, "ss_1", "ssd_serial", {})

    const p1 = hub.mutate("ss_1", "ssd_serial", {
      op: "set",
      path: "/step",
      value: 1,
      syncPersist: true,
    })
    const p2 = hub.mutate("ss_1", "ssd_serial", {
      op: "set",
      path: "/step",
      value: 2,
      syncPersist: true,
    })
    const p3 = hub.mutate("ss_1", "ssd_serial", {
      op: "set",
      path: "/step",
      value: 3,
      syncPersist: true,
    })

    // Second and third writes must wait behind the first write
    await Promise.resolve()
    expect(persistedRevs).toEqual([])

    releaseFirstPersist()
    const [r1, r2, r3] = await Promise.all([p1, p2, p3])
    expect(r1.ok && r2.ok && r3.ok).toBe(true)
    if (r1.ok && r2.ok && r3.ok) {
      expect([r1.rev, r2.rev, r3.rev]).toEqual([1n, 2n, 3n])
    }
    expect(persistedRevs).toEqual([1n, 2n, 3n])
    expect(hub.readDocPath("ss_1", "ssd_serial", "/step")).toMatchObject({ exists: true, value: 3, rev: 3n })

    await hub.shutdown()
  })

  it("enforces expectedRev CAS returning REV_CONFLICT with currentRev", async () => {
    const hub = new StateSyncHub(loadStateSyncConfig({}))
    attachEmptyDoc(hub, "ss_1", "ssd_cas", { turn: "p1" }, 5n)

    const okRes = await hub.mutate("ss_1", "ssd_cas", {
      op: "set",
      path: "/turn",
      value: "p2",
      expectedRev: 5,
    })
    expect(okRes.ok).toBe(true)
    if (okRes.ok) expect(okRes.rev).toBe(6n)

    const conflict = await hub.mutate("ss_1", "ssd_cas", {
      op: "set",
      path: "/turn",
      value: "p3",
      expectedRev: 5,
    })
    expect(conflict.ok).toBe(false)
    if (!conflict.ok) {
      expect(conflict.code).toBe("REV_CONFLICT")
      expect(conflict.currentRev).toBe(6n)
    }
    expect(hub.readDocPath("ss_1", "ssd_cas", "/turn")).toMatchObject({ exists: true, value: "p2", rev: 6n })

    await hub.shutdown()
  })

  it("rejects UTF-8 CJK writes pushing doc past 256 KiB with DOC_TOO_LARGE and leaves in-memory tree untouched", async () => {
    const hub = new StateSyncHub(loadStateSyncConfig({}))
    attachEmptyDoc(hub, "ss_1", "ssd_size", {})

    // Each chunk: 20_000 CJK chars = 60_000 UTF-8 bytes (< 64 KiB single-write limit)
    const cjkChunk = "汉".repeat(20_000)
    for (let i = 0; i < 4; i++) {
      const res = await hub.mutate("ss_1", "ssd_size", {
        op: "set",
        path: `/chunk${i}`,
        value: cjkChunk,
      })
      expect(res.ok).toBe(true)
    }
    // 4 chunks ~= 240_050 UTF-8 bytes (< 262_144)
    const revBefore = hub.getDocHandle("ss_1", "ssd_size")?.rev
    expect(revBefore).toBe(4n)

    // 5th chunk pushes total UTF-8 bytes to ~300_060 > 262_144 (even though JS string length total is only 100_000)
    const overflowRes = await hub.mutate("ss_1", "ssd_size", {
      op: "set",
      path: "/chunk4",
      value: cjkChunk,
    })
    expect(overflowRes.ok).toBe(false)
    if (!overflowRes.ok) {
      expect(overflowRes.code).toBe("DOC_TOO_LARGE")
    }
    expect(hub.getDocHandle("ss_1", "ssd_size")?.rev).toBe(4n)
    expect(hub.readDocPath("ss_1", "ssd_size", "/chunk4")).toMatchObject({ exists: false, value: undefined })

    // Single write > 64 KiB UTF-8 CJK (length 22_000 < 65_536, bytes 66_002 > 65_536)
    const tooLargeSingle = await hub.mutate("ss_1", "ssd_size", {
      op: "set",
      path: "/single",
      value: "字".repeat(22_000),
    })
    expect(tooLargeSingle.ok).toBe(false)
    if (!tooLargeSingle.ok) {
      expect(tooLargeSingle.code).toBe("PAYLOAD_TOO_LARGE")
    }
    expect(hub.getDocHandle("ss_1", "ssd_size")?.rev).toBe(4n)

    await hub.shutdown()
  })

  it("treats delete on non-existent key as idempotent no-op without incrementing rev or broadcasting", async () => {
    const hub = new StateSyncHub(loadStateSyncConfig({}))
    attachEmptyDoc(hub, "ss_1", "ssd_noop", { a: 1 })
    const sock = createFakeSocket()
    hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_noop",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "t1",
      role: "read",
      isObserver: false,
      clientId: "c1",
      clientName: null,
      meta: {},
      socket: sock.socket,
    })
    sock.sent.length = 0

    const res = await hub.mutate("ss_1", "ssd_noop", {
      op: "delete",
      path: "/missing/key",
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.changed).toBe(false)
      expect(res.rev).toBe(0n)
    }
    expect(sock.sent).toHaveLength(0)

    await hub.shutdown()
  })
})

describe("StateSyncHub replay buffer & cold-load evictedUpToRev (Review Focus #5)", () => {
  it("replays mutations within 100-op / 5-min window and truncates when evicted or expired", async () => {
    const config = { ...loadStateSyncConfig({}), replayMaxItems: 3, replayWindowMs: 5000 }
    const hub = new StateSyncHub(config)
    const t0 = 1_700_000_000_000
    attachEmptyDoc(hub, "ss_1", "ssd_replay", {}, 0n)

    for (let i = 1; i <= 5; i++) {
      const res = await hub.mutate("ss_1", "ssd_replay", {
        op: "set",
        path: `/k${i}`,
        value: i,
        now: t0 + i * 100,
      })
      expect(res.ok).toBe(true)
    }

    // Buffer retains revs [3, 4, 5], evictedUpToRev = 2
    const sOk = createFakeSocket()
    const regOk = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_replay",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "t1",
      role: "read",
      isObserver: false,
      clientId: "c-ok",
      clientName: null,
      meta: {},
      sinceRev: 2,
      socket: sOk.socket,
      now: t0 + 1000,
    })
    expect(regOk.ok).toBe(true)
    if (regOk.ok) {
      expect(regOk.readyPayload.replayTruncated).toBe(false)
      expect(regOk.readyPayload.snapshots).toEqual([])
      expect(regOk.replayedMutations.map((m) => ({ rev: m.rev, path: m.path, replayed: m.replayed }))).toEqual([
        { rev: 3, path: "/k3", replayed: true },
        { rev: 4, path: "/k4", replayed: true },
        { rev: 5, path: "/k5", replayed: true },
      ])
    }

    // sinceRev = 1 < evictedUpToRev (2) -> replayTruncated: true + fresh snapshots
    const sTrunc = createFakeSocket()
    const regTrunc = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_replay",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "t1",
      role: "read",
      isObserver: false,
      clientId: "c-trunc",
      clientName: null,
      meta: {},
      sinceRev: 1,
      socket: sTrunc.socket,
      now: t0 + 1000,
    })
    expect(regTrunc.ok).toBe(true)
    if (regTrunc.ok) {
      expect(regTrunc.readyPayload.replayTruncated).toBe(true)
      expect(regTrunc.replayedMutations).toEqual([])
      expect(regTrunc.readyPayload.snapshots).toEqual([
        { path: "/", exists: true, value: { k1: 1, k2: 2, k3: 3, k4: 4, k5: 5 } },
      ])
    }

    // Past 5s window -> all buffered mutations expired -> replayTruncated: true + fresh snapshots
    const sExpired = createFakeSocket()
    const regExpired = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_replay",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "t1",
      role: "read",
      isObserver: false,
      clientId: "c-exp",
      clientName: null,
      meta: {},
      sinceRev: 3,
      socket: sExpired.socket,
      now: t0 + 10_000,
    })
    expect(regExpired.ok).toBe(true)
    if (regExpired.ok) {
      expect(regExpired.readyPayload.replayTruncated).toBe(true)
      expect(regExpired.replayedMutations).toEqual([])
      expect(regExpired.readyPayload.snapshots).toHaveLength(1)
    }

    await hub.shutdown()
  })

  it("initializes evictedUpToRev = snapshot.rev on cold load so stale sinceRev triggers replayTruncated + fresh snapshots", async () => {
    const hub = new StateSyncHub(loadStateSyncConfig({}))
    const handle = attachEmptyDoc(hub, "ss_1", "ssd_cold", { score: 99 }, 42n)
    expect(handle.evictedUpToRev).toBe(42n)

    const staleSock = createFakeSocket()
    const regStale = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_cold",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "t1",
      role: "read",
      isObserver: false,
      clientId: "stale-client",
      clientName: null,
      meta: {},
      sinceRev: 40,
      socket: staleSock.socket,
    })
    expect(regStale.ok).toBe(true)
    if (regStale.ok) {
      expect(regStale.readyPayload.rev).toBe(42)
      expect(regStale.readyPayload.replayTruncated).toBe(true)
      expect(regStale.replayedMutations).toEqual([])
      expect(regStale.readyPayload.snapshots).toEqual([
        { path: "/", exists: true, value: { score: 99 } },
      ])
    }

    // Client already at rev 42 is up to date (not truncated)
    const freshSock = createFakeSocket()
    const regFresh = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_cold",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "t1",
      role: "read",
      isObserver: false,
      clientId: "fresh-client",
      clientName: null,
      meta: {},
      sinceRev: 42,
      socket: freshSock.socket,
    })
    expect(regFresh.ok).toBe(true)
    if (regFresh.ok) {
      expect(regFresh.readyPayload.replayTruncated).toBe(false)
      expect(regFresh.replayedMutations).toEqual([])
      expect(regFresh.readyPayload.snapshots).toEqual([])
    }

    await hub.shutdown()
  })
})

describe("StateSyncHub onDisconnect execution vs suppression (Review Focus #3)", () => {
  it("executes onDisconnect on 'normal' and 'timeout_or_slow' disconnects", async () => {
    const hub = new StateSyncHub(loadStateSyncConfig({}))
    attachEmptyDoc(hub, "ss_1", "ssd_disc", {
      players: { p1: { online: true }, p2: { online: true } },
    })

    const sockWatcher = createFakeSocket()
    const sockP1 = createFakeSocket()
    const sockP2 = createFakeSocket()

    hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_disc",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "t1",
      role: "read",
      isObserver: false,
      clientId: "watcher",
      clientName: null,
      meta: {},
      socket: sockWatcher.socket,
    })
    const rP1 = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_disc",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "t2",
      role: "write",
      isObserver: false,
      clientId: "p1",
      clientName: "P1",
      meta: {},
      socket: sockP1.socket,
    })
    const rP2 = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_disc",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "t2",
      role: "write",
      isObserver: false,
      clientId: "p2",
      clientName: "P2",
      meta: {},
      socket: sockP2.socket,
    })
    if (!rP1.ok || !rP2.ok) throw new Error("register failed")

    expect(
      hub.setOnDisconnect("ss_1", "ssd_disc", rP1.connection.connectionId, [
        { op: "patch", path: "/players/p1", value: { online: false } },
      ]),
    ).toEqual({ ok: true })
    expect(
      hub.setOnDisconnect("ss_1", "ssd_disc", rP2.connection.connectionId, [
        { op: "delete", path: "/players/p2" },
      ]),
    ).toEqual({ ok: true })

    sockWatcher.sent.length = 0

    await hub.unregisterConnection("ss_1", "ssd_disc", rP1.connection.connectionId, "normal")
    expect(hub.readDocPath("ss_1", "ssd_disc", "/players/p1")).toMatchObject({
      exists: true,
      value: { online: false },
    })

    await hub.unregisterConnection("ss_1", "ssd_disc", rP2.connection.connectionId, "timeout_or_slow")
    expect(hub.readDocPath("ss_1", "ssd_disc", "/players/p2")).toMatchObject({
      exists: false,
      value: undefined,
    })

    const mutations = sockWatcher.sent.filter((f) => f.type === "mutation")
    expect(mutations).toHaveLength(2)
    expect(mutations[0]).toMatchObject({ op: "patch", path: "/players/p1", value: { online: false } })
    expect(mutations[1]).toMatchObject({ op: "delete", path: "/players/p2" })

    await hub.shutdown()
  })

  it("strictly skips & discards onDisconnect on 'revoked' (4003), 'scope_changed' (4004), and 'shutdown' (1001)", async () => {
    const hub = new StateSyncHub(loadStateSyncConfig({}))
    attachEmptyDoc(hub, "ss_1", "ssd_suppress", {
      players: {
        revokedToken: { online: true },
        scopeDowngraded: { online: true },
        serverRestart: { online: true },
      },
    })

    const sRevoked = createFakeSocket()
    const sDowngraded = createFakeSocket()
    const sShutdown = createFakeSocket()

    const rRevoked = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_suppress",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "tok_revoke",
      role: "write",
      isObserver: false,
      clientId: "c-revoked",
      clientName: null,
      meta: {},
      socket: sRevoked.socket,
    })
    const rDowngraded = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_suppress",
      ownerId: "u1",
      credentialType: "api_key",
      credentialId: "key_1",
      role: "create_write",
      isObserver: false,
      clientId: "c-downgraded",
      clientName: null,
      meta: {},
      socket: sDowngraded.socket,
    })
    const rShutdown = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_suppress",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "tok_stay",
      role: "write",
      isObserver: false,
      clientId: "c-shutdown",
      clientName: null,
      meta: {},
      socket: sShutdown.socket,
    })
    if (!rRevoked.ok || !rDowngraded.ok || !rShutdown.ok) throw new Error("register failed")

    hub.setOnDisconnect("ss_1", "ssd_suppress", rRevoked.connection.connectionId, [
      { op: "delete", path: "/players/revokedToken" },
    ])
    hub.setOnDisconnect("ss_1", "ssd_suppress", rDowngraded.connection.connectionId, [
      { op: "delete", path: "/players/scopeDowngraded" },
    ])
    hub.setOnDisconnect("ss_1", "ssd_suppress", rShutdown.connection.connectionId, [
      { op: "delete", path: "/players/serverRestart" },
    ])

    // 1. Token revoked -> 4003 -> onDisconnect MUST NOT run
    expect(hub.disconnectByToken("tok_revoke", STATE_SYNC_WS_CLOSE_CODES.REVOKED)).toBe(1)
    expect(sRevoked.closed).toEqual([{ code: 4003, reason: expect.any(String) }])

    // 2. API key write scope removed (downgraded to read) -> 4004 -> onDisconnect MUST NOT run
    hub.handleApiKeyChange({
      kind: "updated",
      userId: "u1",
      apiKeyId: "key_1",
      scopes: [STATE_SYNC_READ_SCOPE],
      channelAccessMode: "selected",
      channelIds: [],
      stateSyncAccessMode: "selected",
      stateSyncSpaceIds: ["ss_1"],
    })
    expect(sDowngraded.closed).toEqual([{ code: 4004, reason: expect.any(String) }])

    // 3. Graceful shutdown -> 1001 -> onDisconnect MUST NOT run
    const flushed: PersistDocInput[] = []
    hub.configurePersister(async (doc) => {
      flushed.push(doc)
    })
    await hub.shutdown()
    expect(sShutdown.closed).toEqual([{ code: 1001, reason: expect.any(String) }])

    // Verify none of the three players were deleted
    expect(hub.readDocPath("ss_1", "ssd_suppress", "/players")).toMatchObject({
      exists: true,
      value: {
        revokedToken: { online: true },
        scopeDowngraded: { online: true },
        serverRestart: { online: true },
      },
    })
  })

  it("enforces maxOnDisconnectActions (8) and denies read-only or observer connections", async () => {
    const hub = new StateSyncHub(loadStateSyncConfig({}))
    attachEmptyDoc(hub, "ss_1", "ssd_od_cap", {})

    const sRead = createFakeSocket()
    const sWrite = createFakeSocket()
    const rRead = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_od_cap",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "t_r",
      role: "read",
      isObserver: false,
      clientId: "reader",
      clientName: null,
      meta: {},
      socket: sRead.socket,
    })
    const rWrite = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_od_cap",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "t_w",
      role: "write",
      isObserver: false,
      clientId: "writer",
      clientName: null,
      meta: {},
      socket: sWrite.socket,
    })
    if (!rRead.ok || !rWrite.ok) throw new Error("register failed")

    expect(
      hub.setOnDisconnect("ss_1", "ssd_od_cap", rRead.connection.connectionId, [
        { op: "delete", path: "/a" },
      ]).ok,
    ).toBe(false)

    const nineActions = Array.from({ length: 9 }, (_, i) => ({
      op: "delete" as const,
      path: `/k${i}`,
    }))
    const capRes = hub.setOnDisconnect("ss_1", "ssd_od_cap", rWrite.connection.connectionId, nineActions)
    expect(capRes.ok).toBe(false)
    if (!capRes.ok) expect(capRes.code).toBe("LIMIT_EXCEEDED")

    await hub.shutdown()
  })
})

describe("StateSyncHub debounced flush, slow consumer, hidden observers, quotas & shutdown", () => {
  it("flushes after 500ms debounce and within 2000ms maxWait under sustained writes", async () => {
    vi.useFakeTimers()
    const hub = new StateSyncHub(loadStateSyncConfig({}))
    const persisted: Array<{ rev: bigint; data: Record<string, unknown> }> = []
    hub.configurePersister(async (doc) => {
      persisted.push({ rev: doc.rev, data: structuredClone(doc.data) })
    })

    attachEmptyDoc(hub, "ss_1", "ssd_flush", {})
    const sock = createFakeSocket()
    hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_flush",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "t1",
      role: "write",
      isObserver: false,
      clientId: "c1",
      clientName: null,
      meta: {},
      socket: sock.socket,
    })

    // Single write -> debounced 500ms
    await hub.mutate("ss_1", "ssd_flush", { op: "set", path: "/n", value: 1 })
    await vi.advanceTimersByTimeAsync(400)
    expect(persisted).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(150)
    expect(persisted).toHaveLength(1)
    expect(persisted[0]?.rev).toBe(1n)

    // Sustained writes every 300ms (resets 500ms debounce) -> must still flush by 2000ms maxWait
    for (let i = 2; i <= 9; i++) {
      await hub.mutate("ss_1", "ssd_flush", { op: "set", path: "/n", value: i })
      await vi.advanceTimersByTimeAsync(300)
    }
    expect(persisted.length).toBeGreaterThanOrEqual(2)

    await hub.shutdown()
  })

  it("flushes immediately when the last production connection disconnects", async () => {
    vi.useFakeTimers()
    const hub = new StateSyncHub(loadStateSyncConfig({}))
    const persisted: PersistDocInput[] = []
    hub.configurePersister(async (doc) => {
      persisted.push(doc)
    })

    attachEmptyDoc(hub, "ss_1", "ssd_last_disc", {})
    const sock = createFakeSocket()
    const reg = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_last_disc",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "t1",
      role: "write",
      isObserver: false,
      clientId: "c1",
      clientName: null,
      meta: {},
      socket: sock.socket,
    })
    if (!reg.ok) throw new Error("register failed")

    await hub.mutate("ss_1", "ssd_last_disc", { op: "set", path: "/final", value: true })
    expect(persisted).toHaveLength(0)

    // Unregistering last production connection triggers immediate flush (0ms elapsed)
    await hub.unregisterConnection("ss_1", "ssd_last_disc", reg.connection.connectionId, "normal")
    expect(persisted).toHaveLength(1)
    expect(persisted[0]?.data).toEqual({ final: true })
    expect(persisted[0]?.rev).toBe(1n)

    await hub.shutdown()
  })

  it("disconnects slow consumer (bufferedAmount > 512 KiB) with 4008 without breaking healthy subscribers", async () => {
    const hub = new StateSyncHub(loadStateSyncConfig({}))
    attachEmptyDoc(hub, "ss_1", "ssd_slow", {})

    const slowSock = createFakeSocket()
    const brokenSock = createFakeSocket()
    const healthySock = createFakeSocket()

    const rSlow = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_slow",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "t1",
      role: "write",
      isObserver: false,
      clientId: "slow-client",
      clientName: "Slow",
      meta: {},
      socket: slowSock.socket,
    })
    const rBroken = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_slow",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "t1",
      role: "read",
      isObserver: false,
      clientId: "broken-client",
      clientName: "Broken",
      meta: {},
      socket: brokenSock.socket,
    })
    const rHealthy = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_slow",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "t1",
      role: "read",
      isObserver: false,
      clientId: "healthy-client",
      clientName: "Healthy",
      meta: {},
      socket: healthySock.socket,
    })
    if (!rSlow.ok || !rBroken.ok || !rHealthy.ok) throw new Error("register failed")

    // Slow consumer also has an onDisconnect hook; eviction must not deadlock mutate()
    expect(
      hub.setOnDisconnect("ss_1", "ssd_slow", rSlow.connection.connectionId, [
        { op: "set", path: "/slowGone", value: true },
      ]),
    ).toEqual({ ok: true })
    healthySock.sent.length = 0

    // Simulate slow consumer backpressure (> 512 KiB) and broken socket send() throw
    slowSock.setBufferedAmount(524_289)
    brokenSock.setThrowOnSend(true)

    const res = await hub.mutate("ss_1", "ssd_slow", { op: "set", path: "/ping", value: 1 })
    expect(res.ok).toBe(true)

    expect(slowSock.closed).toEqual([{ code: STATE_SYNC_WS_CLOSE_CODES.TIMEOUT_OR_SLOW, reason: expect.any(String) }])
    expect(brokenSock.closed).toEqual([{ code: STATE_SYNC_WS_CLOSE_CODES.TIMEOUT_OR_SLOW, reason: expect.any(String) }])
    expect(healthySock.sent.some((f) => f.type === "mutation" && f.path === "/ping")).toBe(true)

    // Allow queued onDisconnect from slow consumer to settle
    await new Promise((r) => setTimeout(r, 10))
    expect(hub.readDocPath("ss_1", "ssd_slow", "/slowGone")).toMatchObject({ exists: true, value: true })

    await hub.shutdown()
  })

  it("keeps hidden Console observer out of Presence and production 50-conn cap while enforcing 5-observer cap", async () => {
    const config = {
      ...loadStateSyncConfig({}),
      maxConnectionsPerDoc: 1,
      maxObserversPerDoc: 2,
    }
    const hub = new StateSyncHub(config)
    attachEmptyDoc(hub, "ss_1", "ssd_obs", {})

    const prod1 = createFakeSocket()
    const prod2 = createFakeSocket()
    const obs1 = createFakeSocket()
    const obs2 = createFakeSocket()
    const obs3 = createFakeSocket()

    const rProd1 = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_obs",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "t1",
      role: "write",
      isObserver: false,
      clientId: "prod-1",
      clientName: "Prod 1",
      meta: {},
      socket: prod1.socket,
    })
    expect(rProd1.ok).toBe(true)

    // Second production connection hits maxConnectionsPerDoc (1)
    const rProd2 = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_obs",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "t1",
      role: "read",
      isObserver: false,
      clientId: "prod-2",
      clientName: "Prod 2",
      meta: {},
      socket: prod2.socket,
    })
    expect(rProd2.ok).toBe(false)
    if (!rProd2.ok) expect(rProd2.closeCode).toBe(STATE_SYNC_WS_CLOSE_CODES.LIMIT_EXCEEDED)

    // Console observers still succeed up to maxObserversPerDoc (2) and never enter Presence
    const rObs1 = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_obs",
      ownerId: "u1",
      credentialType: "console_ticket",
      credentialId: "dbg_1",
      role: "create_write",
      isObserver: true,
      clientId: "console-1",
      clientName: "Console",
      meta: {},
      socket: obs1.socket,
    })
    const rObs2 = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_obs",
      ownerId: "u1",
      credentialType: "console_ticket",
      credentialId: "dbg_2",
      role: "create_write",
      isObserver: true,
      clientId: "console-2",
      clientName: "Console 2",
      meta: {},
      socket: obs2.socket,
    })
    const rObs3 = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_obs",
      ownerId: "u1",
      credentialType: "console_ticket",
      credentialId: "dbg_3",
      role: "create_write",
      isObserver: true,
      clientId: "console-3",
      clientName: "Console 3",
      meta: {},
      socket: obs3.socket,
    })
    expect(rObs1.ok).toBe(true)
    expect(rObs2.ok).toBe(true)
    expect(rObs3.ok).toBe(false)
    if (!rObs3.ok) expect(rObs3.closeCode).toBe(STATE_SYNC_WS_CLOSE_CODES.LIMIT_EXCEEDED)

    expect(hub.getPresence("ss_1", "ssd_obs").map((m) => m.clientId)).toEqual(["prod-1"])
    expect(prod1.sent.filter((f) => f.type === "presence.join")).toHaveLength(0)

    // Live doc stats report onlineCount (1) and observerCount (2)
    const stats = hub.getLiveDocStats("ss_1")
    expect(stats.totalOnlineCount).toBe(1)
    expect(stats.totalObserverCount).toBe(2)

    await hub.shutdown()
  })

  it("flushes all dirty docs on shutdown() and rejects subsequent writes", async () => {
    const hub = new StateSyncHub(loadStateSyncConfig({}))
    const persisted = new Map<string, PersistDocInput>()
    hub.configurePersister(async (doc) => {
      persisted.set(`${doc.spaceId}:${doc.docId}`, doc)
    })

    attachEmptyDoc(hub, "ss_1", "ssd_a", {})
    attachEmptyDoc(hub, "ss_1", "ssd_b", {})
    await hub.mutate("ss_1", "ssd_a", { op: "set", path: "/a", value: 1 })
    await hub.mutate("ss_1", "ssd_b", { op: "set", path: "/b", value: 2 })

    expect(persisted.size).toBe(0)
    await hub.shutdown()

    expect(persisted.get("ss_1:ssd_a")?.data).toEqual({ a: 1 })
    expect(persisted.get("ss_1:ssd_b")?.data).toEqual({ b: 2 })

    const afterShutdown = await hub.mutate("ss_1", "ssd_a", { op: "set", path: "/a", value: 3 })
    expect(afterShutdown.ok).toBe(false)
    if (!afterShutdown.ok) expect(afterShutdown.code).toBe("SHUTTING_DOWN")
  })

  it("disconnects API key connections with 4003 when space removed or revoked, and 4004 when role changes", async () => {
    const hub = new StateSyncHub(loadStateSyncConfig({}))
    attachEmptyDoc(hub, "ss_1", "ssd_1", {})
    attachEmptyDoc(hub, "ss_2", "ssd_2", {})

    const s1 = createFakeSocket()
    const s2 = createFakeSocket()
    hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_1",
      ownerId: "u1",
      credentialType: "api_key",
      credentialId: "key_a",
      role: "read",
      isObserver: false,
      clientId: "c1",
      clientName: null,
      meta: {},
      socket: s1.socket,
    })
    hub.registerConnection({
      spaceId: "ss_2",
      docId: "ssd_2",
      ownerId: "u1",
      credentialType: "api_key",
      credentialId: "key_a",
      role: "read",
      isObserver: false,
      clientId: "c2",
      clientName: null,
      meta: {},
      socket: s2.socket,
    })

    // Upgrade scope to write and remove ss_2 from allowed spaces
    hub.handleApiKeyChange({
      kind: "updated",
      userId: "u1",
      apiKeyId: "key_a",
      scopes: [STATE_SYNC_READ_SCOPE, STATE_SYNC_WRITE_SCOPE],
      channelAccessMode: "selected",
      channelIds: [],
      stateSyncAccessMode: "selected",
      stateSyncSpaceIds: ["ss_1"],
    })

    // ss_2 lost space access -> 4003
    expect(s2.closed).toEqual([{ code: STATE_SYNC_WS_CLOSE_CODES.REVOKED, reason: expect.any(String) }])
    // ss_1 still accessible, role upgraded read -> create_write -> 4004
    expect(s1.closed).toEqual([{ code: STATE_SYNC_WS_CLOSE_CODES.ROLE_CHANGED, reason: expect.any(String) }])

    await hub.shutdown()
  })

  it("rolls back syncPersist failure without mutating memory or broadcasting", async () => {
    const hub = new StateSyncHub(loadStateSyncConfig({}))
    hub.configurePersister(async () => {
      throw new Error("DB unavailable")
    })
    attachEmptyDoc(hub, "ss_1", "ssd_persist_err", { v: 1 }, 3n)
    const sock = createFakeSocket()
    hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_persist_err",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "t1",
      role: "read",
      isObserver: false,
      clientId: "c1",
      clientName: null,
      meta: {},
      socket: sock.socket,
    })
    sock.sent.length = 0

    const res = await hub.mutate("ss_1", "ssd_persist_err", {
      op: "set",
      path: "/v",
      value: 2,
      syncPersist: true,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe("PERSIST_FAILED")
    expect(hub.readDocPath("ss_1", "ssd_persist_err", "/v")).toMatchObject({ exists: true, value: 1, rev: 3n })
    expect(sock.sent).toHaveLength(0)

    await hub.shutdown()
  })

  it("evicts idle clean docs after idleEvictMs and cold-loads with evictedUpToRev = rev", async () => {
    vi.useFakeTimers()
    const config = { ...loadStateSyncConfig({}), idleEvictMs: 1000 }
    const hub = new StateSyncHub(config)
    hub.configurePersister(async () => undefined)

    attachEmptyDoc(hub, "ss_1", "ssd_idle", { a: 1 }, 0n)
    const sock = createFakeSocket()
    const reg = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_idle",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "t1",
      role: "write",
      isObserver: false,
      clientId: "c1",
      clientName: null,
      meta: {},
      socket: sock.socket,
    })
    if (!reg.ok) throw new Error("register failed")

    await hub.mutate("ss_1", "ssd_idle", { op: "set", path: "/a", value: 2 })
    await hub.unregisterConnection("ss_1", "ssd_idle", reg.connection.connectionId, "normal")
    expect(hub.getDocHandle("ss_1", "ssd_idle")).not.toBeNull()

    await vi.advanceTimersByTimeAsync(1050)
    expect(hub.getDocHandle("ss_1", "ssd_idle")).toBeNull()

    // Reloading from DB snapshot initializes evictedUpToRev = 1n
    const reloaded = attachEmptyDoc(hub, "ss_1", "ssd_idle", { a: 2 }, 1n)
    expect(reloaded.evictedUpToRev).toBe(1n)

    await hub.shutdown()
  })

  it("enforces WS write rate, doc write rate, and space doc-create rate limits", async () => {
    const config = {
      ...loadStateSyncConfig({}),
      wsRatePerSec: 1,
      wsBurst: 2,
      docWriteRatePerSec: 1,
      docWriteBurst: 3,
      docCreateRatePerMin: 60,
      docCreateBurst: 2,
    }
    const hub = new StateSyncHub(config)
    const t0 = 1_700_000_000_000
    attachEmptyDoc(hub, "ss_1", "ssd_rate", {})
    const sock = createFakeSocket()
    const reg = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_rate",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "t1",
      role: "write",
      isObserver: false,
      clientId: "c1",
      clientName: null,
      meta: {},
      socket: sock.socket,
      now: t0,
    })
    if (!reg.ok) throw new Error("register failed")

    // Per-connection burst 2 allowed, 3rd rejected
    expect((await hub.mutate("ss_1", "ssd_rate", { op: "set", path: "/x", value: 1, sourceConnectionId: reg.connection.connectionId, now: t0 })).ok).toBe(true)
    expect((await hub.mutate("ss_1", "ssd_rate", { op: "set", path: "/x", value: 2, sourceConnectionId: reg.connection.connectionId, now: t0 })).ok).toBe(true)
    const connLimited = await hub.mutate("ss_1", "ssd_rate", { op: "set", path: "/x", value: 3, sourceConnectionId: reg.connection.connectionId, now: t0 })
    expect(connLimited.ok).toBe(false)
    if (!connLimited.ok) expect(connLimited.code).toBe("RATE_LIMITED")

    // Doc-level burst: 2 consumed above + 1 HTTP write = 3, 4th rejected
    expect((await hub.mutate("ss_1", "ssd_rate", { op: "set", path: "/x", value: 4, now: t0 })).ok).toBe(true)
    const docLimited = await hub.mutate("ss_1", "ssd_rate", { op: "set", path: "/x", value: 5, now: t0 })
    expect(docLimited.ok).toBe(false)
    if (!docLimited.ok) expect(docLimited.code).toBe("RATE_LIMITED")

    // Doc-create burst per space: 2 allowed, 3rd rejected
    expect(hub.consumeDocCreateRate("ss_1", t0).allowed).toBe(true)
    expect(hub.consumeDocCreateRate("ss_1", t0).allowed).toBe(true)
    expect(hub.consumeDocCreateRate("ss_1", t0).allowed).toBe(false)

    await hub.shutdown()
  })

  it("forces safe replayTruncated + scoped snapshots when a missed write overwrote an ancestor of partial subscriptions", async () => {
    const hub = new StateSyncHub(loadStateSyncConfig({}))
    const t0 = 1_700_000_000_000
    attachEmptyDoc(hub, "ss_1", "ssd_anc_replay", { players: { p1: { hp: 10 } }, secret: "hidden" }, 1n)

    // Ancestor write at root "/" touches both /secret and /players/p1
    await hub.mutate("ss_1", "ssd_anc_replay", {
      op: "set",
      path: "/",
      value: { players: { p1: { hp: 99 } }, secret: "top-secret" },
      now: t0 + 100,
    })

    const sock = createFakeSocket()
    const reg = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_anc_replay",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "t1",
      role: "read",
      isObserver: false,
      clientId: "partial-client",
      clientName: null,
      meta: {},
      paths: ["/players/p1"],
      sinceRev: 1,
      socket: sock.socket,
      now: t0 + 200,
    })
    expect(reg.ok).toBe(true)
    if (reg.ok) {
      expect(reg.readyPayload.replayTruncated).toBe(true)
      expect(reg.replayedMutations).toEqual([])
      expect(reg.readyPayload.snapshots).toEqual([
        { path: "/players/p1", exists: true, value: { hp: 99 } },
      ])
    }

    await hub.shutdown()
  })

  it("updates presence for production connections and suppresses onDisconnect on disconnectByDoc / disconnectBySpace", async () => {
    const hub = new StateSyncHub(loadStateSyncConfig({}))
    attachEmptyDoc(hub, "ss_1", "ssd_p1", { flag: "keep" })
    attachEmptyDoc(hub, "ss_1", "ssd_p2", { flag: "keep" })

    const s1 = createFakeSocket()
    const s2 = createFakeSocket()
    const sObs = createFakeSocket()
    const r1 = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_p1",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "t1",
      role: "write",
      isObserver: false,
      clientId: "p1",
      clientName: "Old",
      meta: { seat: 1 },
      socket: s1.socket,
    })
    const rObs = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_p1",
      ownerId: "u1",
      credentialType: "console_ticket",
      credentialId: "dbg",
      role: "create_write",
      isObserver: true,
      clientId: "obs",
      clientName: null,
      meta: {},
      socket: sObs.socket,
    })
    const r2 = hub.registerConnection({
      spaceId: "ss_1",
      docId: "ssd_p2",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "t1",
      role: "write",
      isObserver: false,
      clientId: "p2",
      clientName: "P2",
      meta: {},
      socket: s2.socket,
    })
    if (!r1.ok || !r2.ok || !rObs.ok) throw new Error("register failed")

    expect(hub.updatePresence("ss_1", "ssd_p1", rObs.connection.connectionId, { clientName: "Ignored" })).toBeNull()
    const updated = hub.updatePresence("ss_1", "ssd_p1", r1.connection.connectionId, {
      clientName: "New",
      meta: { seat: 2 },
    })
    expect(updated).toMatchObject({ clientId: "p1", clientName: "New", meta: { seat: 2 } })
    expect(sObs.sent.some((f) => f.type === "presence.update")).toBe(true)

    hub.setOnDisconnect("ss_1", "ssd_p1", r1.connection.connectionId, [{ op: "delete", path: "/flag" }])
    hub.setOnDisconnect("ss_1", "ssd_p2", r2.connection.connectionId, [{ op: "delete", path: "/flag" }])

    expect(hub.disconnectByDoc("ss_1", "ssd_p1", STATE_SYNC_WS_CLOSE_CODES.REVOKED)).toBe(2)
    expect(s1.closed).toEqual([{ code: 4003, reason: expect.any(String) }])
    expect(hub.getDocHandle("ss_1", "ssd_p1")).toBeNull()

    expect(hub.disconnectBySpace("ss_1", STATE_SYNC_WS_CLOSE_CODES.REVOKED)).toBe(1)
    expect(s2.closed).toEqual([{ code: 4003, reason: expect.any(String) }])
    expect(hub.getDocHandle("ss_1", "ssd_p2")).toBeNull()

    await hub.shutdown()
  })
})
