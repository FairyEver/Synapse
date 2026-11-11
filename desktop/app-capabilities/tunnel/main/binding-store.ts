import { createHash, randomBytes, randomUUID } from "node:crypto"
import type { TunnelMappingDto } from "@synapse/shared/tunnel-contracts"
import type { DataNamespace } from "../../../electron/runtime/data-repo/types"
import type { TunnelBindingRecord, TunnelCredentialRecord } from "../../../electron/runtime/data-repo/schemas/tunnel"
import { InvalidNamespaceDataError } from "../../../electron/runtime/data-repo/errors"
export interface TunnelScope { ownerId: string; apiOrigin: string; clientInstanceId: string }
const identity = (scope: TunnelScope) => createHash("sha256").update(JSON.stringify([scope.ownerId, scope.apiOrigin, scope.clientInstanceId])).digest("hex")
export class TunnelBindingStore {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly deps: {
    bindings: Pick<DataNamespace<TunnelBindingRecord>, "get" | "upsert" | "remove" | "listWindow">
    credentials: Pick<DataNamespace<TunnelCredentialRecord>, "get" | "upsert">
    onInvalidBinding?: () => void
  }) {}
  private serialize<T>(work: () => Promise<T>): Promise<T> { const result = this.queue.then(work); this.queue = result.then(() => undefined, () => undefined); return result }
  private async records(scope: TunnelScope, kind: TunnelBindingRecord["kind"]): Promise<TunnelBindingRecord[]> {
    if (!this.deps.bindings.listWindow) throw new Error("Tunnel bindings require bounded SQLite queries")
    const filter = { ...scope, kind }
    try { return (await this.deps.bindings.listWindow({ filter, limit: 100, orderBy: "id" })).map(row => row.value) }
    catch (error) {
      if (!(error instanceof InvalidNamespaceDataError)) throw error
      // An invalid row stays in DataRepository for diagnostics; read only this bounded scope one row at a time.
      const valid: TunnelBindingRecord[] = []
      for (let offset = 0; offset < 100; offset++) {
        try {
          const rows = await this.deps.bindings.listWindow({ filter, limit: 1, offset, orderBy: "id" })
          if (!rows.length) break
          valid.push(rows[0]!.value)
        } catch (failure) { if (!(failure instanceof InvalidNamespaceDataError)) throw failure; this.deps.onInvalidBinding?.() }
      }
      return valid
    }
  }
  getOrCreateDeviceKey(scope: TunnelScope): Promise<string> {
    return this.serialize(async () => {
      const id = identity(scope), saved = await this.deps.credentials.get(id)
      if (saved) return saved.key
      const key = randomBytes(32).toString("base64url")
      await this.deps.credentials.upsert({ id, schemaVersion: 1, ...scope, key })
      return key
    })
  }
  async readDeviceKey(scope: TunnelScope): Promise<string | null> { return (await this.deps.credentials.get(identity(scope)))?.key ?? null }
  prepareCreate(scope: TunnelScope, port: number, requestId?: string): Promise<TunnelBindingRecord> {
    return this.serialize(async () => {
      const records = await this.records(scope, "pending-create")
      const pending = records.find(row => requestId ? row.requestId === requestId : row.port === port)
      if (pending) { if (pending.port !== port) throw new Error("TUNNEL_REQUEST_CONFLICT"); return pending }
      if (records.length >= 100) throw new Error("TUNNEL_PENDING_QUOTA")
      const request = requestId ?? randomUUID()
      const row: TunnelBindingRecord = { id: identity(scope) + ":op:" + request, schemaVersion: 1, ...scope, kind: "pending-create", mappingId: "", requestId: request, port, revision: 0, createdAt: new Date().toISOString() }
      await this.deps.bindings.upsert(row)
      return row
    })
  }
  async commitBinding(scope: TunnelScope, mapping: TunnelMappingDto, pending?: TunnelBindingRecord): Promise<void> {
    await this.deps.bindings.upsert({ id: identity(scope) + ":" + mapping.id, schemaVersion: 1, ...scope, kind: "binding", mappingId: mapping.id,
      requestId: "", port: mapping.port, revision: mapping.revision, createdAt: mapping.createdAt })
    if (pending) await this.deps.bindings.remove(pending.id)
  }
  async discardPending(scope: TunnelScope, requestId: string): Promise<void> { await this.deps.bindings.remove(identity(scope) + ":op:" + requestId) }
  listOwnedBindings(scope: TunnelScope): Promise<TunnelBindingRecord[]> { return this.records(scope, "binding") }
  async remove(scope: TunnelScope, id: string): Promise<void> { await this.deps.bindings.remove(identity(scope) + ":" + id) }
}
