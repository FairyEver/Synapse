import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import http, { type IncomingMessage, type ServerResponse } from "node:http"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import vm from "node:vm"
import { afterEach, describe, expect, it } from "vitest"
import { WebSocket as NodeWebSocket, WebSocketServer } from "ws"
import {
  SDK_VERSION,
  StateSyncError,
  createClient,
  type StateSyncConnectionStatus,
  type StateSyncListenerMeta,
  type StateSyncOnDisconnectAction,
  type StateSyncPresenceMember,
  type StateSyncRoom,
} from "./index"

const __dirname = dirname(fileURLToPath(import.meta.url))
const sdkRoot = resolve(__dirname, "..", "..")

type MockDoc = {
  id: string
  spaceId: string
  data: Record<string, unknown>
  rev: number
  expiresAt: string | null
  history: Array<{
    rev: number
    op: "set" | "patch" | "delete"
    path: string
    value?: unknown
    ts: string
  }>
}

type MockConn = {
  ws: NodeWebSocket
  connectionId: string
  spaceId: string
  docId: string
  clientId: string
  clientName: string | null
  role: "read" | "write" | "create_write"
  meta: Record<string, unknown>
  connectedAt: string
  paths: string[]
  onDisconnectActions: StateSyncOnDisconnectAction[]
  skipOnDisconnect: boolean
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function isAncestorOrEqual(ancestor: string, target: string): boolean {
  if (ancestor === target || ancestor === "/") return true
  return target.startsWith(`${ancestor}/`)
}

function readTreePath(root: Record<string, unknown>, path: string): { exists: boolean; value: unknown } {
  if (path === "/") return { exists: true, value: structuredClone(root) }
  const segments = path.slice(1).split("/")
  let curr: unknown = root
  for (const seg of segments) {
    if (curr === null || typeof curr !== "object") return { exists: false, value: undefined }
    if (Array.isArray(curr)) {
      const idx = Number(seg)
      if (!Number.isInteger(idx) || idx < 0 || idx >= curr.length) return { exists: false, value: undefined }
      curr = curr[idx]
    } else {
      if (!Object.prototype.hasOwnProperty.call(curr, seg)) return { exists: false, value: undefined }
      curr = (curr as Record<string, unknown>)[seg]
    }
  }
  return { exists: true, value: structuredClone(curr) }
}

function mutateTree(
  root: Record<string, unknown>,
  op: "set" | "patch" | "delete",
  path: string,
  value?: unknown,
): { nextRoot: Record<string, unknown>; changed: boolean } {
  const next = structuredClone(root)
  if (path === "/") {
    if (op === "set" && isPlainObject(value)) {
      const changed = JSON.stringify(next) !== JSON.stringify(value)
      return { nextRoot: structuredClone(value), changed }
    }
    if (op === "patch" && isPlainObject(value)) {
      let changed = false
      for (const [k, v] of Object.entries(value)) {
        if (!Object.prototype.hasOwnProperty.call(next, k) || JSON.stringify(next[k]) !== JSON.stringify(v)) {
          changed = true
        }
        next[k] = structuredClone(v)
      }
      return { nextRoot: next, changed }
    }
    return { nextRoot: next, changed: false }
  }

  const segments = path.slice(1).split("/")
  let curr: Record<string, unknown> = next
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!
    if (!Object.prototype.hasOwnProperty.call(curr, seg) || curr[seg] === undefined) {
      if (op === "delete") return { nextRoot: next, changed: false }
      curr[seg] = {}
    }
    curr = curr[seg] as Record<string, unknown>
  }
  const leaf = segments[segments.length - 1]!
  if (op === "set") {
    const had = Object.prototype.hasOwnProperty.call(curr, leaf)
    const changed = !had || JSON.stringify(curr[leaf]) !== JSON.stringify(value)
    curr[leaf] = structuredClone(value)
    return { nextRoot: next, changed }
  }
  if (op === "patch" && isPlainObject(value)) {
    let changed = false
    if (!Object.prototype.hasOwnProperty.call(curr, leaf) || !isPlainObject(curr[leaf])) {
      curr[leaf] = {}
      changed = true
    }
    const target = curr[leaf] as Record<string, unknown>
    for (const [k, v] of Object.entries(value)) {
      if (!Object.prototype.hasOwnProperty.call(target, k) || JSON.stringify(target[k]) !== JSON.stringify(v)) {
        changed = true
      }
      target[k] = structuredClone(v)
    }
    return { nextRoot: next, changed }
  }
  if (op === "delete") {
    if (Object.prototype.hasOwnProperty.call(curr, leaf)) {
      delete curr[leaf]
      return { nextRoot: next, changed: true }
    }
    return { nextRoot: next, changed: false }
  }
  return { nextRoot: next, changed: false }
}

