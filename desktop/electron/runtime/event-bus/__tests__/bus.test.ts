import { describe, expect, it, vi } from "vitest"
import {
  EventBusImpl,
  WindowBroadcaster,
  channelForDomain,
  createEventBus,
  type DomainEvent,
  type EventBroadcaster,
} from "../index"

const eventOf = <D extends string, T extends string>(
  domain: D,
  type: T,
  payload: unknown = {},
  scope?: { projectId?: string; sessionId?: string; repositoryId?: string },
): DomainEvent => ({
  domain: domain as DomainEvent["domain"],
  type,
  payload,
  timestamp: new Date().toISOString(),
  scope,
})

describe("EventBusImpl core (T4.1)", () => {
  it("on(domain) receives every event in that domain regardless of type", () => {
    const bus = createEventBus({ defaultBackpressure: "drop-newest" })
    const seen: string[] = []
    bus.on("repository", (e) => seen.push(e.type))
    bus.emit(eventOf("repository", "updated"))
    bus.emit(eventOf("repository", "progress"))
    bus.emit(eventOf("update", "state-changed"))
    bus.flushAllForTests()
    expect(seen).toEqual(["updated", "progress"])
  })

  it("onType(domain, type) only fires for the matching type", () => {
    const bus = createEventBus({ defaultBackpressure: "drop-newest" })
    const seen: string[] = []
    bus.onType("repository", "updated", () => seen.push("updated"))
    bus.emit(eventOf("repository", "updated"))
    bus.emit(eventOf("repository", "progress"))
    bus.flushAllForTests()
    expect(seen).toEqual(["updated"])
  })

  it("emitInternal does not reach the broadcaster", () => {
    const broadcaster: EventBroadcaster = {
      broadcast: vi.fn().mockReturnValue(0),
    }
    const bus = new EventBusImpl({ broadcaster })
    bus.emitInternal(eventOf("repository", "updated"))
    expect(broadcaster.broadcast).not.toHaveBeenCalled()
  })

  it("emit (non-coalesce policy) reaches the broadcaster on the right channel", () => {
    const broadcasted: Array<{ channel: string; event: DomainEvent }> = []
    const broadcaster: EventBroadcaster = {
      broadcast: (event, channel) => {
        broadcasted.push({ channel, event })
        return 1
      },
    }
    const bus = new EventBusImpl({ broadcaster, defaultBackpressure: "drop-newest" })
    const event = eventOf("repository", "updated", { ok: true })
    bus.emit(event)
    bus.flushAllForTests()
    expect(broadcasted).toHaveLength(1)
    expect(broadcasted[0]?.channel).toBe(channelForDomain("repository"))
    expect(broadcasted[0]?.event.payload).toEqual({ ok: true })
  })

  it("listener exceptions do not affect siblings", () => {
    const bus = createEventBus({ defaultBackpressure: "drop-newest" })
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const seen: string[] = []
    bus.on("repository", () => {
      throw new Error("boom")
    })
    bus.on("repository", (e) => seen.push(e.type))
    bus.emit(eventOf("repository", "updated"))
    bus.flushAllForTests()
    expect(seen).toEqual(["updated"])
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it("unsubscribe stops further notifications", () => {
    const bus = createEventBus({ defaultBackpressure: "drop-newest" })
    const seen: string[] = []
    const unsub = bus.on("repository", (e) => seen.push(e.type))
    bus.emit(eventOf("repository", "updated"))
    bus.flushAllForTests()
    unsub()
    bus.emit(eventOf("repository", "updated"))
    bus.flushAllForTests()
    expect(seen).toEqual(["updated"])
  })

  it("drop-newest drops new events after the queue cap", () => {
    const bus = createEventBus({ defaultBackpressure: "drop-newest" })
    const seen: number[] = []
    bus.on("repository", (e) => seen.push((e.payload as { v: number }).v))
    bus.emit(eventOf("repository", "progress", { v: 1 }), { maxQueueSize: 2 })
    bus.emit(eventOf("repository", "progress", { v: 2 }), { maxQueueSize: 2 })
    bus.emit(eventOf("repository", "progress", { v: 3 }), { maxQueueSize: 2 })
    bus.flushAllForTests()
    expect(seen).toEqual([1, 2])
  })

  it("drop-oldest keeps the newest events when the queue is full", () => {
    const bus = createEventBus({ defaultBackpressure: "drop-oldest" })
    const seen: number[] = []
    bus.on("repository", (e) => seen.push((e.payload as { v: number }).v))
    bus.emit(eventOf("repository", "progress", { v: 1 }), { maxQueueSize: 2 })
    bus.emit(eventOf("repository", "progress", { v: 2 }), { maxQueueSize: 2 })
    bus.emit(eventOf("repository", "progress", { v: 3 }), { maxQueueSize: 2 })
    bus.flushAllForTests()
    expect(seen).toEqual([2, 3])
  })

  it("block preserves events by draining the oldest event when the queue is full", () => {
    const bus = createEventBus({ defaultBackpressure: "block" })
    const seen: number[] = []
    bus.on("repository", (e) => seen.push((e.payload as { v: number }).v))
    bus.emit(eventOf("repository", "progress", { v: 1 }), { maxQueueSize: 2 })
    bus.emit(eventOf("repository", "progress", { v: 2 }), { maxQueueSize: 2 })
    bus.emit(eventOf("repository", "progress", { v: 3 }), { maxQueueSize: 2 })
    expect(seen).toEqual([1])
    bus.flushAllForTests()
    expect(seen).toEqual([1, 2, 3])
  })

  it("coalesce backpressure folds rapid emits into a single dispatch", async () => {
    const bus = createEventBus({ defaultBackpressure: "coalesce" })
    const seen: number[] = []
    bus.on("repository", (e) => seen.push((e.payload as { v: number }).v))
    bus.emit(eventOf("repository", "progress", { v: 1 }), { coalesceWindowMs: 5 })
    bus.emit(eventOf("repository", "progress", { v: 2 }), { coalesceWindowMs: 5 })
    bus.emit(eventOf("repository", "progress", { v: 3 }), { coalesceWindowMs: 5 })
    await new Promise((r) => setTimeout(r, 25))
    expect(seen).toEqual([3])
  })

  it("coalesce keys split by (domain, type, scope)", async () => {
    const bus = createEventBus({ defaultBackpressure: "coalesce" })
    const seen: string[] = []
    bus.on("agent", (e) => seen.push(`${(e.payload as { v: number }).v}@${e.scope?.projectId ?? ""}`))
    bus.emit(eventOf("agent", "message.delta", { v: 1 }, { projectId: "p1" }), { coalesceWindowMs: 5 })
    bus.emit(eventOf("agent", "message.delta", { v: 2 }, { projectId: "p1" }), { coalesceWindowMs: 5 })
    bus.emit(eventOf("agent", "message.delta", { v: 3 }, { projectId: "p2" }), { coalesceWindowMs: 5 })
    await new Promise((r) => setTimeout(r, 25))
    expect(seen.sort()).toEqual(["2@p1", "3@p2"])
  })

  it("flushAllForTests forces pending coalesced events out synchronously", () => {
    const bus = new EventBusImpl({ defaultBackpressure: "coalesce" })
    const seen: number[] = []
    bus.on("repository", (e) => seen.push((e.payload as { v: number }).v))
    bus.emit(eventOf("repository", "progress", { v: 1 }), { coalesceWindowMs: 1000 })
    bus.flushAllForTests()
    expect(seen).toEqual([1])
  })

  it("channelForDomain composes the documented channel name", () => {
    expect(channelForDomain("repository")).toBe("synapse:app:events:operation:repository")
    expect(channelForDomain("agent")).toBe("synapse:app:events:operation:agent")
  })
})

describe("WindowBroadcaster (T4.2)", () => {
  it("broadcasts events to every alive window through WindowManager.broadcast", () => {
    const bus = createEventBus()
    const managerLog: Array<{ channel: string; payload: unknown }> = []
    const fakeManager = {
      broadcast: (channel: string, payload: unknown) => {
        managerLog.push({ channel, payload })
        return 2
      },
      register: () => {},
      open: () => null as never,
      close: () => {},
      list: () => [],
    }
    const broadcaster = new WindowBroadcaster(fakeManager as unknown as Parameters<typeof WindowBroadcaster["prototype"]["broadcast"] extends (e: infer _E, c: string) => infer _R ? never : never>)
    void broadcaster
    const direct = new WindowBroadcaster(fakeManager as never)
    const event = eventOf("repository", "updated", { v: 1 })
    expect(direct.broadcast(event, "synapse:app:events:operation:repository")).toBe(2)
    expect(managerLog).toHaveLength(1)
    expect(managerLog[0]?.channel).toBe("synapse:app:events:operation:repository")
    expect((managerLog[0]?.payload as DomainEvent).domain).toBe("repository")
    bus.flushAllForTests()
  })
})
