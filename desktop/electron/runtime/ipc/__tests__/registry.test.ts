import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  IpcChannelNotFoundError,
  IpcModuleAlreadyRegisteredError,
  IpcValidationError,
  IpcRegistryImpl,
  createInMemoryHarness,
  type IpcModule,
} from "../index"

const demoModule = (overrides: Partial<IpcModule> = {}): IpcModule => ({
  id: "demo",
  methods: {
    greet: {
      kind: "invoke",
      channel: "synapse:demo:greet",
      request: z.object({ name: z.string().min(1) }),
      response: z.string(),
      handler: (_ctx, req: unknown) => `hello, ${(req as { name: string }).name}`,
    },
  },
  events: {
    pinged: {
      kind: "event",
      channel: "synapse:demo:pinged",
      payload: z.object({ ts: z.string() }),
    },
  },
  ...overrides,
})

const ctx = {
  moduleId: "demo",
  resolve: <T,>(): T => {
    throw new Error("resolve unused in this test")
  },
}

describe("IpcRegistryImpl (T3.2)", () => {
  it("registers a module and dispatches invoke calls through the in-memory transport", async () => {
    const harness = createInMemoryHarness()
    harness.registry.register(demoModule(), ctx)
    const reply = await harness.invoke("synapse:demo:greet", { name: "world" })
    expect(reply).toBe("hello, world")
  })

  it("validates the request payload and returns IpcValidationError on bad input", async () => {
    const harness = createInMemoryHarness()
    harness.registry.register(demoModule(), ctx)
    await expect(harness.invoke("synapse:demo:greet", {})).rejects.toBeInstanceOf(
      IpcValidationError,
    )
    await expect(harness.invoke("synapse:demo:greet", { name: "" })).rejects.toBeInstanceOf(
      IpcValidationError,
    )
  })

  it("throws IpcChannelNotFoundError for unregistered channels", async () => {
    const harness = createInMemoryHarness()
    await expect(harness.invoke("synapse:ghost:method", {})).rejects.toBeInstanceOf(
      IpcChannelNotFoundError,
    )
  })

  it("rejects duplicate module registration", () => {
    const harness = createInMemoryHarness()
    harness.registry.register(demoModule(), ctx)
    expect(() => harness.registry.register(demoModule(), ctx)).toThrowError(
      IpcModuleAlreadyRegisteredError,
    )
  })

  it("rejects channel collisions across modules and rolls back partial installs", () => {
    const harness = createInMemoryHarness()
    harness.registry.register(demoModule(), ctx)
    expect(() =>
      harness.registry.register(
        demoModule({
          id: "other",
          methods: {
            shadow: {
              kind: "invoke",
              channel: "synapse:demo:greet", // collision
              request: z.object({}),
              response: z.string(),
              handler: () => "shadowed",
            },
          },
        }),
        { ...ctx, moduleId: "other" },
      ),
    ).toThrow(/already owned/)
    // The first registration must still work.
    expect(harness.registry.list().map((m) => m.moduleId)).toEqual(["demo"])
  })

  it("list() reports module + channels for invokes and events", () => {
    const harness = createInMemoryHarness()
    harness.registry.register(demoModule(), ctx)
    const summary = harness.registry.list()
    expect(summary).toHaveLength(1)
    expect(summary[0]?.moduleId).toBe("demo")
    expect([...(summary[0]?.channels ?? [])].sort()).toEqual([
      "synapse:demo:greet",
      "synapse:demo:pinged",
    ])
  })

  it("unregister() detaches handlers and frees the channel for re-registration", async () => {
    const harness = createInMemoryHarness()
    const result = harness.registry.register(demoModule(), ctx)
    result.unregister()
    expect(harness.registry.list()).toEqual([])
    await expect(harness.invoke("synapse:demo:greet", { name: "x" })).rejects.toBeInstanceOf(
      IpcChannelNotFoundError,
    )

    // Re-register a module on the same channel with a different handler.
    harness.registry.register(
      demoModule({
        methods: {
          greet: {
            kind: "invoke",
            channel: "synapse:demo:greet",
            request: z.object({ name: z.string() }),
            response: z.string(),
            handler: (_c, req: unknown) => `goodbye, ${(req as { name: string }).name}`,
          },
        },
      }),
      ctx,
    )
    const reply = await harness.invoke("synapse:demo:greet", { name: "x" })
    expect(reply).toBe("goodbye, x")
  })

  it("response schema mismatch throws IpcValidationError", async () => {
    const harness = createInMemoryHarness()
    harness.registry.register(
      {
        id: "buggy",
        methods: {
          twoStrings: {
            kind: "invoke",
            channel: "synapse:buggy:two-strings",
            request: z.object({}),
            response: z.string(),
            handler: () => 42 as unknown as string,
          },
        },
        events: {},
      },
      { ...ctx, moduleId: "buggy" },
    )
    await expect(harness.invoke("synapse:buggy:two-strings", {})).rejects.toBeInstanceOf(
      IpcValidationError,
    )
  })

  it("async handlers are awaited", async () => {
    const harness = createInMemoryHarness()
    harness.registry.register(
      {
        id: "async-demo",
        methods: {
          delay: {
            kind: "invoke",
            channel: "synapse:async-demo:delay",
            request: z.object({ ms: z.number().min(0).max(50) }),
            response: z.literal("done"),
            async handler(_c, req: unknown) {
              await new Promise((r) => setTimeout(r, (req as { ms: number }).ms))
              return "done" as const
            },
          },
        },
        events: {},
      },
      { ...ctx, moduleId: "async-demo" },
    )
    const t0 = Date.now()
    const out = await harness.invoke("synapse:async-demo:delay", { ms: 10 })
    expect(out).toBe("done")
    expect(Date.now() - t0).toBeGreaterThanOrEqual(8)
  })

  it("unregister() is idempotent — calling twice does not throw or re-detach", () => {
    const harness = createInMemoryHarness()
    const result = harness.registry.register(demoModule(), ctx)
    result.unregister()
    expect(() => result.unregister()).not.toThrow()
    expect(harness.registry.list()).toEqual([])
  })

  it("channel collision rolls back ALL partial installs and reports the count", () => {
    const harness = createInMemoryHarness()
    harness.registry.register(demoModule(), ctx)
    try {
      harness.registry.register(
        {
          id: "second",
          methods: {
            okay: {
              kind: "invoke",
              channel: "synapse:second:okay",
              request: z.object({}),
              response: z.string(),
              handler: () => "ok",
            },
            collide: {
              kind: "invoke",
              channel: "synapse:demo:greet", // collision after `okay` was installed
              request: z.object({}),
              response: z.string(),
              handler: () => "shadow",
            },
          },
          events: {},
        },
        { ...ctx, moduleId: "second" },
      )
      throw new Error("expected to throw")
    } catch (err) {
      const e = err as { code: string; details?: { rolledBackCount?: number } }
      expect(e.code).toBe("ipc/channel-collision")
      expect(e.details?.rolledBackCount).toBe(1)
    }
    // First install survives, second module never registered, channel "okay"
    // freed by the rollback.
    expect(harness.registry.list().map((m) => m.moduleId)).toEqual(["demo"])
  })

  it("rolls back partial installs when the transport install throws", () => {
    const handlers = new Map<string, (request: unknown) => Promise<unknown>>()
    const disposedChannels: string[] = []
    const registry = new IpcRegistryImpl({
      install(channel, invoker) {
        if (channel === "synapse:partial:fail") {
          throw new Error("transport install failed")
        }
        handlers.set(channel, invoker)
        return () => {
          disposedChannels.push(channel)
          handlers.delete(channel)
        }
      },
    })

    expect(() =>
      registry.register(
        {
          id: "partial",
          methods: {
            first: {
              kind: "invoke",
              channel: "synapse:partial:first",
              request: z.object({}),
              response: z.string(),
              handler: () => "first",
            },
            fail: {
              kind: "invoke",
              channel: "synapse:partial:fail",
              request: z.object({}),
              response: z.string(),
              handler: () => "fail",
            },
          },
          events: {},
        },
        { ...ctx, moduleId: "partial" },
      ),
    ).toThrow("transport install failed")

    expect(disposedChannels).toEqual(["synapse:partial:first"])
    expect(handlers.has("synapse:partial:first")).toBe(false)
    expect(registry.list()).toEqual([])

    expect(() =>
      registry.register(
        demoModule({
          id: "retry",
          methods: {
            first: {
              kind: "invoke",
              channel: "synapse:partial:first",
              request: z.object({}),
              response: z.string(),
              handler: () => "retry",
            },
          },
          events: {},
        }),
        { ...ctx, moduleId: "retry" },
      ),
    ).not.toThrow()
  })
})
