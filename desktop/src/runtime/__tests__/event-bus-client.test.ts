import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  createEventBusClient,
  type EventBusTransport,
} from "../event-bus-client"
import type { DomainEvent, Unsubscribe } from "../../../electron/runtime/event-bus/types"

const rendererLogger = vi.hoisted(() => ({
  warn: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

const makeTransport = () => {
  const subs = new Map<string, Set<(event: DomainEvent) => void>>()
  const transport: EventBusTransport = {
    subscribe(channel, listener) {
      const set = subs.get(channel) ?? new Set()
      set.add(listener)
      subs.set(channel, set)
      const unsub: Unsubscribe = () => {
        set.delete(listener)
        if (set.size === 0) subs.delete(channel)
      }
      return unsub
    },
  }
  return {
    transport,
    push(channel: string, event: DomainEvent) {
      const set = subs.get(channel)
      if (!set) return
      for (const listener of [...set]) listener(event)
    },
    subscriberCount(channel: string) {
      return subs.get(channel)?.size ?? 0
    },
  }
}

const event = (
  type: string,
  payload: unknown = {},
  scope?: { projectId?: string; sessionId?: string; repositoryId?: string },
): DomainEvent => ({
  domain: "repository",
  type,
  payload,
  timestamp: "2026-04-25T00:00:00Z",
  scope,
})

describe("EventBusClient (T4.4)", () => {
  beforeEach(() => {
    rendererLogger.warn.mockClear()
  })

  it("on(domain) receives every event in the domain", () => {
    const t = makeTransport()
    const client = createEventBusClient(t.transport)
    const types: string[] = []
    client.on("repository", (e) => types.push(e.type))
    t.push("synapse:events:repository", event("updated"))
    t.push("synapse:events:repository", event("progress"))
    expect(types).toEqual(["updated", "progress"])
  })

  it("onType filters by event.type", () => {
    const t = makeTransport()
    const client = createEventBusClient(t.transport)
    const seen: string[] = []
    client.onType("repository", "updated", () => seen.push("updated"))
    t.push("synapse:events:repository", event("updated"))
    t.push("synapse:events:repository", event("progress"))
    expect(seen).toEqual(["updated"])
  })

  it("onScoped filters by scope keys", () => {
    const t = makeTransport()
    const client = createEventBusClient(t.transport)
    const seen: Array<string | undefined> = []
    client.onScoped("repository", { projectId: "p1" }, (e) => seen.push(e.scope?.projectId))
    t.push("synapse:events:repository", event("updated", {}, { projectId: "p1" }))
    t.push("synapse:events:repository", event("updated", {}, { projectId: "p2" }))
    t.push("synapse:events:repository", event("updated", {})) // no scope at all
    expect(seen).toEqual(["p1"])
  })

  it("transport subscribes once per domain regardless of listener count", () => {
    const t = makeTransport()
    const client = createEventBusClient(t.transport)
    const a = client.on("repository", () => {})
    const b = client.onType("repository", "updated", () => {})
    expect(t.subscriberCount("synapse:events:repository")).toBe(1)
    a()
    b()
    expect(t.subscriberCount("synapse:events:repository")).toBe(0)
  })

  it("listener errors do not poison siblings", () => {
    const t = makeTransport()
    const client = createEventBusClient(t.transport)
    const seen: string[] = []
    client.on("agent", () => {
      throw new Error("secret prompt detail")
    })
    client.on("agent", (e) => seen.push(e.type))
    t.push("synapse:events:agent", {
      domain: "agent",
      type: "stream",
      payload: {},
      timestamp: "2026-04-25T00:00:00Z",
      scope: { sessionId: "conversation-1" },
    })
    expect(seen).toEqual(["stream"])
    expect(rendererLogger.warn).toHaveBeenCalledWith("Renderer event listener failed.", {
      boundary: "renderer.event-bus.listener",
      domain: "agent",
      eventType: "stream",
      projectId: undefined,
      repositoryId: undefined,
      sessionId: "conversation-1",
      errorName: "Error",
      errorLength: "secret prompt detail".length,
    })
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("secret prompt detail")
  })

  it("unsubscribe inside a listener does not break the remaining dispatch", () => {
    const t = makeTransport()
    const client = createEventBusClient(t.transport)
    const seen: string[] = []
    const unsubA: Unsubscribe = client.on("repository", () => {
      seen.push("a")
      unsubA?.()
    })
    client.on("repository", () => seen.push("b"))
    t.push("synapse:events:repository", event("updated"))
    expect(seen).toEqual(["a", "b"])
  })
})
