import { describe, expect, it, vi } from "vitest"
import type { TunnelMappingDto } from "@synapse/shared/tunnel-contracts"
import { TunnelAppService } from "../service"
import { TunnelBindingStore } from "../binding-store"
import { fakeAccount, memoryNamespace } from "./fixtures"

function fixture() {
  const account = fakeAccount(), bindings = memoryNamespace(), credentials = memoryNamespace()
  const store = new TunnelBindingStore({ bindings, credentials })
  const rows = new Map<string, TunnelMappingDto>(), operations = new Map<string, TunnelMappingDto>()
  const cloud = { register: vi.fn(async () => undefined), dispose: vi.fn(), reset: vi.fn(),
    list: vi.fn(async () => ({ items: [...rows.values()], total: rows.size, nextOffset: null })),
    get: vi.fn(async (id: string) => rows.get(id)!),
    operation: vi.fn(async (id: string) => { if (!operations.has(id)) throw Object.assign(new Error("missing"), { status: 404 }); return operations.get(id)! }),
    create: vi.fn(async (input: { port: number; requestId: string }) => {
      const id = "m" + (rows.size + 1), now = new Date().toISOString()
      const row: TunnelMappingDto = { id, clientInstanceId: "d1", deviceName: "Mac", port: input.port, url: `https://${String(rows.size + 1).padStart(32, "0")}.tunnel.test`, enabled: true, revision: 1, createdAt: now, updatedAt: now, runtimeStatus: "offline", lastErrorCode: null }
      rows.set(id, row); operations.set(input.requestId, row); return row
    }), update: vi.fn(), setEnabled: vi.fn(), delete: vi.fn(),
  }
  const transports: { start: ReturnType<typeof vi.fn>; reconcile: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = []
  const make = () => new TunnelAppService({ account, store, cloud, deviceId: async () => "d1", permissionGuard: { check: vi.fn(async () => ({ allowed: true as const })) },
    createTransport: () => { const transport = { start: vi.fn(async () => undefined), reconcile: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) }; transports.push(transport); return transport } })
  return { account, cloud, make, rows, transports, store, scope: { ownerId: "u1", apiOrigin: "https://synapse.test", clientInstanceId: "d1" } }
}
describe("tunnel application recovery", () => {
  it("returns the allocated link if subsequent connection recovery fails", async () => {
    const f = fixture(), service = f.make()
    f.cloud.list.mockRejectedValueOnce(new Error("temporary outage"))
    const allocated = await service.create({ port: 3000 })
    expect(allocated.id).toBe("m1")
    expect((await f.store.listOwnedBindings(f.scope)).map(row => row.mappingId)).toEqual(["m1"])
    await service.dispose()
  })
  it("restores only explicitly authorized enabled mappings on the same device", async () => {
    const f = fixture(), first = f.make()
    const row = await first.create({ port: 3000 })
    await first.dispose()
    const stopped = { ...row, id: "stopped", enabled: false }
    f.rows.set(stopped.id, stopped); await f.store.commitBinding(f.scope, stopped)
    f.rows.set("unapproved", { ...row, id: "unapproved" })
    const restarted = f.make(); await restarted.start()
    expect(f.transports.at(-1)!.reconcile.mock.calls.at(-1)![0].map((m: TunnelMappingDto) => m.id)).toEqual([row.id])
    expect(f.cloud.create).toHaveBeenCalledTimes(1)
    await f.account.changeOwner("other")
    expect(f.transports.at(-1)!.stop).toHaveBeenCalled()
    await restarted.dispose()
  })
  it("recovers an uncertain create using the same receipt instead of allocating again", async () => {
    const f = fixture(), service = f.make(), original = f.cloud.create.getMockImplementation()!
    f.cloud.create.mockImplementationOnce(async input => { await original(input); throw new Error("response lost") })
    await expect(service.create({ port: 3000 })).rejects.toThrow()
    const recovered = await service.create({ port: 3000 })
    expect(recovered.id).toBe("m1"); expect(f.cloud.create).toHaveBeenCalledTimes(1)
    await service.dispose()
  })
})

it("drops a terminal retired receipt so a later explicit request can allocate a fresh link", async () => {
  const f = fixture(), service = f.make()
  f.cloud.operation.mockRejectedValueOnce(Object.assign(new Error("retired"), { status: 410 }))
  await expect(service.create({ port: 3000 })).rejects.toThrow("retired")
  await service.create({ port: 3000 })
  expect(f.cloud.operation.mock.calls[0]![0]).not.toBe(f.cloud.operation.mock.calls[1]![0])
  expect(f.cloud.create).toHaveBeenCalledTimes(1); await service.dispose()
})
it("recovers the original allocation after a local persistence failure", async () => {
  const f = fixture(), service = f.make()
  vi.spyOn(f.store, "commitBinding").mockRejectedValueOnce(new Error("disk"))
  await expect(service.create({ port: 3000 })).rejects.toThrow("disk")
  expect((await service.create({ port: 3000 })).id).toBe("m1")
  expect(f.cloud.create).toHaveBeenCalledTimes(1); await service.dispose()
})
