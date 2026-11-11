import { describe, expect, it } from "vitest"
import { TunnelBindingStore } from "../binding-store"
import { tunnelSchemas } from "../../../../electron/runtime/data-repo/schemas/tunnel"
import { memoryNamespace } from "./fixtures"
import { InvalidNamespaceDataError } from "../../../../electron/runtime/data-repo/errors"
import { DataRepositoryImpl } from "../../../../electron/runtime/data-repo/repository"
import type { DataNamespace } from "../../../../electron/runtime/data-repo/types"
import type { TunnelBindingRecord, TunnelCredentialRecord } from "../../../../electron/runtime/data-repo/schemas/tunnel"
const scope = { ownerId: "u1", apiOrigin: "https://synapse.test", clientInstanceId: "d1" }
describe("device-local tunnel authorizations", () => {
  it("persists a stable key and pending request before allocating remotely", async () => {
    const bindings = memoryNamespace(), credentials = memoryNamespace()
    const store = new TunnelBindingStore({ bindings, credentials })
    const key = await store.getOrCreateDeviceKey(scope)
    const pending = await store.prepareCreate(scope, 3000)
    const restarted = new TunnelBindingStore({ bindings, credentials })
    expect(await restarted.getOrCreateDeviceKey(scope)).toBe(key)
    expect((await restarted.prepareCreate(scope, 3000)).requestId).toBe(pending.requestId)
    expect(await restarted.getOrCreateDeviceKey({ ...scope, ownerId: "other" })).not.toBe(key)
    expect(await restarted.listOwnedBindings({ ...scope, clientInstanceId: "other" })).toEqual([])
  })
  it("keeps both namespaces local-only and encrypts device keys", () => {
    expect(tunnelSchemas.map(s => s.transferPolicy)).toEqual(["local-only", "local-only"])
    expect(tunnelSchemas.find(s => s.name === "app.tunnel.credentials")).toMatchObject({ backend: "encrypted-json", encrypted: true })
  })
  it("excludes tunnel data even from secret-inclusive backups and rejects imported authorizations", async () => {
    const repo = new DataRepositoryImpl()
    repo.register(tunnelSchemas[0], memoryNamespace() as unknown as DataNamespace<TunnelBindingRecord>)
    repo.register(tunnelSchemas[1], memoryNamespace() as unknown as DataNamespace<TunnelCredentialRecord>)
    expect((await repo.exportAll({ includeSecrets: true })).namespaces).toEqual([])
    await expect(repo.importAll({ format: "synapse-backup-v1", exportedAt: new Date().toISOString(), namespaces: [{ name: "app.tunnel.bindings", schemaVersion: 1, encrypted: false, data: {} }] })).rejects.toThrow("local-only")
  })
  it("isolates an invalid local row without granting it or dropping other bindings", async () => {
    const bindings = memoryNamespace(), credentials = memoryNamespace()
    const valid = { id: "valid", mappingId: "m1", ...scope, kind: "binding", port: 3000, revision: 1 }
    bindings.listWindow = async (query: { limit: number; offset?: number }) => {
      if (query.limit > 1 || query.offset === 1) throw new InvalidNamespaceDataError("app.tunnel.bindings", "row failed validate()")
      return query.offset === 0 ? [{ value: valid }] : []
    }
    let isolated = 0
    const store = new TunnelBindingStore({ bindings, credentials, onInvalidBinding: () => { isolated++ } })
    expect(await store.listOwnedBindings(scope)).toEqual([valid])
    expect(isolated).toBe(1)
  })
})
