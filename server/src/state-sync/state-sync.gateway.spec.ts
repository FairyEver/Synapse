import { createServer, type Server as HttpServer } from "node:http"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WebSocket, WebSocketServer } from "ws"
import { STATE_SYNC_WS_CLOSE_CODES } from "@synapse/shared/state-sync-contracts"
import { loadStateSyncConfig } from "./state-sync-config"
import { StateSyncHub, type LoadedDocSnapshot, type StateSyncDocPersister } from "./state-sync-hub"
import { StateSyncGateway } from "./state-sync.gateway"
import type { StateSyncService } from "./state-sync.service"

function createMessageQueue(ws: WebSocket) {
  const queue: Record<string, unknown>[] = []
  const waiters: Array<(msg: Record<string, unknown>) => void> = []

  ws.on("message", (raw) => {
    const parsed = JSON.parse(raw.toString("utf8")) as Record<string, unknown>
    const waiter = waiters.shift()
    if (waiter) {
      waiter(parsed)
    } else {
      queue.push(parsed)
    }
  })

  return {
    all: queue,
    next(timeoutMs = 2000): Promise<Record<string, unknown>> {
      const existing = queue.shift()
      if (existing) return Promise.resolve(existing)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.indexOf(onMsg)
          if (idx >= 0) waiters.splice(idx, 1)
          reject(new Error("Timed out waiting for WS message"))
        }, timeoutMs)
        const onMsg = (msg: Record<string, unknown>) => {
          clearTimeout(timer)
          resolve(msg)
        }
        waiters.push(onMsg)
      })
    },
    async nextMatching(
      predicate: (msg: Record<string, unknown>) => boolean,
      timeoutMs = 2000,
    ): Promise<Record<string, unknown>> {
      const deadline = Date.now() + timeoutMs
      while (true) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) {
          throw new Error("Timed out waiting for matching WS message")
        }
        const msg = await this.next(remaining)
        if (predicate(msg)) return msg
      }
    },
  }
}

function waitOpen(ws: WebSocket, timeoutMs = 2000): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for WS open")), timeoutMs)
    ws.once("open", () => {
      clearTimeout(timer)
      resolve()
    })
    ws.once("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

function waitClose(ws: WebSocket, timeoutMs = 2000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for WS close")), timeoutMs)
    ws.once("close", (code, reason) => {
      clearTimeout(timer)
      resolve({ code, reason: reason.toString("utf8") })
    })
  })
}

