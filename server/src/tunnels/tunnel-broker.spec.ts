import { PassThrough } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import type { TunnelControlMessage } from "@synapse/shared/tunnel-contracts"
import { TunnelBroker } from "./tunnel-broker"
import { TunnelService } from "./tunnel.service"
import { memoryTunnelRepository } from "./tunnel-test-fixture"

async function fixture() {
  const service = new TunnelService(memoryTunnelRepository(), { enabled: true, publicDomain: "tunnel.test", mappingsPerUser: 100 })
  const actor = { userId: "u", clientInstanceId: "d" }
  const mapping = await service.create(actor, { port: 3000, requestId: "00000000-0000-4000-8000-000000000001" })
  let now = 0
  const messages: TunnelControlMessage[] = []
  const broker = new TunnelBroker(service, { now: () => now })
  const connectionId = broker.register(actor, message => { messages.push(message) }, () => undefined)
  await broker.setBindings(connectionId, [{ id: mapping.id, revision: mapping.revision }])
  return { broker, service, actor, mapping, connectionId, messages, advance: (ms: number) => { now += ms } }
}
function openMessage(messages: TunnelControlMessage[]) {
  const message = messages.filter(m => m.type === "open").at(-1)
  if (!message || message.type !== "open") throw new Error("missing open")
  return message
}
describe("tunnel data tickets", () => {
  it("is one-use, owner-bound and invalidated on cancellation", async () => {
    const f = await fixture(), controller = new AbortController()
    const result = f.broker.open(f.mapping.id, 1, controller.signal)
    const msg = openMessage(f.messages)
    expect(() => f.broker.claim("other", msg.requestId, msg.ticket, () => undefined)).toThrow()
    const claim = f.broker.claim("u", msg.requestId, msg.ticket, () => undefined)
    expect(() => f.broker.claim("u", msg.requestId, msg.ticket, () => undefined)).toThrow()
    const stream = new PassThrough(); stream.on("error", () => undefined)
    claim.accept(stream)
    expect(await result).toBe(stream)
    controller.abort()
    expect(stream.destroyed).toBe(true)
    expect(f.broker.activeCount).toBe(0)
    await f.broker.close()
  })
  it("expires tickets and rejects old revisions and connection generations", async () => {
    const f = await fixture()
    const pending = f.broker.open(f.mapping.id, 1, new AbortController().signal)
    const rejected = expect(pending).rejects.toThrow()
    const msg = openMessage(f.messages)
    f.advance(10_001)
    expect(() => f.broker.claim("u", msg.requestId, msg.ticket, () => undefined)).toThrow()
    await rejected
    f.broker.register(f.actor, () => undefined, () => undefined)
    await expect(f.broker.open(f.mapping.id, 1, new AbortController().signal)).rejects.toThrow()
    await f.broker.close()
  })
  it("closes pending streams when a mapping is stopped", async () => {
    const f = await fixture()
    const pending = f.broker.open(f.mapping.id, 1, new AbortController().signal)
    const rejected = expect(pending).rejects.toThrow()
    await f.service.setEnabled(f.actor, f.mapping.id, { enabled: false, expectedRevision: 1 })
    await rejected
    expect(f.broker.activeCount).toBe(0)
    await f.broker.close()
  })
})

it.each(["stop", "delete", "port"])("does not reinstall a late binding snapshot after %s", async operation => {
  const f = await fixture(), snapshot = await f.service.list("u", { limit: 100 })
  let complete!: (page: typeof snapshot) => void
  vi.spyOn(f.service, "list").mockImplementationOnce(() => new Promise(done => { complete = done }))
  const pending = f.broker.setBindings(f.connectionId, [{ id: f.mapping.id, revision: 1 }])
  if (operation === "stop") await f.service.setEnabled(f.actor, f.mapping.id, { enabled: false, expectedRevision: 1 })
  else if (operation === "delete") await f.service.delete("u", f.mapping.id, { expectedRevision: 1 })
  else await f.service.update(f.actor, f.mapping.id, { port: 3001, expectedRevision: 1 })
  complete(snapshot)
  expect(await pending).toEqual([])
  const unexpected = f.broker.open(f.mapping.id, 1, new AbortController().signal)
  f.broker.close()
  await expect(unexpected).rejects.toThrow()
  expect(f.messages.filter(message => message.type === "open")).toEqual([])
})
