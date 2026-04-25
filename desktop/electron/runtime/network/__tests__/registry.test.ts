import { describe, expect, it, vi } from "vitest"
import {
  createNetworkServiceRegistry,
  pickNextAvailablePort,
  type NetworkServiceDescriptor,
} from "../index"

const stubHandler = { handle: () => "ok" }

const desc = (overrides: Partial<NetworkServiceDescriptor> = {}): NetworkServiceDescriptor => ({
  id: "x",
  role: "http",
  handler: stubHandler,
  ...overrides,
})

describe("pickNextAvailablePort (T3.15)", () => {
  it("returns preferred when free", async () => {
    const result = await pickNextAvailablePort({
      from: 50000,
      to: 50100,
      preferred: 50050,
      taken: new Set(),
      probe: async () => true,
    })
    expect(result).toBe(50050)
  })

  it("falls through to next free port when preferred is busy", async () => {
    const result = await pickNextAvailablePort({
      from: 50000,
      to: 50010,
      preferred: 50000,
      taken: new Set(),
      probe: async (p) => p === 50007,
    })
    expect(result).toBe(50007)
  })

  it("respects the taken set", async () => {
    const result = await pickNextAvailablePort({
      from: 50000,
      to: 50010,
      taken: new Set([50000, 50001, 50002]),
      probe: async () => true,
    })
    expect(result).toBe(50003)
  })

  it("throws when no port is free in range", async () => {
    await expect(
      pickNextAvailablePort({
        from: 50000,
        to: 50002,
        taken: new Set(),
        probe: async () => false,
      }),
    ).rejects.toThrow(/No free port/)
  })
})

describe("NetworkServiceRegistry (T3.15)", () => {
  it("register binds preferred port when free + defaults bindAddress to 127.0.0.1", async () => {
    const probe = vi.fn(async () => true)
    const reg = createNetworkServiceRegistry({ probePort: probe, portRangeStart: 50000, portRangeEnd: 50050 })
    const onPortAssigned = vi.fn()
    const binding = await reg.register(
      desc({ id: "mcp-http", preferredPort: 50100, onPortAssigned }),
    )
    expect(binding).toEqual({ id: "mcp-http", port: 50100, bindAddress: "127.0.0.1" })
    expect(onPortAssigned).toHaveBeenCalledWith(50100)
  })

  it("rejects duplicate ids", async () => {
    const reg = createNetworkServiceRegistry({ probePort: async () => true })
    await reg.register(desc({ id: "a", preferredPort: 50000 }))
    await expect(reg.register(desc({ id: "a" }))).rejects.toThrow(/already registered/)
  })

  it("conflictPolicy=fail rejects when preferred is busy", async () => {
    const reg = createNetworkServiceRegistry({
      probePort: async () => false,
      conflictPolicy: "fail",
    })
    await expect(reg.register(desc({ preferredPort: 50000 }))).rejects.toThrow(/conflictPolicy is "fail"/)
  })

  it("conflictPolicy=next-available picks the next free port", async () => {
    const reg = createNetworkServiceRegistry({
      probePort: async (p) => p > 50050,
      conflictPolicy: "next-available",
      portRangeStart: 50000,
      portRangeEnd: 50100,
    })
    const binding = await reg.register(desc({ id: "x", preferredPort: 50000 }))
    expect(binding.port).toBeGreaterThan(50050)
  })

  it("list() reflects every active binding", async () => {
    const reg = createNetworkServiceRegistry({ probePort: async () => true })
    await reg.register(desc({ id: "a", preferredPort: 50001 }))
    await reg.register(desc({ id: "b", preferredPort: 50002 }))
    expect(reg.list().map((b) => b.id).sort()).toEqual(["a", "b"])
  })

  it("unregister() releases the slot for a future register call", async () => {
    const reg = createNetworkServiceRegistry({ probePort: async () => true })
    await reg.register(desc({ id: "a", preferredPort: 50001 }))
    await reg.unregister("a")
    expect(reg.list()).toEqual([])
    await expect(reg.register(desc({ id: "a", preferredPort: 50001 }))).resolves.toBeDefined()
  })

  it("explicit bindAddress is preserved (e.g. 0.0.0.0 for explicit external)", async () => {
    const reg = createNetworkServiceRegistry({ probePort: async () => true })
    const binding = await reg.register(
      desc({ id: "x", preferredPort: 50001, bindAddress: "0.0.0.0" }),
    )
    expect(binding.bindAddress).toBe("0.0.0.0")
  })

  it("two services in the same process do not collide on the same port", async () => {
    const reg = createNetworkServiceRegistry({ probePort: async () => true })
    const a = await reg.register(desc({ id: "a", preferredPort: 50001 }))
    // The second service requests the SAME port; allocator must NOT reuse it.
    const b = await reg.register(desc({ id: "b", preferredPort: 50001 }))
    expect(a.port).toBe(50001)
    expect(b.port).not.toBe(50001)
  })
})
