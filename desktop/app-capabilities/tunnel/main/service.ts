import type { TunnelDeleteInput, TunnelEnableInput, TunnelListInput, TunnelMappingDto, TunnelOpenMapping, TunnelPageDto, TunnelRuntimeStatus, TunnelUpdateInput } from "@synapse/shared/tunnel-contracts"
import type { PermissionGuard, AuditSink, PermissionAction } from "../../../electron/runtime/security"
import type { EventBus } from "../../../electron/runtime/event-bus/types"
import type { TunnelScope } from "./binding-store"
import { TunnelBindingStore } from "./binding-store"
import { TunnelAppError, TunnelCloudClient, type TunnelAccountClient } from "./cloud-client"
import { TunnelTransport, type TunnelTransportDeps, type TunnelTransportPort } from "./transport"
import { tunnelCreateSchema, tunnelDeleteSchema, tunnelEnableSchema, tunnelListSchema, tunnelUpdateSchema } from "../shared/schema"

export type TunnelCloudPort = Pick<TunnelCloudClient, "list" | "get" | "operation" | "register" | "create" | "update" | "setEnabled" | "delete" | "reset" | "dispose">
export interface TunnelAppDeps {
  account: TunnelAccountClient; store: TunnelBindingStore; deviceId(): Promise<string>
  permissionGuard: Pick<PermissionGuard, "check" | "onRevoked">; auditSink?: Pick<AuditSink, "record">; eventBus?: EventBus
  cloud?: TunnelCloudPort; createTransport?(deps: TunnelTransportDeps): TunnelTransportPort
  logger?: { warn(message: string, metadata: Record<string, unknown>): void }
}
export class TunnelAppService {
  private readonly cloud: TunnelCloudPort
  private readonly transport: TunnelTransportPort
  private readonly unsubscribe: (() => void)[] = []
  private readonly approved = new Map<string, TunnelMappingDto>()
  private readonly statuses = new Map<string, TunnelRuntimeStatus>()
  private generation = 0
  private disposed = false
  private started = false
  private interval?: NodeJS.Timeout
  private queue: Promise<unknown> = Promise.resolve()
  private syncQueue: Promise<unknown> = Promise.resolve()
  private transportScope = ""
  constructor(private readonly deps: TunnelAppDeps) {
    this.cloud = deps.cloud ?? new TunnelCloudClient(deps.account)
    this.transport = (deps.createTransport ?? (options => new TunnelTransport(options)))({
      getAuth: () => this.auth(), authorizeCloud: () => this.permission("network.connect", "synapse-tunnel"),
      authorize: mapping => this.authorizeMapping(mapping),
      onStatus: (id, status) => { this.statuses.set(id, status); this.changed(id) },
      onFailure: code => deps.logger?.warn("穿透连接失败", { code }),
    })
    this.unsubscribe.push(deps.account.onBeforeIdentityChange(async () => {
      this.generation++; this.transportScope = ""; this.approved.clear(); this.statuses.clear(); this.cloud.reset()
      await this.transport.stop(); this.changed()
    }))
    let signature = ""
    this.unsubscribe.push(deps.account.onStateChanged(state => {
      const next = state.status === "authenticated" ? `${state.profile.user.id}:${state.connectivity}` : state.status
      if (next !== signature) { signature = next; if (this.started) void this.sync().catch(error => this.logFailure(error)) }
    }))
    const revoked = deps.permissionGuard.onRevoked?.(() => { for (const id of this.approved.keys()) this.statuses.set(id, "authorization-required"); this.approved.clear(); this.transportScope = ""; void this.transport.stop(); this.changed() })
    if (revoked) this.unsubscribe.push(revoked)
  }
  private changed(id?: string): void { this.deps.eventBus?.emit({ domain: "account", type: id ? "tunnel.mapping.changed" : "tunnel.reset", payload: id ? { id } : {}, timestamp: new Date().toISOString() }) }
  private logFailure(error: unknown): void { this.deps.logger?.warn("穿透状态恢复失败", { code: error instanceof TunnelAppError ? error.code : "TUNNEL_RECOVERY_FAILED" }) }
  private async scope(): Promise<TunnelScope> {
    const state = this.deps.account.getState(), generation = this.generation
    if (this.disposed || state.status !== "authenticated") throw new TunnelAppError(401, "TUNNEL_AUTH_REQUIRED", "请先登录")
    const scope = { ownerId: state.profile.user.id, apiOrigin: new URL(this.deps.account.getApiBaseUrlForLive()).origin, clientInstanceId: await this.deps.deviceId() }
    this.current(generation, scope)
    return scope
  }
  private current(generation: number, scope: TunnelScope): void {
    const state = this.deps.account.getState()
    if (this.disposed || generation !== this.generation || state.status !== "authenticated" || state.profile.user.id !== scope.ownerId
      || new URL(this.deps.account.getApiBaseUrlForLive()).origin !== scope.apiOrigin) throw new TunnelAppError(0, "TUNNEL_IDENTITY_CHANGED", "账号已变更")
  }
  private async permission(action: PermissionAction, resource: string, context: Record<string, unknown> = {}): Promise<boolean> {
    const actor = { kind: "user" as const, id: "tunnel-app" }
    const result = await this.deps.permissionGuard.check({ action, actor, resource, context })
    this.deps.auditSink?.record({ action, actor, resource, outcome: result.allowed ? "allowed" : "denied", metadata: context })
    return result.allowed
  }
  private async requirePermission(action: PermissionAction, resource: string, context: Record<string, unknown> = {}): Promise<void> {
    if (!await this.permission(action, resource, context)) throw new TunnelAppError(403, "TUNNEL_PERMISSION_DENIED", "未获得端口访问权限")
  }
  private async proof(scope: TunnelScope) {
    const generation = this.generation
    await this.requirePermission("secret.read", "synapse-tunnel-device")
    let key = await this.deps.store.readDeviceKey(scope)
    if (!key) { await this.requirePermission("secret.write", "synapse-tunnel-device"); key = await this.deps.store.getOrCreateDeviceKey(scope) }
    this.current(generation, scope)
    return { clientInstanceId: scope.clientInstanceId, key }
  }
  private async authorizeMapping(mapping: TunnelOpenMapping): Promise<boolean> {
    const approved = this.approved.get(mapping.id), generation = this.generation
    if (!approved || approved.revision !== mapping.revision || approved.port !== mapping.port || !approved.enabled || this.disposed) return false
    const allowed = await this.permission("network.connect", `http://localhost:${mapping.port}`, { mappingId: mapping.id, revision: mapping.revision })
    return allowed && generation === this.generation && this.approved.get(mapping.id) === approved
  }
  private async auth(): Promise<{ token: string; apiBaseUrl: string }> {
    const scope = await this.scope(), generation = this.generation
    let token = this.deps.account.getAccessTokenForLive()
    let nearExpiry = !token
    if (token) {
      try { const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString()); nearExpiry = typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now() + 45000 }
      catch { nearExpiry = true }
    }
    if (nearExpiry) { await this.deps.account.refreshFromStorage({ reason: "live-auth-failure" }); token = this.deps.account.getAccessTokenForLive() }
    this.current(generation, scope)
    if (!token) throw new TunnelAppError(401, "TUNNEL_AUTH_REQUIRED", "请先登录")
    return { token, apiBaseUrl: this.deps.account.getApiBaseUrlForLive() }
  }
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    this.interval = setInterval(() => { void this.sync().catch(error => this.logFailure(error)) }, 30000); this.interval.unref()
    await this.sync().catch(error => this.logFailure(error))
  }
  private sync(): Promise<void> {
    const next = this.syncQueue.then(() => this.synchronize())
    this.syncQueue = next.then(() => undefined, () => undefined)
    return next
  }
  private async synchronize(): Promise<void> {
    const scope = await this.scope(), generation = this.generation
    const bindings = await this.deps.store.listOwnedBindings(scope)
    this.current(generation, scope)
    if (!bindings.length) { this.transportScope = ""; this.approved.clear(); await this.transport.stop(); return }
    await this.requirePermission("network.connect", "synapse-tunnel")
    const page = await this.cloud.list({ clientInstanceId: scope.clientInstanceId, limit: 100 })
    this.current(generation, scope)
    const approved = page.items.filter(row => row.enabled && row.clientInstanceId === scope.clientInstanceId && bindings.some(binding => binding.mappingId === row.id && binding.port === row.port && binding.revision === row.revision))
    this.approved.clear(); for (const row of approved) this.approved.set(row.id, row)
    if (!approved.length) { this.transportScope = ""; await this.transport.stop(); return }
    const identity = JSON.stringify(scope)
    if (this.transportScope !== identity) {
      const proof = await this.proof(scope); await this.cloud.register(proof); this.current(generation, scope)
      await this.transport.start({ clientInstanceId: scope.clientInstanceId, deviceKey: proof.key }); this.current(generation, scope)
      this.transportScope = identity
    }
    await this.transport.reconcile(approved)
  }
  private serialized<T>(work: () => Promise<T>): Promise<T> { const next = this.queue.then(work); this.queue = next.then(() => undefined, () => undefined); return next }
  async list(raw: TunnelListInput = {}): Promise<TunnelPageDto & { currentClientInstanceId: string }> {
    const input = tunnelListSchema.parse(raw), scope = await this.scope(), generation = this.generation
    await this.requirePermission("network.connect", "synapse-tunnel")
    const page = await this.cloud.list(input); this.current(generation, scope)
    const bindings = await this.deps.store.listOwnedBindings(scope); this.current(generation, scope)
    return { ...page, currentClientInstanceId: scope.clientInstanceId, items: page.items.map(row => ({ ...row, runtimeStatus: !row.enabled ? "stopped" : row.clientInstanceId === scope.clientInstanceId
      ? bindings.some(binding => binding.mappingId === row.id && binding.port === row.port && binding.revision === row.revision) ? this.statuses.get(row.id) ?? row.runtimeStatus : "authorization-required" : row.runtimeStatus })) }
  }
  async get(id: string): Promise<TunnelMappingDto> { const scope = await this.scope(), generation = this.generation; await this.requirePermission("network.connect", "synapse-tunnel"); const row = await this.cloud.get(id); this.current(generation, scope); return row }
  create(raw: { port: number; requestId?: string }): Promise<TunnelMappingDto> {
    return this.serialized(async () => {
      const input = tunnelCreateSchema.parse(raw), scope = await this.scope(), generation = this.generation
      await this.requirePermission("network.connect", `http://localhost:${input.port}`)
      const pending = await this.deps.store.prepareCreate(scope, input.port, input.requestId), proof = await this.proof(scope)
      this.current(generation, scope); await this.cloud.register(proof); this.current(generation, scope)
      let row: TunnelMappingDto
      try { row = await this.cloud.operation(pending.requestId) }
      catch (error) { if ((error as { status?: number }).status !== 404) throw error; row = await this.cloud.create({ port: input.port, requestId: pending.requestId }, proof) }
      this.current(generation, scope)
      if (row.clientInstanceId !== scope.clientInstanceId || row.port !== input.port) throw new TunnelAppError(409, "TUNNEL_BINDING_CONFLICT", "映射信息不一致")
      await this.deps.store.commitBinding(scope, row, pending); this.current(generation, scope)
      await this.sync().catch(error => this.logFailure(error)); this.changed(row.id)
      return row
    })
  }
  update(id: string, input: TunnelUpdateInput): Promise<TunnelMappingDto> { const parsed = tunnelUpdateSchema.parse({ id, ...input }); return this.mutate(parsed.id, input, "update") }
  setEnabled(id: string, input: TunnelEnableInput): Promise<TunnelMappingDto> { const parsed = tunnelEnableSchema.parse({ id, ...input }); return this.mutate(parsed.id, input, "setEnabled") }
  private mutate(id: string, input: TunnelUpdateInput | TunnelEnableInput, operation: "update" | "setEnabled"): Promise<TunnelMappingDto> {
    return this.serialized(async () => {
      const scope = await this.scope(), generation = this.generation, current = await this.get(id)
      if (current.clientInstanceId !== scope.clientInstanceId) throw new TunnelAppError(403, "TUNNEL_OTHER_DEVICE", "请在所属电脑操作")
      const port = "port" in input ? input.port : current.port
      await this.requirePermission("network.connect", `http://localhost:${port}`)
      const proof = await this.proof(scope); this.current(generation, scope)
      const row = operation === "update" ? await this.cloud.update(id, input as TunnelUpdateInput, proof) : await this.cloud.setEnabled(id, input as TunnelEnableInput, proof)
      this.current(generation, scope); this.approved.delete(id); this.statuses.delete(id)
      await this.transport.reconcile([...this.approved.values()])
      await this.deps.store.commitBinding(scope, row); this.current(generation, scope)
      await this.sync().catch(error => this.logFailure(error)); this.changed(id); return row
    })
  }
  delete(id: string, raw: TunnelDeleteInput): Promise<{ id: string; deleted: true }> {
    return this.serialized(async () => {
      tunnelDeleteSchema.parse({ id, ...raw })
      const scope = await this.scope(), generation = this.generation
      await this.requirePermission("network.connect", "synapse-tunnel")
      const result = await this.cloud.delete(id, raw); this.current(generation, scope)
      this.approved.delete(id); this.statuses.delete(id); await this.deps.store.remove(scope, id)
      await this.sync().catch(error => this.logFailure(error)); this.changed(id); return result
    })
  }
  async dispose(): Promise<void> {
    this.disposed = true; this.started = false; this.generation++; clearInterval(this.interval)
    this.unsubscribe.forEach(stop => stop()); this.approved.clear(); this.cloud.dispose(); await this.transport.stop()
  }
}
