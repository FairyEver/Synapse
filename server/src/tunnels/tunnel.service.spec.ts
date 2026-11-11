import { describe, expect, it } from "vitest"
import { TunnelService } from "./tunnel.service"
import { TunnelDeviceService } from "./tunnel-device.service"
import { memoryTunnelRepository } from "./tunnel-test-fixture"

function fixture(limit = 100) {
  const repository = memoryTunnelRepository()
  let nextLabel = 0
  const service = new TunnelService(repository, { enabled: true, publicDomain: "tunnel.test", mappingsPerUser: limit, label: () => (++nextLabel).toString(16).padStart(32, "0") })
  const devices = new TunnelDeviceService(repository)
  return { repository, service, devices, actor: { userId: "u1", clientInstanceId: "d1" } }
}
const input = (n = 1) => ({ port: 3000, requestId: `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}` })

describe("tunnel domain allocation", () => {
  it("allocates one durable address per request and allows independent links to the same port", async () => {
    const f = fixture()
    const a = await f.service.create(f.actor, input())
    expect(await f.service.create(f.actor, input())).toEqual(a)
    expect(a).toMatchObject({ enabled: true, port: 3000, runtimeStatus: "offline", revision: 1 })
    expect((await f.service.create(f.actor, input(2))).url).not.toBe(a.url)
    await expect(f.service.create(f.actor, { ...input(), port: 3001 })).rejects.toMatchObject({ status: 409 })
  })
  it("keeps labels retired and never resurrects a deleted create receipt", async () => {
    const f = fixture()
    const a = await f.service.create(f.actor, input())
    await f.service.delete("u1", a.id, { expectedRevision: 1 })
    await expect(f.service.create(f.actor, input())).rejects.toMatchObject({ status: 410 })
    expect((await f.service.list("u1", {})).total).toBe(0)
    expect(await f.service.findPublic(new URL(a.url).hostname.split(".")[0]!)).toMatchObject({ deletedAt: expect.any(Date) })
  })
  it("isolates owners and devices, enforces revision and the quota under concurrent creates", async () => {
    const f = fixture(1)
    const results = await Promise.allSettled([f.service.create(f.actor, input()), f.service.create(f.actor, input(2))])
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1)
    const a = (await f.service.list("u1", {})).items[0]!
    await expect(f.service.get("other", a.id)).rejects.toMatchObject({ status: 404 })
    await expect(f.service.update({ userId: "u1", clientInstanceId: "other" }, a.id, { port: 3001, expectedRevision: 1 })).rejects.toMatchObject({ status: 404 })
    const changed = await f.service.update(f.actor, a.id, { port: 3001, expectedRevision: 1 })
    expect(changed.url).toBe(a.url)
    expect(changed.revision).toBe(2)
    await expect(f.service.setEnabled(f.actor, a.id, { enabled: false, expectedRevision: 1 })).rejects.toMatchObject({ status: 409 })
  })
  it("does not silently replace an existing installation key", async () => {
    const f = fixture()
    await f.devices.register("u1", "d1", "a".repeat(43))
    await f.devices.register("u1", "d1", "a".repeat(43))
    expect(await f.devices.verify("u1", "d1", "a".repeat(43))).toEqual(f.actor)
    await expect(f.devices.register("u1", "d1", "b".repeat(43))).rejects.toMatchObject({ status: 409 })
    await expect(f.devices.verify("other", "d1", "a".repeat(43))).rejects.toMatchObject({ status: 401 })
  })
})