describe("StateSyncGateway", () => {
  const cleanups: Array<() => Promise<void>> = []

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()!()
    }
  })

  async function startGateway(options: {
    configOverrides?: Partial<ReturnType<typeof loadStateSyncConfig>>
    initialDoc?: Partial<LoadedDocSnapshot>
    persister?: ReturnType<typeof vi.fn<StateSyncDocPersister>>
  } = {}) {
    const config = { ...loadStateSyncConfig({}), ...options.configOverrides }
    const hub = new StateSyncHub(config)
    const persister = options.persister ?? vi.fn<StateSyncDocPersister>().mockResolvedValue(undefined)
    hub.configurePersister(persister)

    const defaultDoc: LoadedDocSnapshot = {
      spaceId: "ss_1",
      docId: "doc_1",
      data: { room: { title: "Demo" }, players: {} },
      rev: 0n,
      ttlSeconds: null,
      expiresAt: null,
      ...options.initialDoc,
    }

    const service = {
      hub,
      authenticateWsToken: vi.fn(),
      loadDocForGateway: vi.fn(async (spaceId: string, docId: string): Promise<LoadedDocSnapshot | null> => {
        const existing = hub.readDocPath(spaceId, docId, "/")
        if (existing && typeof existing.value === "object" && existing.value !== null && !Array.isArray(existing.value)) {
          return {
            spaceId,
            docId,
            data: existing.value as Record<string, unknown>,
            rev: existing.rev,
            ttlSeconds: defaultDoc.ttlSeconds,
            expiresAt: existing.expiresAt,
          }
        }
        if (spaceId === defaultDoc.spaceId && docId === defaultDoc.docId) {
          return structuredClone(defaultDoc)
        }
        return null
      }),
    } as unknown as StateSyncService

    const gateway = new StateSyncGateway(service)
    const server: HttpServer = createServer((_req, res) => {
      res.statusCode = 404
      res.end()
    })
    gateway.attach(server)
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()))
    const address = server.address()
    const port = typeof address === "object" && address ? address.port : 0

    cleanups.push(async () => {
      await gateway.onApplicationShutdown()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    })

    return {
      gateway,
      hub,
      service,
      persister,
      server,
      port,
      wsUrl: (spaceId = "ss_1", docId = "doc_1", query = "") =>
        `ws://127.0.0.1:${port}/api/open/v1/state-sync/spaces/${spaceId}/docs/${docId}/ws${query}`,
    }
  }

  it("rejects upgrade requests carrying credentials in URL query parameters without authenticating", async () => {
    const { wsUrl, service } = await startGateway()

    for (const query of ["?token=sys_secret", "?access_token=sys_secret", "?api_key=syn_sk_secret"]) {
      const ws = new WebSocket(wsUrl("ss_1", "doc_1", query))
      const err = await new Promise<Error>((resolve) => {
        ws.once("error", (e) => resolve(e))
      })
      expect(err.message).toMatch(/400/u)
      expect(service.authenticateWsToken).not.toHaveBeenCalled()
    }
  })

  it("ignores unrelated WebSocket upgrade paths so sibling gateways remain untouched", async () => {
    const { server, port, service } = await startGateway()
    const siblingWss = new WebSocketServer({ noServer: true })
    server.on("upgrade", (req, socket, head) => {
      if (req.url === "/api/open/v1/channels/ch_1/ws") {
        siblingWss.handleUpgrade(req, socket, head, (ws) => {
          ws.send(JSON.stringify({ ok: "sibling" }))
        })
      }
    })
    cleanups.push(async () => {
      await new Promise<void>((resolve) => siblingWss.close(() => resolve()))
    })

    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/open/v1/channels/ch_1/ws`)
    const q = createMessageQueue(ws)
    expect(await q.next()).toEqual({ ok: "sibling" })
    expect(service.authenticateWsToken).not.toHaveBeenCalled()
    ws.close()
  })

  it("closes unauthenticated connections with 4001 after auth timeout and on non-auth first frame", async () => {
    const { wsUrl } = await startGateway({ configOverrides: { authTimeoutMs: 80 } })

    const silent = new WebSocket(wsUrl())
    const timeoutClosed = await waitClose(silent)
    expect(timeoutClosed.code).toBe(STATE_SYNC_WS_CLOSE_CODES.AUTH_FAILED)

    const earlyPing = new WebSocket(wsUrl())
    const q = createMessageQueue(earlyPing)
    await waitOpen(earlyPing)
    earlyPing.send(JSON.stringify({ type: "ping" }))
    const errFrame = await q.next()
    expect(errFrame).toMatchObject({ type: "error", code: "UNAUTHENTICATED" })
    const closed = await waitClose(earlyPing)
    expect(closed.code).toBe(STATE_SYNC_WS_CLOSE_CODES.AUTH_FAILED)
  })

  it("authenticates Upgrade Authorization Bearer immediately, serializes pipelined frames during async load, and cleans up early close", async () => {
    const { wsUrl, service, hub } = await startGateway()
    vi.mocked(service.authenticateWsToken).mockResolvedValue({
      spaceId: "ss_1",
      docId: "doc_1",
      ownerId: "u1",
      credentialType: "api_key",
      credentialId: "k1",
      role: "create_write",
      isObserver: false,
    })

    // Slow loadDocForGateway to test pipelined frames & early close
    vi.mocked(service.loadDocForGateway).mockImplementation(async (spaceId, docId) => {
      await new Promise((r) => setTimeout(r, 30))
      return {
        spaceId,
        docId,
        data: { room: { title: "Demo" } },
        rev: 0n,
        ttlSeconds: null,
        expiresAt: null,
      }
    })

    // 1. Pipelined ping before ready completes
    const backend = new WebSocket(wsUrl(), {
      headers: {
        Authorization: "Bearer syn_sk_backend",
        Cookie: "__Host-synapse_session=ignored",
      },
    })
    const q = createMessageQueue(backend)
    await waitOpen(backend)
    backend.send(JSON.stringify({ type: "ping" }))

    const ready = await q.next()
    expect(ready).toMatchObject({
      type: "ready",
      spaceId: "ss_1",
      docId: "doc_1",
      role: "create_write",
      rev: 0,
      replayTruncated: false,
      snapshots: [{ path: "/", exists: true, value: { room: { title: "Demo" } } }],
    })
    const pong = await q.next()
    expect(pong.type).toBe("pong")
    expect(service.authenticateWsToken).toHaveBeenCalledWith("ss_1", "doc_1", "syn_sk_backend")

    // 2. Early close during async auth must NOT leak connection into Hub
    const aborting = new WebSocket(wsUrl(), {
      headers: { Authorization: "Bearer syn_sk_backend" },
    })
    await waitOpen(aborting)
    aborting.close()
    await waitClose(aborting)
    await new Promise((r) => setTimeout(r, 60))
    expect(hub.getPresence("ss_1", "doc_1")).toHaveLength(1)

    backend.close()
    await waitClose(backend)
  })

  it("supports end-to-end mutate, expectedRev conflict, role enforcement, dynamic subscribe/unsubscribe, ancestor snapshot, presence.update, and ping/pong", async () => {
    const { wsUrl, service } = await startGateway()
    vi.mocked(service.authenticateWsToken).mockImplementation(async (spaceId, docId, token) => {
      if (token === "sys_writer") {
        return { spaceId, docId, ownerId: "u1", credentialType: "space_token", credentialId: "tok_w", role: "write", isObserver: false }
      }
      if (token === "sys_reader") {
        return { spaceId, docId, ownerId: "u1", credentialType: "space_token", credentialId: "tok_r", role: "read", isObserver: false }
      }
      if (token === "dbg_obs") {
        return { spaceId, docId, ownerId: "u1", credentialType: "console_ticket", credentialId: "dbg_1", role: "read", isObserver: true }
      }
      return null
    })

    // Writer connects subscribing to "/"
    const writer = new WebSocket(wsUrl())
    const writerQ = createMessageQueue(writer)
    await waitOpen(writer)
    writer.send(JSON.stringify({ type: "auth", token: "sys_writer", clientId: "host", clientName: "房主", paths: ["/"] }))
    const writerReady = await writerQ.next()
    expect(writerReady).toMatchObject({ type: "ready", clientId: "host", role: "write", rev: 0 })

    // Reader connects subscribing only to "/players/p1"
    const reader = new WebSocket(wsUrl())
    const readerQ = createMessageQueue(reader)
    await waitOpen(reader)
    reader.send(JSON.stringify({ type: "auth", token: "sys_reader", clientId: "viewer", paths: ["/players/p1"] }))
    const readerReady = await readerQ.next()
    expect(readerReady).toMatchObject({
      type: "ready",
      clientId: "viewer",
      role: "read",
      snapshots: [{ path: "/players/p1", exists: false }],
    })
    expect((await writerQ.next()).type).toBe("presence.join")

    // Reader cannot mutate or register/clear onDisconnect -> FORBIDDEN_ROLE
    reader.send(JSON.stringify({ type: "mutate", id: "r-mut", op: "set", path: "/room/title", value: "Hack" }))
    expect(await readerQ.next()).toMatchObject({ type: "error", id: "r-mut", code: "FORBIDDEN_ROLE" })

    reader.send(JSON.stringify({ type: "onDisconnect.set", id: "r-od", actions: [{ op: "delete", path: "/players/p1" }] }))
    expect(await readerQ.next()).toMatchObject({ type: "error", id: "r-od", code: "FORBIDDEN_ROLE" })

    reader.send(JSON.stringify({ type: "onDisconnect.clear", id: "r-odc" }))
    expect(await readerQ.next()).toMatchObject({ type: "error", id: "r-odc", code: "FORBIDDEN_ROLE" })

    // Observer also blocked from mutate / onDisconnect / presence.update
    const observer = new WebSocket(wsUrl())
    const observerQ = createMessageQueue(observer)
    await waitOpen(observer)
    observer.send(JSON.stringify({ type: "auth", token: "dbg_obs" }))
    expect((await observerQ.next()).type).toBe("ready")
    observer.send(JSON.stringify({ type: "mutate", id: "obs-m", op: "set", path: "/a", value: 1 }))
    expect(await observerQ.next()).toMatchObject({ type: "error", id: "obs-m", code: "FORBIDDEN_ROLE" })
    observer.send(JSON.stringify({ type: "presence.update", clientName: "X" }))
    expect(await observerQ.next()).toMatchObject({ type: "error", code: "FORBIDDEN_OBSERVER" })

    // Writer mutates set -> patch -> delete, and tests expectedRev conflict
    writer.send(JSON.stringify({ type: "mutate", id: "m1", op: "set", path: "/players/p1", value: { hp: 100, ready: false } }))
    expect(await writerQ.next()).toMatchObject({ type: "ack", id: "m1", rev: 1, changed: true })
    expect(await readerQ.next()).toMatchObject({ type: "mutation", rev: 1, op: "set", path: "/players/p1", value: { hp: 100, ready: false } })

    writer.send(JSON.stringify({ type: "mutate", id: "m2", op: "patch", path: "/players/p1", value: { ready: true }, expectedRev: 1 }))
    expect(await writerQ.next()).toMatchObject({ type: "ack", id: "m2", rev: 2, changed: true })
    expect(await readerQ.next()).toMatchObject({ type: "mutation", rev: 2, op: "patch", path: "/players/p1", value: { ready: true } })

    // Stale expectedRev -> REV_CONFLICT with currentRev
    writer.send(JSON.stringify({ type: "mutate", id: "m-conflict", op: "set", path: "/players/p1/hp", value: 50, expectedRev: 1 }))
    expect(await writerQ.next()).toMatchObject({ type: "error", id: "m-conflict", code: "REV_CONFLICT", currentRev: 2 })

    // Ancestor overwrite ("/players") pushes snapshot to child subscriber ("/players/p1")
    writer.send(JSON.stringify({ type: "mutate", id: "m3", op: "set", path: "/players", value: { p1: { hp: 42, ready: true } } }))
    expect(await writerQ.next()).toMatchObject({ type: "ack", id: "m3", rev: 3, changed: true })
    expect(await readerQ.next()).toMatchObject({
      type: "snapshot",
      rev: 3,
      path: "/players/p1",
      exists: true,
      value: { hp: 42, ready: true },
    })

    // Dynamic subscribe to "/room" returns initial snapshot + ack
    reader.send(JSON.stringify({ type: "subscribe", id: "sub-1", paths: ["/room"] }))
    expect(await readerQ.next()).toMatchObject({
      type: "snapshot",
      rev: 3,
      path: "/room",
      exists: true,
      value: { title: "Demo" },
    })
    expect(await readerQ.next()).toMatchObject({ type: "ack", id: "sub-1", rev: 3 })

    // Unsubscribe from "/room" stops further updates on "/room"
    reader.send(JSON.stringify({ type: "unsubscribe", id: "unsub-1", paths: ["/room"] }))
    expect(await readerQ.next()).toMatchObject({ type: "ack", id: "unsub-1", rev: 3 })

    writer.send(JSON.stringify({ type: "mutate", id: "m4", op: "delete", path: "/room/title" }))
    expect(await writerQ.next()).toMatchObject({ type: "ack", id: "m4", rev: 4, changed: true })

    // Verify reader receives subsequent mutation on "/players/p1" (and did NOT receive "/room/title" delete)
    writer.send(JSON.stringify({ type: "mutate", id: "m5", op: "set", path: "/players/p1/hp", value: 99 }))
    expect(await writerQ.next()).toMatchObject({ type: "ack", id: "m5", rev: 5, changed: true })
    expect(await readerQ.next()).toMatchObject({ type: "mutation", rev: 5, op: "set", path: "/players/p1/hp", value: 99 })

    // presence.update & ping/pong
    writer.send(JSON.stringify({ type: "presence.update", clientName: "新房主", meta: { seat: 1 } }))
    expect(await readerQ.next()).toMatchObject({
      type: "presence.update",
      member: { clientId: "host", clientName: "新房主", meta: { seat: 1 } },
    })
    expect(await writerQ.next()).toMatchObject({
      type: "presence.update",
      member: { clientId: "host", clientName: "新房主", meta: { seat: 1 } },
    })

    reader.send(JSON.stringify({ type: "ping" }))
    expect((await readerQ.next()).type).toBe("pong")

    writer.close()
    reader.close()
    observer.close()
  })

  it("fires onDisconnect on normal close (1000), skips it on clear, and skips it on 4003 revoke / 4004 downgrade / 1001 shutdown", async () => {
    const persister = vi.fn<StateSyncDocPersister>().mockResolvedValue(undefined)
    const { wsUrl, service, hub, gateway } = await startGateway({
      persister,
      initialDoc: {
        data: {
          players: {
            p1: { online: true },
            pClear: { online: true },
            p2: { online: true },
            p3: { online: true },
            p4: { online: true },
          },
        },
      },
    })
    vi.mocked(service.authenticateWsToken).mockImplementation(async (spaceId, docId, token) => {
      if (token === "sys_watch") {
        return { spaceId, docId, ownerId: "u1", credentialType: "space_token", credentialId: "tok_watch", role: "read", isObserver: false }
      }
      if (token === "sys_p1") {
        return { spaceId, docId, ownerId: "u1", credentialType: "space_token", credentialId: "tok_p1", role: "write", isObserver: false }
      }
      if (token === "sys_pClear") {
        return { spaceId, docId, ownerId: "u1", credentialType: "space_token", credentialId: "tok_pClear", role: "write", isObserver: false }
      }
      if (token === "sys_p2") {
        return { spaceId, docId, ownerId: "u1", credentialType: "space_token", credentialId: "tok_p2", role: "write", isObserver: false }
      }
      if (token === "syn_sk_p3") {
        return { spaceId, docId, ownerId: "u1", credentialType: "api_key", credentialId: "key_p3", role: "create_write", isObserver: false }
      }
      if (token === "sys_p4") {
        return { spaceId, docId, ownerId: "u1", credentialType: "space_token", credentialId: "tok_p4", role: "write", isObserver: false }
      }
      return null
    })

    const watcher = new WebSocket(wsUrl())
    const watcherQ = createMessageQueue(watcher)
    await waitOpen(watcher)
    watcher.send(JSON.stringify({ type: "auth", token: "sys_watch", clientId: "watcher" }))
    await watcherQ.next() // ready

    async function connectPlayer(token: string, clientId: string, path: string) {
      const ws = new WebSocket(wsUrl())
      const q = createMessageQueue(ws)
      await waitOpen(ws)
      ws.send(JSON.stringify({ type: "auth", token, clientId }))
      await q.next() // ready
      ws.send(JSON.stringify({
        type: "onDisconnect.set",
        id: `od-${clientId}`,
        actions: [{ op: "delete", path }],
      }))
      expect(await q.next()).toMatchObject({ type: "ack", id: `od-${clientId}` })
      return { ws, q }
    }

    // 1. p1 closes normally (1000) -> onDisconnect FIRES
    const p1 = await connectPlayer("sys_p1", "p1", "/players/p1")
    p1.ws.close(STATE_SYNC_WS_CLOSE_CODES.NORMAL, "bye")
    await waitClose(p1.ws)
    const p1Delete = await watcherQ.nextMatching((m) => m.type === "mutation" && m.path === "/players/p1")
    expect(p1Delete).toMatchObject({ type: "mutation", op: "delete", path: "/players/p1" })
    expect(hub.readDocPath("ss_1", "doc_1", "/players/p1")?.exists).toBe(false)

    // 1b. pClear clears onDisconnect then closes normally (1000) -> onDisconnect SKIPPED
    const pClear = await connectPlayer("sys_pClear", "pClear", "/players/pClear")
    pClear.ws.send(JSON.stringify({ type: "onDisconnect.clear", id: "od-clear-1" }))
    expect(await pClear.q.next()).toMatchObject({ type: "ack", id: "od-clear-1" })
    pClear.ws.close(STATE_SYNC_WS_CLOSE_CODES.NORMAL, "bye")
    await waitClose(pClear.ws)
    await new Promise((r) => setTimeout(r, 40))
    expect(hub.readDocPath("ss_1", "doc_1", "/players/pClear")?.exists).toBe(true)

    // 2. p2 revoked via 4003 -> onDisconnect SKIPPED
    const p2 = await connectPlayer("sys_p2", "p2", "/players/p2")
    const p2ClosePromise = waitClose(p2.ws)
    hub.disconnectByToken("tok_p2", STATE_SYNC_WS_CLOSE_CODES.REVOKED, "Token revoked")
    expect((await p2ClosePromise).code).toBe(STATE_SYNC_WS_CLOSE_CODES.REVOKED)
    await new Promise((r) => setTimeout(r, 40))
    expect(hub.readDocPath("ss_1", "doc_1", "/players/p2")?.exists).toBe(true)

    // 3. p3 downgraded via 4004 -> onDisconnect SKIPPED
    const p3 = await connectPlayer("syn_sk_p3", "p3", "/players/p3")
    const p3ClosePromise = waitClose(p3.ws)
    hub.handleApiKeyChange({
      kind: "updated",
      apiKeyId: "key_p3",
      userId: "u1",
      scopes: ["state_sync.read"],
      channelAccessMode: "selected",
      channelIds: [],
      stateSyncAccessMode: "all_owned",
      stateSyncSpaceIds: [],
    })
    expect((await p3ClosePromise).code).toBe(STATE_SYNC_WS_CLOSE_CODES.ROLE_CHANGED)
    await new Promise((r) => setTimeout(r, 40))
    expect(hub.readDocPath("ss_1", "doc_1", "/players/p3")?.exists).toBe(true)

    // 4. p4 closed via 1001 graceful shutdown -> onDisconnect SKIPPED & dirty doc flushed
    const p4 = await connectPlayer("sys_p4", "p4", "/players/p4")
    const p4ClosePromise = waitClose(p4.ws)
    await gateway.onApplicationShutdown()
    expect((await p4ClosePromise).code).toBe(STATE_SYNC_WS_CLOSE_CODES.GOING_AWAY)
    expect(hub.readDocPath("ss_1", "doc_1", "/players/p4")?.exists).toBe(true)
    expect(persister).toHaveBeenCalled()
  })

  it("replays missed mutations via sinceRev on reconnect", async () => {
    const { wsUrl, service } = await startGateway()
    vi.mocked(service.authenticateWsToken).mockResolvedValue({
      spaceId: "ss_1",
      docId: "doc_1",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "tok_1",
      role: "write",
      isObserver: false,
    })

    const writer = new WebSocket(wsUrl(), { headers: { Authorization: "Bearer sys_w" } })
    const writerQ = createMessageQueue(writer)
    await writerQ.next() // ready (rev 0)

    writer.send(JSON.stringify({ type: "mutate", id: "m1", op: "set", path: "/score", value: 10 }))
    await writerQ.next() // ack rev 1
    writer.send(JSON.stringify({ type: "mutate", id: "m2", op: "set", path: "/score", value: 20 }))
    await writerQ.next() // ack rev 2

    const reconnecting = new WebSocket(wsUrl())
    const reconQ = createMessageQueue(reconnecting)
    await waitOpen(reconnecting)
    reconnecting.send(JSON.stringify({
      type: "auth",
      token: "sys_w",
      clientId: "rejoin-1",
      paths: ["/score"],
      sinceRev: 1,
    }))

    const ready = await reconQ.next()
    expect(ready).toMatchObject({
      type: "ready",
      rev: 2,
      replayTruncated: false,
      snapshots: [],
    })
    const replayed = await reconQ.next()
    expect(replayed).toMatchObject({
      type: "mutation",
      rev: 2,
      op: "set",
      path: "/score",
      value: 20,
      replayed: true,
    })

    writer.close()
    reconnecting.close()
  })

  it("rejects oversized frames (> 128 KiB), evicts unresponsive clients on heartbeat timeout (4008) with onDisconnect, and evicts slow consumers (4008)", async () => {
    const { wsUrl, service, hub } = await startGateway({
      configOverrides: {
        heartbeatIntervalMs: 35,
        maxMissedHeartbeats: 2,
        slowConsumerBytes: 512 * 1024,
      },
      initialDoc: { data: { players: { silent: { online: true } } } },
    })
    vi.mocked(service.authenticateWsToken).mockResolvedValue({
      spaceId: "ss_1",
      docId: "doc_1",
      ownerId: "u1",
      credentialType: "space_token",
      credentialId: "tok_hb",
      role: "write",
      isObserver: false,
    })

    // 1. Oversized frame (> 128 KiB) triggers WS 1009
    const big = new WebSocket(wsUrl(), { headers: { Authorization: "Bearer sys_big" } })
    const bigQ = createMessageQueue(big)
    await bigQ.next() // ready
    const bigClose = waitClose(big)
    big.send(JSON.stringify({ type: "mutate", op: "set", path: "/blob", value: "x".repeat(140_000) }))
    expect((await bigClose).code).toBe(1009)

    // 2. Unresponsive client (autoPong: false) closed with 4008 and runs onDisconnect
    const silent = new WebSocket(wsUrl(), {
      headers: { Authorization: "Bearer sys_silent" },
      autoPong: false,
    })
    const silentQ = createMessageQueue(silent)
    await silentQ.next() // ready
    silent.send(JSON.stringify({
      type: "onDisconnect.set",
      id: "od-s",
      actions: [{ op: "delete", path: "/players/silent" }],
    }))
    await silentQ.next() // ack
    const hbClose = await waitClose(silent, 2000)
    expect(hbClose.code).toBe(STATE_SYNC_WS_CLOSE_CODES.TIMEOUT_OR_SLOW)
    await vi.waitFor(() => {
      expect(hub.readDocPath("ss_1", "doc_1", "/players/silent")?.exists).toBe(false)
    })

    // 3. Slow consumer (> 512 KiB bufferedAmount) evicted with 4008 on broadcast
    const slow = new WebSocket(wsUrl(), { headers: { Authorization: "Bearer sys_slow" } })
    const slowQ = createMessageQueue(slow)
    const slowReady = await slowQ.next()
    const slowConnId = String(slowReady.connectionId)
    // Simulate backpressure on the server-side socket adapter by mutating bufferedAmount getter via Hub connection
    const writer = new WebSocket(wsUrl(), { headers: { Authorization: "Bearer sys_w" } })
    const writerQ = createMessageQueue(writer)
    await writerQ.next() // ready

    // Force slow consumer eviction via Hub slowConsumerBytes threshold check
    const internalConns = (hub as unknown as { connectionsById: Map<string, { socket: { bufferedAmount: number } }> }).connectionsById
    const slowConn = internalConns.get(slowConnId)
    expect(slowConn).toBeDefined()
    Object.defineProperty(slowConn!.socket, "bufferedAmount", { get: () => 513 * 1024 })

    const slowClose = waitClose(slow, 2000)
    writer.send(JSON.stringify({ type: "mutate", id: "push-1", op: "set", path: "/ping", value: 1 }))
    expect((await slowClose).code).toBe(STATE_SYNC_WS_CLOSE_CODES.TIMEOUT_OR_SLOW)

    writer.close()
  })
})
