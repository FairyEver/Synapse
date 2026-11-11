import { connect, type Socket } from "node:net"
import type { Duplex } from "node:stream"
import WebSocket, { createWebSocketStream, type RawData } from "ws"
import { boundedTunnelStream, TunnelByteBudget } from "@synapse/shared/tunnel-stream-node"
import { isTunnelPort, parseTunnelControlMessage, TUNNEL_CONTROL_PATH, TUNNEL_DATA_PATH, TUNNEL_LIMITS, type TunnelControlMessage, type TunnelMappingDto, type TunnelOpenMapping, type TunnelRuntimeStatus } from "@synapse/shared/tunnel-contracts"

export async function connectTunnelLoopback(port: number, signal: AbortSignal): Promise<Socket> {
  if (!isTunnelPort(port) || signal.aborted) throw new Error("TUNNEL_LOCAL_UNAVAILABLE")
  const deadline = Date.now() + TUNNEL_LIMITS.connectTimeoutMs
  for (const host of ["127.0.0.1", "::1"]) {
    try {
      return await new Promise<Socket>((resolve, reject) => {
        const socket = connect({ host, port, signal })
        socket.setTimeout(Math.max(1, deadline - Date.now()), () => socket.destroy(Object.assign(new Error("TUNNEL_CONNECT_TIMEOUT"), { code: "ETIMEDOUT" })))
        socket.once("connect", () => { socket.setTimeout(0); resolve(socket) })
        socket.once("error", reject)
      })
    } catch (error) {
      if (host !== "127.0.0.1" || signal.aborted || Date.now() >= deadline || !["ECONNREFUSED", "EADDRNOTAVAIL", "EAFNOSUPPORT", "ENETUNREACH"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error
    }
  }
  throw new Error("TUNNEL_LOCAL_UNAVAILABLE")
}
export interface TunnelTransportContext { clientInstanceId: string; deviceKey: string }
export interface TunnelTransportPort { start(context: TunnelTransportContext): Promise<void>; reconcile(mappings: readonly TunnelMappingDto[]): Promise<void>; stop(): Promise<void> }
export interface TunnelTransportDeps {
  getAuth(): Promise<{ token: string; apiBaseUrl: string }>
  authorizeCloud(): Promise<boolean>
  authorize(mapping: TunnelOpenMapping): Promise<boolean>
  onStatus(id: string, status: TunnelRuntimeStatus): void
  onFailure(code: string): void
}
interface DataFlow { id: string; mapping: TunnelOpenMapping; abort: AbortController; ws?: WebSocket; local?: Socket; stream?: Duplex }
function socketUrl(base: string, path: string): string {
  const url = new URL(base)
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("TUNNEL_INVALID_SERVER")
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"; url.pathname = path; url.search = ""; url.hash = ""
  return url.toString()
}
function decode(raw: RawData, binary: boolean): TunnelControlMessage | null {
  if (binary) return null
  const bytes = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw as ArrayBuffer)
  if (bytes.length > TUNNEL_LIMITS.controlFrameBytes) return null
  try { return parseTunnelControlMessage(JSON.parse(bytes.toString("utf8"))) } catch { return null }
}
export class TunnelTransport implements TunnelTransportPort {
  private context?: TunnelTransportContext
  private generation = 0
  private control?: WebSocket
  private ready = false
  private reconnect?: NodeJS.Timeout
  private heartbeat?: NodeJS.Timeout
  private attempts = 0
  private readonly mappings = new Map<string, TunnelMappingDto>()
  private readonly flows = new Map<string, DataFlow>()
  private readonly probes = new Set<AbortController>()
  private readonly byteBudget = new TunnelByteBudget()
  constructor(private readonly deps: TunnelTransportDeps) {}
  async start(context: TunnelTransportContext): Promise<void> {
    await this.stop(); this.context = context
    void this.connect(this.generation)
  }
  async reconcile(mappings: readonly TunnelMappingDto[]): Promise<void> {
    const next = new Map(mappings.filter(row => row.enabled).map(row => [row.id, row]))
    for (const flow of this.flows.values()) if (next.get(flow.mapping.id)?.revision !== flow.mapping.revision) this.cancel(flow.id)
    this.mappings.clear(); for (const [id, row] of next) this.mappings.set(id, row)
    if (this.ready) this.sendBindings()
  }
  private send(ws: WebSocket | undefined, message: TunnelControlMessage): boolean {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    if (ws.bufferedAmount > TUNNEL_LIMITS.controlFrameBytes * 4) { ws.terminate(); return false }
    ws.send(JSON.stringify(message)); return true
  }
  private sendBindings(): void { this.send(this.control, { version: 1, type: "bindings", mappings: [...this.mappings.values()].map(row => ({ id: row.id, revision: row.revision })) }) }
  private notify(mapping: TunnelOpenMapping, status: TunnelRuntimeStatus): void {
    if (this.mappings.get(mapping.id)?.revision !== mapping.revision) return
    this.deps.onStatus(mapping.id, status)
    this.send(this.control, { version: 1, type: "mapping-state", mappingId: mapping.id, revision: mapping.revision, status })
  }
  private retry(generation: number): void {
    if (!this.context || generation !== this.generation || this.reconnect) return
    this.ready = false
    for (const id of [...this.flows.keys()]) this.cancel(id)
    for (const row of this.mappings.values()) this.deps.onStatus(row.id, "offline")
    this.reconnect = setTimeout(() => { this.reconnect = undefined; void this.connect(generation) }, Math.min(30000, 500 * 2 ** Math.min(this.attempts++, 6)) + Math.floor(Math.random() * 250))
    this.reconnect.unref()
  }
  private async connect(generation: number): Promise<void> {
    const context = this.context
    if (!context || generation !== this.generation) return
    try {
      if (!await this.deps.authorizeCloud()) throw new Error("TUNNEL_PERMISSION_DENIED")
      const auth = await this.deps.getAuth()
      if (generation !== this.generation) return
      const ws = new WebSocket(socketUrl(auth.apiBaseUrl, TUNNEL_CONTROL_PATH), { headers: { Authorization: `Bearer ${auth.token}` }, handshakeTimeout: TUNNEL_LIMITS.connectTimeoutMs, maxPayload: TUNNEL_LIMITS.controlFrameBytes, perMessageDeflate: false })
      this.control = ws
      let lastPing = Date.now(), refreshing = false, sentToken = auth.token
      ws.on("ping", () => { lastPing = Date.now() })
      ws.once("open", () => this.send(ws, { version: 1, type: "hello", clientInstanceId: context.clientInstanceId, deviceKey: context.deviceKey }))
      ws.once("close", () => { if (generation === this.generation && this.control === ws) { clearInterval(this.heartbeat); this.control = undefined; this.retry(generation) } })
      ws.on("error", () => this.deps.onFailure("TUNNEL_CONTROL_CONNECTION_FAILED"))
      ws.on("message", (raw, binary) => {
        if (generation !== this.generation) return
        const message = decode(raw, binary)
        if (message?.type === "ready") { this.ready = true; this.attempts = 0; this.sendBindings() }
        else if (message?.type === "bindings-ready") {
          for (const ref of message.mappings) {
            const row = this.mappings.get(ref.id)
            if (row?.revision === ref.revision) void this.probe(row, generation)
          }
        } else if (message?.type === "open" && this.ready) void this.openData(message, generation)
        else if (message?.type === "cancel") this.cancel(message.requestId)
        else { this.deps.onFailure("TUNNEL_PROTOCOL_ERROR"); ws.terminate() }
      })
      this.heartbeat = setInterval(() => {
        if (Date.now() - lastPing > TUNNEL_LIMITS.heartbeatTimeoutMs) { ws.terminate(); return }
        if (!refreshing) {
          refreshing = true
          void this.deps.getAuth().then(next => { if (generation === this.generation && this.control === ws && next.token !== sentToken) { this.send(ws, { version: 1, type: "auth-refresh", token: next.token }); sentToken = next.token } })
            .catch(() => ws.terminate()).finally(() => { refreshing = false })
        }
      }, TUNNEL_LIMITS.heartbeatMs); this.heartbeat.unref()
    } catch { this.deps.onFailure("TUNNEL_CONTROL_CONNECTION_FAILED"); this.retry(generation) }
  }
  private async probe(mapping: TunnelMappingDto, generation: number): Promise<void> {
    const abort = new AbortController()
    this.probes.add(abort)
    try {
      if (!await this.deps.authorize(mapping)) { this.notify(mapping, "authorization-required"); return }
      if (generation !== this.generation) return
      const socket = await connectTunnelLoopback(mapping.port, abort.signal); socket.destroy()
      if (generation === this.generation) this.notify(mapping, "running")
    } catch { if (generation === this.generation) this.notify(mapping, "local-unavailable") }
    finally { this.probes.delete(abort) }
  }
  private async openData(message: Extract<TunnelControlMessage, { type: "open" }>, generation: number): Promise<void> {
    const mapping = this.mappings.get(message.mapping.id)
    if (!mapping || mapping.revision !== message.mapping.revision || mapping.port !== message.mapping.port || this.flows.has(message.requestId) || this.flows.size >= TUNNEL_LIMITS.streamsPerUser) { this.control?.terminate(); return }
    const flow: DataFlow = { id: message.requestId, mapping: message.mapping, abort: new AbortController() }
    this.flows.set(flow.id, flow)
    try {
      if (!await this.deps.authorize(mapping)) { this.notify(mapping, "authorization-required"); throw new Error("TUNNEL_PERMISSION_DENIED") }
      const auth = await this.deps.getAuth()
      if (generation !== this.generation || flow.abort.signal.aborted) { this.cancel(flow.id); return }
      const ws = new WebSocket(socketUrl(auth.apiBaseUrl, TUNNEL_DATA_PATH), { headers: { Authorization: `Bearer ${auth.token}` }, handshakeTimeout: TUNNEL_LIMITS.connectTimeoutMs, maxPayload: TUNNEL_LIMITS.dataMessageBytes, perMessageDeflate: false })
      flow.ws = ws
      ws.on("error", () => { this.deps.onFailure("TUNNEL_DATA_CONNECTION_FAILED"); this.cancel(flow.id) })
      ws.once("close", () => { if (!flow.stream) this.cancel(flow.id) })
      ws.once("open", () => {
        this.send(ws, { version: 1, type: "data-hello", requestId: flow.id, ticket: message.ticket })
        void connectTunnelLoopback(mapping.port, flow.abort.signal).then(local => {
          if (generation !== this.generation || flow.abort.signal.aborted || local.destroyed) { local.destroy(); this.cancel(flow.id); return }
          flow.local = local
          local.once("error", () => { this.notify(mapping, "local-unavailable"); this.cancel(flow.id) })
          this.send(ws, { version: 1, type: "data-ready" })
        }).catch(() => { this.notify(mapping, "local-unavailable"); this.send(ws, { version: 1, type: "data-error", code: "TUNNEL_LOCAL_UNAVAILABLE" }); ws.close() })
      })
      const accepted = (raw: RawData, binary: boolean) => {
        if (decode(raw, binary)?.type !== "data-accepted" || !flow.local || flow.abort.signal.aborted || generation !== this.generation) { this.cancel(flow.id); return }
        ws.removeListener("message", accepted)
        const stream = boundedTunnelStream(createWebSocketStream(ws, { highWaterMark: TUNNEL_LIMITS.dataMessageBytes }), this.byteBudget)
        flow.stream = stream
        stream.once("error", () => this.cancel(flow.id)); stream.once("close", () => this.cancel(flow.id))
        flow.local.pipe(stream).pipe(flow.local)
        this.notify(mapping, "running")
      }
      ws.on("message", accepted)
    } catch { this.deps.onFailure("TUNNEL_DATA_CONNECTION_FAILED"); this.cancel(flow.id) }
  }
  private cancel(id: string): void {
    const flow = this.flows.get(id)
    if (!flow) return
    this.flows.delete(id); flow.abort.abort(); flow.stream?.destroy(); flow.local?.destroy(); flow.ws?.terminate()
  }
  async stop(): Promise<void> {
    this.generation++; this.context = undefined; this.ready = false; clearTimeout(this.reconnect); this.reconnect = undefined; clearInterval(this.heartbeat)
    const control = this.control; this.control = undefined; control?.terminate()
    for (const probe of this.probes) probe.abort()
    this.probes.clear()
    for (const id of [...this.flows.keys()]) this.cancel(id)
    this.mappings.clear()
  }
}