class MockStateSyncServer {
  readonly server: http.Server
  readonly wss: WebSocketServer
  readonly docs = new Map<string, MockDoc>()
  readonly conns = new Set<MockConn>()
  readonly authFrames: Array<Record<string, unknown>> = []
  readonly onDisconnectSetCount = { value: 0 }
  readonly mutateFrames: Array<Record<string, unknown>> = []
  forceConflictRev: number | null = null
  validToken = "sys_test_token"
  private docSeq = 0
  private connSeq = 0
  baseUrl = ""

  constructor() {
    this.wss = new WebSocketServer({ noServer: true })
    this.server = http.createServer((req, res) => {
      void this.handleHttp(req, res)
    })

    this.server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1")
      const match = /^\/api\/open\/v1\/state-sync\/spaces\/([^/]+)\/docs\/([^/]+)\/ws\/?$/u.exec(url.pathname)
      if (!match) {
        socket.destroy()
        return
      }
      const spaceId = decodeURIComponent(match[1]!)
      const docId = decodeURIComponent(match[2]!)
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.bindSocket(ws, spaceId, docId)
      })
    })
  }

  async start(): Promise<string> {
    await new Promise<void>((resolveReady) => {
      this.server.listen(0, "127.0.0.1", () => resolveReady())
    })
    const addr = this.server.address()
    if (!addr || typeof addr === "string") throw new Error("Failed to bind server")
    this.baseUrl = `http://127.0.0.1:${addr.port}`
    return this.baseUrl
  }

  async close(): Promise<void> {
    for (const conn of [...this.conns]) {
      conn.skipOnDisconnect = true
      conn.ws.close(1000, "Server closing")
    }
    this.conns.clear()
    await new Promise<void>((done) => this.wss.close(() => done()))
    await new Promise<void>((done) => this.server.close(() => done()))
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const auth = req.headers.authorization
    if (auth !== `Bearer ${this.validToken}`) {
      res.writeHead(401, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ requestId: "req_1", error: { code: "INVALID_CREDENTIAL", message: "Invalid token" } }))
      return
    }

    const url = new URL(req.url ?? "/", "http://127.0.0.1")
    const createMatch = /^\/api\/open\/v1\/state-sync\/spaces\/([^/]+)\/docs$/u.exec(url.pathname)
    if (req.method === "POST" && createMatch) {
      const spaceId = decodeURIComponent(createMatch[1]!)
      const bodyText = await new Promise<string>((done) => {
        const chunks: Buffer[] = []
        req.on("data", (chunk: Buffer) => chunks.push(chunk))
        req.on("end", () => done(Buffer.concat(chunks).toString("utf8")))
      })
      const body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {}
      const docId = typeof body.docId === "string" ? body.docId : `ssd_mock_${++this.docSeq}`
      const initialData = isPlainObject(body.initialData) ? structuredClone(body.initialData) : {}
      const ttl = typeof body.ttlSeconds === "number" ? body.ttlSeconds : body.ttlSeconds === null ? null : 86400
      const expiresAt = ttl !== null ? new Date(Date.now() + ttl * 1000).toISOString() : null
      const doc: MockDoc = { id: docId, spaceId, data: initialData, rev: 0, expiresAt, history: [] }
      this.docs.set(`${spaceId}:${docId}`, doc)
      res.writeHead(201, { "Content-Type": "application/json" })
      res.end(JSON.stringify({
        spaceId,
        docId,
        rev: 0,
        expiresAt,
        wsPath: `/api/open/v1/state-sync/spaces/${spaceId}/docs/${docId}/ws`,
      }))
      return
    }

    const getMatch = /^\/api\/open\/v1\/state-sync\/spaces\/([^/]+)\/docs\/([^/]+)$/u.exec(url.pathname)
    if (req.method === "GET" && getMatch) {
      const spaceId = decodeURIComponent(getMatch[1]!)
      const docId = decodeURIComponent(getMatch[2]!)
      const doc = this.docs.get(`${spaceId}:${docId}`)
      if (!doc) {
        res.writeHead(404, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ requestId: "req_2", error: { code: "DOC_NOT_FOUND", message: "Not found" } }))
        return
      }
      const targetPath = url.searchParams.get("path") || "/"
      const read = readTreePath(doc.data, targetPath)
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({
        spaceId,
        docId,
        path: targetPath,
        exists: read.exists,
        value: read.value,
        rev: doc.rev,
        expiresAt: doc.expiresAt,
      }))
      return
    }

    res.writeHead(404, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ requestId: "req_404", error: { code: "NOT_FOUND", message: "Not found" } }))
  }

  private presenceList(spaceId: string, docId: string): StateSyncPresenceMember[] {
    return [...this.conns]
      .filter((c) => c.spaceId === spaceId && c.docId === docId)
      .map((c) => ({
        connectionId: c.connectionId,
        clientId: c.clientId,
        clientName: c.clientName,
        role: c.role,
        meta: structuredClone(c.meta),
        connectedAt: c.connectedAt,
      }))
  }

  private applyAndBroadcast(
    doc: MockDoc,
    input: {
      op: "set" | "patch" | "delete"
      path: string
      value?: unknown
      sourceConnectionId?: string
      echo?: boolean
    },
  ): { rev: number; changed: boolean } {
    const res = mutateTree(doc.data, input.op, input.path, input.value)
    if (!res.changed) return { rev: doc.rev, changed: false }
    doc.data = res.nextRoot
    doc.rev += 1
    const ts = new Date().toISOString()
    doc.history.push({ rev: doc.rev, op: input.op, path: input.path, value: structuredClone(input.value), ts })

    for (const peer of this.conns) {
      if (peer.spaceId !== doc.spaceId || peer.docId !== doc.id) continue
      if (peer.connectionId === input.sourceConnectionId && !input.echo) continue
      if (peer.ws.readyState !== NodeWebSocket.OPEN) continue

      const covered = peer.paths.some((p) => isAncestorOrEqual(p, input.path))
      if (covered) {
        peer.ws.send(JSON.stringify({
          type: "mutation",
          rev: doc.rev,
          op: input.op,
          path: input.path,
          ...(input.op !== "delete" ? { value: structuredClone(input.value) } : {}),
          replayed: false,
          ts,
        }))
      } else {
        const affectedChildren = peer.paths.filter((p) => p !== input.path && isAncestorOrEqual(input.path, p))
        for (const childPath of affectedChildren) {
          const snap = readTreePath(doc.data, childPath)
          peer.ws.send(JSON.stringify({
            type: "snapshot",
            rev: doc.rev,
            path: childPath,
            exists: snap.exists,
            value: snap.value,
          }))
        }
      }
    }
    return { rev: doc.rev, changed: true }
  }

  kickConnections(code: number, reason: string, skipOnDisconnect = true): void {
    for (const conn of [...this.conns]) {
      conn.skipOnDisconnect = skipOnDisconnect
      conn.ws.close(code, reason)
    }
  }

  private bindSocket(ws: NodeWebSocket, spaceId: string, docId: string): void {
    let conn: MockConn | null = null

    ws.on("message", (raw) => {
      const frame = JSON.parse(raw.toString("utf8")) as Record<string, unknown>
      if (!conn) {
        if (frame.type !== "auth") {
          ws.send(JSON.stringify({ type: "error", code: "UNAUTHENTICATED", message: "Auth required" }))
          ws.close(4001, "Unauthenticated")
          return
        }
        this.authFrames.push(frame)
        if (frame.token !== this.validToken) {
          ws.send(JSON.stringify({ type: "error", code: "INVALID_CREDENTIAL", message: "Invalid credential" }))
          ws.close(4001, "Invalid credential")
          return
        }
        const doc = this.docs.get(`${spaceId}:${docId}`)
        if (!doc) {
          ws.send(JSON.stringify({ type: "error", code: "DOC_NOT_FOUND", message: "Doc not found" }))
          ws.close(4003, "Doc not found")
          return
        }

        const paths = Array.isArray(frame.paths) && frame.paths.length > 0 ? (frame.paths as string[]) : ["/"]
        conn = {
          ws,
          connectionId: `conn_mock_${++this.connSeq}`,
          spaceId,
          docId,
          clientId: typeof frame.clientId === "string" ? frame.clientId : `cli_${this.connSeq}`,
          clientName: typeof frame.clientName === "string" ? frame.clientName : null,
          role: "create_write",
          meta: isPlainObject(frame.meta) ? structuredClone(frame.meta) : {},
          connectedAt: new Date().toISOString(),
          paths,
          onDisconnectActions: [],
          skipOnDisconnect: false,
        }

        const member: StateSyncPresenceMember = {
          connectionId: conn.connectionId,
          clientId: conn.clientId,
          clientName: conn.clientName,
          role: conn.role,
          meta: structuredClone(conn.meta),
          connectedAt: conn.connectedAt,
        }
        for (const peer of this.conns) {
          if (peer.spaceId === spaceId && peer.docId === docId && peer.ws.readyState === NodeWebSocket.OPEN) {
            peer.ws.send(JSON.stringify({ type: "presence.join", member }))
          }
        }
        this.conns.add(conn)

        const sinceRev = typeof frame.sinceRev === "number" ? frame.sinceRev : undefined
        let snapshots: Array<{ path: string; exists: boolean; value: unknown }> = []
        let replayed: Array<Record<string, unknown>> = []
        if (sinceRev === undefined) {
          snapshots = paths.map((p) => ({ path: p, ...readTreePath(doc.data, p) }))
        } else {
          replayed = doc.history
            .filter((h) => h.rev > sinceRev)
            .map((h) => ({
              type: "mutation",
              rev: h.rev,
              op: h.op,
              path: h.path,
              ...(h.op !== "delete" ? { value: h.value } : {}),
              replayed: true,
              ts: h.ts,
            }))
        }

        ws.send(JSON.stringify({
          type: "ready",
          spaceId,
          docId,
          connectionId: conn.connectionId,
          clientId: conn.clientId,
          role: conn.role,
          rev: doc.rev,
          expiresAt: doc.expiresAt,
          replayTruncated: false,
          presence: this.presenceList(spaceId, docId),
          snapshots,
        }))

        for (const replayFrame of replayed) {
          ws.send(JSON.stringify(replayFrame))
        }
        return
      }

      const doc = this.docs.get(`${spaceId}:${docId}`)
      if (!doc) return

      switch (frame.type) {
        case "ping":
          ws.send(JSON.stringify({ type: "pong", serverTime: new Date().toISOString() }))
          return
        case "presence.update":
          if (typeof frame.clientName === "string") conn.clientName = frame.clientName
          if (isPlainObject(frame.meta)) conn.meta = structuredClone(frame.meta)
          for (const peer of this.conns) {
            if (peer.spaceId === spaceId && peer.docId === docId && peer.ws.readyState === NodeWebSocket.OPEN) {
              peer.ws.send(JSON.stringify({
                type: "presence.update",
                member: {
                  connectionId: conn.connectionId,
                  clientId: conn.clientId,
                  clientName: conn.clientName,
                  role: conn.role,
                  meta: structuredClone(conn.meta),
                  connectedAt: conn.connectedAt,
                },
              }))
            }
          }
          return
        case "onDisconnect.set":
          this.onDisconnectSetCount.value += 1
          conn.onDisconnectActions = Array.isArray(frame.actions)
            ? (structuredClone(frame.actions) as StateSyncOnDisconnectAction[])
            : []
          if (frame.id) ws.send(JSON.stringify({ type: "ack", id: frame.id }))
          return
        case "onDisconnect.clear":
          conn.onDisconnectActions = []
          if (frame.id) ws.send(JSON.stringify({ type: "ack", id: frame.id }))
          return
        case "mutate": {
          this.mutateFrames.push(frame)
          if (this.forceConflictRev !== null) {
            ws.send(JSON.stringify({
              type: "error",
              id: frame.id,
              code: "REV_CONFLICT",
              message: "Revision conflict",
              currentRev: this.forceConflictRev,
            }))
            return
          }
          if (typeof frame.expectedRev === "number" && frame.expectedRev !== doc.rev) {
            ws.send(JSON.stringify({
              type: "error",
              id: frame.id,
              code: "REV_CONFLICT",
              message: "Revision conflict",
              currentRev: doc.rev,
            }))
            return
          }
          const applied = this.applyAndBroadcast(doc, {
            op: frame.op as "set" | "patch" | "delete",
            path: frame.path as string,
            value: frame.value,
            sourceConnectionId: conn.connectionId,
            echo: Boolean(frame.echo),
          })
          ws.send(JSON.stringify({
            type: "ack",
            id: frame.id,
            rev: applied.rev,
            changed: applied.changed,
          }))
          return
        }
      }
    })

    ws.on("close", () => {
      if (!conn) return
      const leaving = conn
      conn = null
      this.conns.delete(leaving)
      const doc = this.docs.get(`${spaceId}:${docId}`)
      if (!doc) return

      for (const peer of this.conns) {
        if (peer.spaceId === spaceId && peer.docId === docId && peer.ws.readyState === NodeWebSocket.OPEN) {
          peer.ws.send(JSON.stringify({
            type: "presence.leave",
            member: {
              connectionId: leaving.connectionId,
              clientId: leaving.clientId,
              clientName: leaving.clientName,
              role: leaving.role,
              meta: structuredClone(leaving.meta),
              connectedAt: leaving.connectedAt,
            },
          }))
        }
      }

      if (!leaving.skipOnDisconnect && leaving.onDisconnectActions.length > 0) {
        for (const action of leaving.onDisconnectActions) {
          this.applyAndBroadcast(doc, {
            op: action.op,
            path: action.path,
            value: action.value,
          })
        }
      }
    })
  }
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 15))
  }
  throw new Error("Timed out waiting for condition")
}

