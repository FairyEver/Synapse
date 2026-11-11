import { createHash, randomBytes, randomUUID } from "node:crypto"
import type { Duplex } from "node:stream"
import { TUNNEL_LIMITS, type TunnelBindingRef, type TunnelControlMessage, type TunnelMappingDto, type TunnelRuntimeStatus } from "@synapse/shared/tunnel-contracts"
import type { TunnelDeviceActor } from "./tunnel-device.service"
import type { TunnelRow } from "./tunnel.repository"
import { TunnelService } from "./tunnel.service"
import { TunnelBudget, TunnelTransportError } from "./tunnel-budget"

interface Session {
  id: string; actor: TunnelDeviceActor; send(message: TunnelControlMessage): void; close(): void
  mappings: Map<string, TunnelMappingDto>; states: Map<string, TunnelRuntimeStatus>
}
interface Flow {
  id: string; mappingId: string; revision: number; session: Session; hash: string; expires: number
  stream?: Duplex; cancelSocket?: () => void; timer: NodeJS.Timeout; release(): void; cleanup(): void
  resolve(stream: Duplex): void; reject(error: Error): void; settled: boolean
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex")
const key = (actor: TunnelDeviceActor) => actor.userId + ":" + actor.clientInstanceId
export class TunnelBroker {
  private readonly sessions = new Map<string, Session>()
  private readonly devices = new Map<string, Session>()
  private readonly mappingSessions = new Map<string, Session>()
  private readonly flows = new Map<string, Flow>()
  private readonly bindingReads = new Set<{ ids: Set<string>; invalidated: Set<string> }>()
  private readonly tickets = new Map<string, Flow>()
  private readonly budget: TunnelBudget
  private readonly now: () => number
  constructor(private readonly service: TunnelService, options: { now?: () => number; budget?: TunnelBudget } = {}) {
    this.now = options.now ?? Date.now; this.budget = options.budget ?? new TunnelBudget()
    service.setRuntime(this)
  }
  get activeCount(): number { return this.budget.size }
  status(row: TunnelRow): TunnelRuntimeStatus {
    const session = this.mappingSessions.get(row.id)
    return session?.mappings.get(row.id)?.revision === row.revision ? session.states.get(row.id) ?? "connecting" : "offline"
  }
  register(actor: TunnelDeviceActor, send: Session["send"], close: () => void): string {
    const old = this.devices.get(key(actor))
    if (old) { this.disconnect(old.id); old.close() }
    const session: Session = { id: randomUUID(), actor, send, close, mappings: new Map(), states: new Map() }
    this.sessions.set(session.id, session); this.devices.set(key(actor), session)
    return session.id
  }
  async setBindings(connectionId: string, refs: TunnelBindingRef[]): Promise<TunnelBindingRef[]> {
    const session = this.sessions.get(connectionId)
    if (!session) throw new TunnelTransportError("TUNNEL_OFFLINE")
    const wanted = new Map(refs.map(ref => [ref.id, ref.revision]))
    // Each in-flight snapshot carries monotonic invalidation flags, bounded by its <=100 requested IDs.
    const read = { ids: new Set(wanted.keys()), invalidated: new Set<string>() }
    this.bindingReads.add(read)
    try {
      const page = await this.service.list(session.actor.userId, { clientInstanceId: session.actor.clientInstanceId, limit: 100 })
      if (this.sessions.get(connectionId) !== session) throw new TunnelTransportError("TUNNEL_OFFLINE")
      const accepted = page.items.filter(row => row.enabled && wanted.get(row.id) === row.revision && !read.invalidated.has(row.id))
      const current = new Map(accepted.map(row => [row.id, row]))
      for (const [id, old] of session.mappings) if (current.get(id)?.revision !== old.revision) this.invalidateMapping(id)
      session.mappings = current
      for (const row of accepted) this.mappingSessions.set(row.id, session)
      return accepted.map(row => ({ id: row.id, revision: row.revision }))
    } finally { this.bindingReads.delete(read) }
  }
  setState(connectionId: string, id: string, revision: number, status: TunnelRuntimeStatus): void {
    const session = this.sessions.get(connectionId)
    if (session?.mappings.get(id)?.revision === revision && ["running", "local-unavailable", "authorization-required"].includes(status)) session.states.set(id, status)
  }
  open(mappingId: string, revision: number, signal: AbortSignal): Promise<Duplex> {
    const session = this.mappingSessions.get(mappingId), mapping = session?.mappings.get(mappingId)
    if (!session || !mapping || mapping.revision !== revision || signal.aborted) return Promise.reject(new TunnelTransportError("TUNNEL_OFFLINE"))
    let lease: { release(): void }
    try { lease = this.budget.acquire({ userId: session.actor.userId, mappingId }) } catch (error) { return Promise.reject(error) }
    const ticket = randomBytes(32).toString("base64url"), id = randomUUID()
    return new Promise<Duplex>((resolve, reject) => {
      const cancel = () => this.fail(id, new TunnelTransportError("TUNNEL_CANCELLED"))
      const timer = setTimeout(() => this.fail(id, new TunnelTransportError("TUNNEL_CONNECT_TIMEOUT", 504)), TUNNEL_LIMITS.ticketTtlMs)
      timer.unref()
      const flow: Flow = { id, mappingId, revision, session, hash: digest(ticket), expires: this.now() + TUNNEL_LIMITS.ticketTtlMs,
        timer, release: lease.release, resolve, reject, settled: false,
        cleanup: () => { clearTimeout(timer); signal.removeEventListener("abort", cancel); lease.release(); this.tickets.delete(flow.hash); this.flows.delete(id) },
      }
      this.flows.set(id, flow); this.tickets.set(flow.hash, flow)
      signal.addEventListener("abort", cancel, { once: true })
      try { session.send({ version: 1, type: "open", requestId: id, ticket, mapping: { id: mappingId, port: mapping.port, revision } }) }
      catch { this.fail(id, new TunnelTransportError("TUNNEL_OFFLINE")) }
    })
  }
  claim(userId: string, requestId: string, ticket: string, cancelSocket: () => void): { accept(stream: Duplex): void; fail(code: string): void } {
    const hash = digest(ticket), flow = this.tickets.get(hash)
    if (!flow || flow.id !== requestId || flow.session.actor.userId !== userId) throw new TunnelTransportError("TUNNEL_TICKET_INVALID", 401)
    if (flow.expires <= this.now() || this.sessions.get(flow.session.id) !== flow.session || flow.session.mappings.get(flow.mappingId)?.revision !== flow.revision) {
      this.fail(flow.id, new TunnelTransportError("TUNNEL_TICKET_EXPIRED", 504))
      throw new TunnelTransportError("TUNNEL_TICKET_EXPIRED", 401)
    }
    this.tickets.delete(hash); flow.cancelSocket = cancelSocket
    return {
      accept: stream => {
        if (!this.flows.has(flow.id) || flow.settled) { stream.destroy(); throw new TunnelTransportError("TUNNEL_CANCELLED") }
        flow.settled = true; flow.stream = stream; clearTimeout(flow.timer)
        stream.once("close", flow.cleanup)
        // Errors belong to the proxy too; this listener guarantees cleanup even if it has not attached yet.
        stream.once("error", () => flow.cleanup())
        flow.resolve(stream)
      },
      fail: code => this.fail(flow.id, new TunnelTransportError(code === "TUNNEL_LOCAL_UNAVAILABLE" ? code : "TUNNEL_DATA_FAILED", 502)),
    }
  }
  private fail(id: string, error: Error): void {
    const flow = this.flows.get(id)
    if (!flow) return
    flow.cleanup()
    if (!flow.settled) { flow.settled = true; flow.reject(error) }
    flow.stream?.destroy(error)
    flow.cancelSocket?.()
    if (this.sessions.has(flow.session.id)) {
      try { flow.session.send({ version: 1, type: "cancel", requestId: id }) } catch { flow.session.close() }
    }
  }
  invalidateMapping(id: string): void {
    for (const read of this.bindingReads) if (read.ids.has(id)) read.invalidated.add(id)
    const session = this.mappingSessions.get(id)
    this.mappingSessions.delete(id); session?.mappings.delete(id); session?.states.delete(id)
    for (const flow of this.flows.values()) if (flow.mappingId === id) this.fail(flow.id, new TunnelTransportError("TUNNEL_MAPPING_CHANGED"))
  }
  disconnect(connectionId: string): void {
    const session = this.sessions.get(connectionId)
    if (!session) return
    this.sessions.delete(connectionId)
    if (this.devices.get(key(session.actor)) === session) this.devices.delete(key(session.actor))
    for (const id of [...session.mappings.keys()]) this.invalidateMapping(id)
    for (const flow of this.flows.values()) if (flow.session === session) this.fail(flow.id, new TunnelTransportError("TUNNEL_OFFLINE"))
  }
  disconnectDevice(userId: string, clientInstanceId: string): void { const session = this.devices.get(key({ userId, clientInstanceId })); if (session) { this.disconnect(session.id); session.close() } }
  async close(): Promise<void> { for (const session of [...this.sessions.values()]) { this.disconnect(session.id); session.close() } }
}
