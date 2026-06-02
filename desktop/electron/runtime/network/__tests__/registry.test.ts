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

  it("starts lifecycle on register and stops lifecycle on unregister", async () => {
    const stop = vi.fn()
    const start = vi.fn(() => ({ stop }))
    const reg = createNetworkServiceRegistry({ probePort: async () => true })

    const binding = await reg.register(desc({ id: "api", preferredPort: 50001, start }))
    expect(start).toHaveBeenCalledWith(binding)

    await reg.unregister("api")
    expect(stop).toHaveBeenCalledOnce()
  })

  it("releases allocation when lifecycle start fails", async () => {
    const reg = createNetworkServiceRegistry({ probePort: async () => true })

    await expect(
      reg.register(desc({
        id: "api",
        preferredPort: 50001,
        start: () => {
          throw new Error("start failed")
        },
      })),
    ).rejects.toThrow(/start failed/)

    await expect(reg.register(desc({ id: "api", preferredPort: 50001 }))).resolves.toEqual({
      id: "api",
      port: 50001,
      bindAddress: "127.0.0.1",
    })
  })

  it("retries the next available port when lifecycle start loses the listen race", async () => {
    const stop = vi.fn()
    const start = vi.fn((binding) => {
      if (binding.port === 50001) {
        const error = new Error("listen EADDRINUSE")
        ;(error as NodeJS.ErrnoException).code = "EADDRINUSE"
        throw error
      }
      return { stop }
    })
    const reg = createNetworkServiceRegistry({
      probePort: async () => true,
      conflictPolicy: "next-available",
      portRangeStart: 50001,
      portRangeEnd: 50003,
    })

    await expect(reg.register(desc({ id: "api", preferredPort: 50001, start }))).resolves.toEqual({
      id: "api",
      port: 50002,
      bindAddress: "127.0.0.1",
    })
    expect(start).toHaveBeenCalledTimes(2)
    expect(reg.list()).toEqual([{ id: "api", port: 50002, bindAddress: "127.0.0.1" }])
  })

  it("emits descriptor audit events for register/start/unregister/stop", async () => {
    const audit = vi.fn()
    const reg = createNetworkServiceRegistry({ probePort: async () => true })

    await reg.register(desc({
      id: "bridge",
      preferredPort: 50001,
      audit,
      start: () => ({ stop: vi.fn() }),
    }))
    await reg.unregister("bridge")

    expect(audit.mock.calls.map(([event]) => event.action)).toEqual([
      "registered",
      "started",
      "unregistered",
      "stopped",
    ])
    expect(audit.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        serviceId: "bridge",
        role: "http",
        binding: { id: "bridge", port: 50001, bindAddress: "127.0.0.1" },
      }),
    )
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