describe("@synapse/sdk state-sync client", () => {
  const servers: MockStateSyncServer[] = []
  const rooms: StateSyncRoom[] = []

  afterEach(async () => {
    for (const room of rooms.splice(0)) {
      room.close()
    }
    for (const server of servers.splice(0)) {
      await server.close()
    }
  })

  it("supports createRoom, join, getSnapshot, immediate on() callback, incremental patch, and ancestor set('/', {}) notifying child with exists:false", async () => {
    const server = new MockStateSyncServer()
    servers.push(server)
    const baseUrl = await server.start()

    const client = createClient({
      baseUrl,
      spaceId: "ss_game",
      token: "sys_test_token",
      WebSocket: NodeWebSocket,
    })

    // createRoom with connect: false returns detached metadata
    const detached = await client.createRoom({
      initialData: { status: "idle" },
      connect: false,
    })
    expect(detached.docId).toMatch(/^ssd_mock_/)
    expect(detached.rev).toBe(0)
    expect(detached.wsPath).toContain(detached.docId)
    expect("room" in detached).toBe(false)

    // createRoom with default connect: true joins automatically
    const created = await client.createRoom({
      initialData: { board: { "0": "X" }, turn: "p1" },
      ttlSeconds: 3600,
      clientId: "p1",
      clientName: "Alice",
    })
    const room1 = created.room
    rooms.push(room1)

    expect(SDK_VERSION).toBe("1.0.0")
    expect(room1.docId).toBe(created.docId)
    expect(room1.clientId).toBe("p1")
    expect(room1.get("/board")).toEqual({ "0": "X" })
    // get() returns a defensive deep clone
    const clonedBoard = room1.get<Record<string, string>>("/board")!
    clonedBoard["0"] = "MUTATED"
    expect(room1.get("/board/0")).toBe("X")

    // Join second client with partial path subscription (/board) AND full-path client
    const room2 = await client.join(created.docId, {
      clientId: "p2",
      clientName: "Bob",
      paths: ["/board"],
    })
    rooms.push(room2)

    const events1: Array<{ value: unknown; meta: StateSyncListenerMeta }> = []
    const events2: Array<{ value: unknown; meta: StateSyncListenerMeta }> = []

    const off1 = room1.on("/board", (value, meta) => {
      events1.push({ value, meta })
    })
    const off2 = room2.on("/board", (value, meta) => {
      events2.push({ value, meta })
    })

    // Immediate initial callbacks
    expect(events1).toEqual([
      { value: { "0": "X" }, meta: { rev: 0, path: "/board", exists: true } },
    ])
    expect(events2).toEqual([
      { value: { "0": "X" }, meta: { rev: 0, path: "/board", exists: true } },
    ])

    // Incremental patch from room1 updates both room1 (via ack) and room2 (via mutation)
    const patchRes = await room1.patch("/board", { "4": "O" })
    expect(patchRes).toEqual({ rev: 1, changed: true })
    expect(room1.get("/board")).toEqual({ "0": "X", "4": "O" })

    await waitForCondition(() => events2.length >= 2)
    expect(events1[1]).toEqual({
      value: { "0": "X", "4": "O" },
      meta: { rev: 1, path: "/board", exists: true },
    })
    expect(events2[1]).toEqual({
      value: { "0": "X", "4": "O" },
      meta: { rev: 1, path: "/board", exists: true },
    })

    // Ancestor overwrite set("/", {}) must notify child listeners with exists: false
    // on both full-path room1 (mutation at "/") and partial-path room2 (snapshot at "/board" exists:false)
    await room1.set("/", {})
    await waitForCondition(() => events2.length >= 3)

    expect(events1[2]).toEqual({
      value: undefined,
      meta: { rev: 2, path: "/board", exists: false },
    })
    expect(events2[2]).toEqual({
      value: undefined,
      meta: { rev: 2, path: "/board", exists: false },
    })
    expect(room1.get("/board")).toBeUndefined()
    expect(room2.get("/board")).toBeUndefined()

    off1()
    off2()

    // HTTP getSnapshot
    const snap = await client.getSnapshot(created.docId, "/")
    expect(snap.rev).toBe(2)
    expect(snap.exists).toBe(true)
    expect(snap.value).toEqual({})
  })

  it("handles transaction contention, abort/undefined no-op, remove(), retry exhaustion, and PATH_NOT_SUBSCRIBED", async () => {
    const server = new MockStateSyncServer()
    servers.push(server)
    const baseUrl = await server.start()

    const client = createClient({
      baseUrl,
      spaceId: "ss_game",
      token: "sys_test_token",
      WebSocket: NodeWebSocket,
    })

    const { docId, room: roomA } = await client.createRoom({
      initialData: { board: {} },
      clientId: "p1",
    })
    const roomB = await client.join(docId, { clientId: "p2" })
    const partialRoom = await client.join(docId, { clientId: "p3", paths: ["/players"] })
    rooms.push(roomA, roomB, partialRoom)

    // 1. Fail-fast PATH_NOT_SUBSCRIBED on partial-path room
    const mutateCountBefore = server.mutateFrames.length
    await expect(
      partialRoom.transaction("/board/4", () => "Z"),
    ).rejects.toSatisfy((err: unknown) => err instanceof StateSyncError && err.code === "PATH_NOT_SUBSCRIBED")
    expect(server.mutateFrames.length).toBe(mutateCountBefore)

    // 2. Concurrent contention: two clients race for /board/4
    const [resA, resB] = await Promise.all([
      roomA.transaction<string>("/board/4", (current, { abort }) => {
        if (current !== undefined) return abort()
        return "X"
      }),
      roomB.transaction<string>("/board/4", (current, { abort }) => {
        if (current !== undefined) return abort()
        return "O"
      }),
    ])

    const results = [resA, resB]
    const winner = results.find((r) => r.committed)
    const loser = results.find((r) => !r.committed)
    expect(winner).toBeDefined()
    expect(loser).toBeDefined()
    expect(winner!.value === "X" || winner!.value === "O").toBe(true)
    expect(loser!.value).toBe(winner!.value)
    expect(roomA.get("/board/4")).toBe(winner!.value)
    await waitForCondition(() => roomB.get("/board/4") === winner!.value)

    // 3. Returning undefined aborts without sending a network request
    const beforeAbortCount = server.mutateFrames.length
    const undefAbort = await roomA.transaction("/board/4", () => undefined)
    expect(undefAbort.committed).toBe(false)
    expect(undefAbort.value).toBe(winner!.value)
    expect(server.mutateFrames.length).toBe(beforeAbortCount)

    // 4. remove() sends delete and clears the key
    const removed = await roomA.transaction("/board/4", (_current, { remove }) => remove())
    expect(removed.committed).toBe(true)
    expect(removed.value).toBeUndefined()
    expect(roomA.get("/board/4")).toBeUndefined()

    // 5. Exhausting 5 retries rejects with StateSyncError("REV_CONFLICT")
    server.forceConflictRev = 999
    const beforeConflictCount = server.mutateFrames.length
    await expect(
      roomA.transaction("/board/5", () => "X", { maxRetries: 5 }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof StateSyncError && err.code === "REV_CONFLICT" && err.currentRev === 999,
    )
    // 1 initial attempt + 5 retries = 6 mutate attempts
    expect(server.mutateFrames.length - beforeConflictCount).toBe(6)
    server.forceConflictRev = null
  })

  it("re-registers onDisconnect automatically after 1001 reconnect, replays missed rev, and stops reconnecting on 4003", async () => {
    const server = new MockStateSyncServer()
    servers.push(server)
    const baseUrl = await server.start()

    const client = createClient({
      baseUrl,
      spaceId: "ss_game",
      token: "sys_test_token",
      WebSocket: NodeWebSocket,
      reconnectBaseDelayMs: 40,
      reconnectMaxDelayMs: 120,
      heartbeatIntervalMs: 5000,
    })

    const { docId, room: room1 } = await client.createRoom({
      initialData: { players: { p1: { online: true } } },
      clientId: "p1",
      clientName: "Player 1",
    })
    const observer = await client.join(docId, { clientId: "obs" })
    rooms.push(room1, observer)

    const statuses: StateSyncConnectionStatus[] = []
    room1.onStatus((s) => statuses.push(s))
    expect(statuses[0]).toBe("connected")

    await room1.onDisconnect([
      { op: "patch", path: "/players/p1", value: { online: false } },
    ])
    expect(server.onDisconnectSetCount.value).toBe(1)

    const initialConnId = room1.connectionId

    // Simulate server graceful restart (1001) on room1 only
    const room1ServerConn = [...server.conns].find((c) => c.connectionId === initialConnId)!
    room1ServerConn.skipOnDisconnect = true
    room1ServerConn.ws.close(1001, "Server restarting")

    // While room1 is reconnecting, observer writes a mutation
    await observer.set("/players/p2", { online: true })

    // Wait for room1 to reconnect, receive new connectionId, replay /players/p2, and re-register onDisconnect
    await waitForCondition(
      () =>
        room1.connectionId !== initialConnId
        && room1.get("/players/p2") !== undefined
        && server.onDisconnectSetCount.value >= 2,
      3000,
    )

    expect(statuses).toContain("reconnecting")
    expect(statuses[statuses.length - 1]).toBe("connected")
    // Verify auth frame on reconnect carried sinceRev
    const reconnectAuth = server.authFrames.find(
      (f) => f.clientId === "p1" && typeof f.sinceRev === "number",
    )
    expect(reconnectAuth).toBeDefined()

    // Now simulate a real disconnect (1000) of room1; the re-registered onDisconnect action must fire on server!
    room1.close()
    await waitForCondition(() => {
      const p1 = observer.get<{ online: boolean }>("/players/p1")
      return p1?.online === false
    }, 3000)

    // Verify 4003 stops reconnect loop cleanly
    const roomRevoked = await client.join(docId, { clientId: "p_revoked" })
    rooms.push(roomRevoked)
    const revokedStatuses: StateSyncConnectionStatus[] = []
    roomRevoked.onStatus((s) => revokedStatuses.push(s))

    const authCountBeforeRevoke = server.authFrames.length
    const revokedServerConn = [...server.conns].find((c) => c.connectionId === roomRevoked.connectionId)!
    revokedServerConn.skipOnDisconnect = true
    revokedServerConn.ws.close(4003, "Token revoked")

    await waitForCondition(() => revokedStatuses[revokedStatuses.length - 1] === "closed", 2000)
    await new Promise((r) => setTimeout(r, 200))
    expect(revokedStatuses).not.toContain("reconnecting")
    expect(server.authFrames.length).toBe(authCountBeforeRevoke)
  })

  it("tracks presence join/update/leave and rejects invalid paths", async () => {
    const server = new MockStateSyncServer()
    servers.push(server)
    const baseUrl = await server.start()

    const client = createClient({
      baseUrl,
      spaceId: "ss_game",
      token: "sys_test_token",
      WebSocket: NodeWebSocket,
    })

    const { docId, room: room1 } = await client.createRoom({
      clientId: "p1",
      clientName: "Alice",
      meta: { seat: "black" },
    })
    rooms.push(room1)

    const presenceSnapshots: StateSyncPresenceMember[][] = []
    const offPresence = room1.onPresence((members) => {
      presenceSnapshots.push(members)
    })
    expect(presenceSnapshots[0]).toHaveLength(1)

    const room2 = await client.join(docId, {
      clientId: "p2",
      clientName: "Bob",
      meta: { seat: "white" },
    })
    rooms.push(room2)

    await waitForCondition(() => presenceSnapshots.some((m) => m.length === 2))
    room2.updatePresence({ clientName: "Bob Updated", meta: { seat: "white", ready: true } })
    await waitForCondition(() =>
      presenceSnapshots.some((m) => m.some((p) => p.clientId === "p2" && p.clientName === "Bob Updated")),
    )

    room2.close()
    await waitForCondition(() => presenceSnapshots[presenceSnapshots.length - 1]?.length === 1)
    offPresence()

    // Invalid paths rejected locally
    expect(() => room1.get("no-leading-slash")).toThrow(StateSyncError)
    expect(() => room1.get("/__proto__/pollute")).toThrow(StateSyncError)
    expect(() => room1.get("/a/".repeat(17).slice(0, -1))).toThrow(StateSyncError)
    await expect(room1.delete("/")).rejects.toThrow(StateSyncError)
  })
})

describe("@synapse/sdk build pipeline and artifacts", () => {
  it("builds IIFE/ESM/CJS/d.ts bundles, versions v1 + 1.0.0, manifests, and valid SHA-256 SRI hashes", async () => {
    execFileSync(process.execPath, [resolve(sdkRoot, "scripts", "build.mjs")], {
      cwd: sdkRoot,
      stdio: "pipe",
    })

    const distDir = resolve(sdkRoot, "dist")
    const rootManifestPath = resolve(distDir, "manifest.json")
    const sdkManifestPath = resolve(distDir, "state-sync", "manifest.json")

    expect(existsSync(rootManifestPath)).toBe(true)
    expect(existsSync(sdkManifestPath)).toBe(true)

    const rootManifest = JSON.parse(readFileSync(rootManifestPath, "utf8")) as {
      schemaVersion: number
      sdks: Record<string, Record<string, unknown>>
    }
    const sdkManifest = JSON.parse(readFileSync(sdkManifestPath, "utf8")) as {
      schemaVersion: number
      name: string
      latest: string
      major: string
      globalName: string
      docsUrl: string
      nodeDownloadCommand: string
      versions: string[]
      files: Record<
        "browserGlobal" | "esm" | "cjs" | "types",
        { url: string; latestUrl: string; integrity: string; bytes: number }
      >
    }

    expect(rootManifest.schemaVersion).toBe(1)
    expect(rootManifest.sdks["state-sync"]).toBeDefined()
    expect(sdkManifest.name).toBe("state-sync")
    expect(sdkManifest.latest).toBe("1.0.0")
    expect(sdkManifest.major).toBe("v1")
    expect(sdkManifest.globalName).toBe("SynapseStateSync")
    expect(sdkManifest.versions).toContain("1.0.0")
    expect(sdkManifest.nodeDownloadCommand).toContain("curl")

    const expectedFiles = [
      ["browserGlobal", "state-sync.global.min.js"],
      ["esm", "state-sync.esm.min.js"],
      ["cjs", "state-sync.cjs"],
      ["types", "index.d.ts"],
    ] as const

    for (const [key, filename] of expectedFiles) {
      const exactPath = resolve(distDir, "state-sync", "1.0.0", filename)
      const majorPath = resolve(distDir, "state-sync", "v1", filename)
      expect(existsSync(exactPath), exactPath).toBe(true)
      expect(existsSync(majorPath), majorPath).toBe(true)

      const exactBuf = readFileSync(exactPath)
      const majorBuf = readFileSync(majorPath)
      expect(exactBuf.equals(majorBuf)).toBe(true)

      const expectedIntegrity = `sha256-${createHash("sha256").update(exactBuf).digest("base64")}`
      expect(sdkManifest.files[key].integrity).toBe(expectedIntegrity)
      expect(sdkManifest.files[key].bytes).toBe(exactBuf.byteLength)
      expect(sdkManifest.files[key].url).toBe(`/sdk/state-sync/1.0.0/${filename}`)
      expect(sdkManifest.files[key].latestUrl).toBe(`/sdk/state-sync/v1/${filename}`)
    }

    // 1. Verify IIFE bundle attaches global SynapseStateSync.createClient
    const globalCode = readFileSync(resolve(distDir, "state-sync", "1.0.0", "state-sync.global.min.js"), "utf8")
    const sandbox: Record<string, unknown> = { globalThis: {} }
    sandbox.window = sandbox
    sandbox.self = sandbox
    sandbox.globalThis = sandbox
    vm.runInNewContext(globalCode, sandbox)
    const globalSdk = sandbox.SynapseStateSync as Record<string, unknown>
    expect(globalSdk).toBeDefined()
    expect(typeof globalSdk.createClient).toBe("function")
    expect(globalSdk.SDK_VERSION).toBe("1.0.0")

    // 2. Verify CJS bundle loads via require()
    const requireFromHere = createRequire(import.meta.url)
    const cjsSdk = requireFromHere(resolve(distDir, "state-sync", "1.0.0", "state-sync.cjs")) as Record<string, unknown>
    expect(typeof cjsSdk.createClient).toBe("function")
    expect(cjsSdk.SDK_VERSION).toBe("1.0.0")

    // 3. Verify ESM bundle loads via import()
    const esmUrl = pathToFileURL(resolve(distDir, "state-sync", "1.0.0", "state-sync.esm.min.js")).href
    const esmSdk = (await import(esmUrl)) as Record<string, unknown>
    expect(typeof esmSdk.createClient).toBe("function")
    expect(esmSdk.SDK_VERSION).toBe("1.0.0")

    // 4. Verify standalone index.d.ts has no broken relative imports and compiles standalone via tsc
    const dtsPath = resolve(distDir, "state-sync", "1.0.0", "index.d.ts")
    const dts = readFileSync(dtsPath, "utf8")
    expect(dts).not.toMatch(/from\s+["']\.\.?\//u)
    expect(dts).toContain("createClient")
    expect(dts).toContain("StateSyncError")
    expect(dts).toContain("SDK_VERSION")
    expect(dts).not.toContain("export declare class WsTransport")

    const tmpConsumerDir = mkdtempSync(join(tmpdir(), "synapse-sdk-dts-check-"))
    try {
      const tscBin = requireFromHere.resolve("typescript/bin/tsc")
      writeFileSync(
        join(tmpConsumerDir, "index.d.ts"),
        dts,
        "utf8",
      )
      writeFileSync(
        join(tmpConsumerDir, "consumer.ts"),
        [
          'import { createClient, SDK_VERSION, StateSyncError } from "./index"',
          'const c = createClient({ baseUrl: "https://example.com", spaceId: "ss_1", token: "sys_1" })',
          'void c.getSnapshot("ssd_1")',
          'const e = new StateSyncError("REV_CONFLICT", "conflict", { currentRev: 1 })',
          'const v: string = SDK_VERSION',
          'void e',
          'void v',
          "",
        ].join("\n"),
        "utf8",
      )
      execFileSync(
        process.execPath,
        [tscBin, "--noEmit", "--strict", "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "Bundler", "--lib", "ES2022,DOM", join(tmpConsumerDir, "consumer.ts")],
        { cwd: tmpConsumerDir, stdio: "pipe" },
      )
    } finally {
      rmSync(tmpConsumerDir, { recursive: true, force: true })
    }
  })
})
