import { describe, expect, it } from "vitest"
import {
  createDomainEventPayloadSubscription,
  createRawPayloadSubscription,
} from "../preload-event-subscriptions"

type TestUnsubscribe = () => void
type TestSubscribe = (channel: string) => (listener: (payload: unknown) => void) => TestUnsubscribe

function createSubscribeRecorder() {
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  const subscribe: TestSubscribe = (channel) => (listener) => {
    const channelListeners = listeners.get(channel) ?? new Set()
    channelListeners.add(listener)
    listeners.set(channel, channelListeners)
    return () => {
      channelListeners.delete(listener)
    }
  }

  return {
    push(channel: string, payload: unknown) {
      for (const listener of listeners.get(channel) ?? []) {
        listener(payload)
      }
    },
    subscribe,
    subscriberCount(channel: string) {
      return listeners.get(channel)?.size ?? 0
    },
  }
}

describe("preload event subscriptions", () => {
  it("unwraps repository EventBus payloads from the domain channel", () => {
    const transport = createSubscribeRecorder()
    const onProgress = createDomainEventPayloadSubscription<{ repositoryUuid: string }>(
      transport.subscribe,
      "repository",
      "repository.progress",
    )
    const seen: Array<{ repositoryUuid: string }> = []

    const unsubscribe = onProgress((payload) => seen.push(payload))

    expect(transport.subscriberCount("synapse:events:repository")).toBe(1)

    transport.push("synapse:repository:progress", { repositoryUuid: "old-channel" })
    transport.push("synapse:events:repository", {
      domain: "repository",
      type: "repository.updated",
      payload: { repositoryUuid: "wrong-type" },
      timestamp: "2026-04-28T00:00:00.000Z",
    })
    transport.push("synapse:events:repository", {
      domain: "repository",
      type: "repository.progress",
      payload: { repositoryUuid: "repo-1" },
      timestamp: "2026-04-28T00:00:00.000Z",
    })

    expect(seen).toEqual([{ repositoryUuid: "repo-1" }])

    unsubscribe()
    expect(transport.subscriberCount("synapse:events:repository")).toBe(0)
  })

  it("unwraps data-store EventBus payloads from the domain channel", () => {
    const transport = createSubscribeRecorder()
    const onChanged = createDomainEventPayloadSubscription<{ table: string }>(
      transport.subscribe,
      "data-store",
      "data-store.changed",
    )
    const seen: Array<{ table: string }> = []

    onChanged((payload) => seen.push(payload))

    expect(transport.subscriberCount("synapse:events:data-store")).toBe(1)

    transport.push("synapse:data-store:changed", { table: "old-channel" })
    transport.push("synapse:events:data-store", {
      domain: "data-store",
      type: "data-store.changed",
      payload: { table: "notes" },
      timestamp: "2026-04-28T00:00:00.000Z",
    })

    expect(seen).toEqual([{ table: "notes" }])
  })

  it("passes raw event payloads through for direct channels", () => {
    const transport = createSubscribeRecorder()
    const onStateChanged = createRawPayloadSubscription<{ status: string }>(
      transport.subscribe,
      "synapse:update:state-changed",
    )
    const seen: Array<{ status: string }> = []

    onStateChanged((payload) => seen.push(payload))
    transport.push("synapse:update:state-changed", { status: "downloaded" })

    expect(seen).toEqual([{ status: "downloaded" }])
  })
})
