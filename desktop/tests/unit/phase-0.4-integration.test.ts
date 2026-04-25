/**
 * Phase 0.4 — Integration test.
 *
 * SPEC §7 verification:
 *   - "两窗口，一个操作仓库另一个收到事件"
 *   - "agent scope 过滤只发匹配窗口"
 *
 * We bypass real Electron by registering fake ManagedWindow instances with
 * a real WindowManager + WindowBroadcaster + EventBusImpl.
 */

import { describe, expect, it } from "vitest"
import {
  EventBusImpl,
  WindowBroadcaster,
  channelForDomain,
  type DomainEvent,
} from "../../electron/runtime/event-bus"
import { createWindowManager, type ManagedWindow } from "../../electron/runtime/window"

const fakeWindow = (
  id: number,
  role: "main" | "detail" | "overlay" = "main",
): ManagedWindow & { sent: Array<{ channel: string; payload: unknown }> } => {
  const sent: Array<{ channel: string; payload: unknown }> = []
  return {
    id,
    role,
    isDestroyed: () => false,
    isVisible: () => true,
    show: () => {},
    focus: () => {},
    send: (channel, payload) => sent.push({ channel, payload }),
    close: () => {},
    sent,
  } as ManagedWindow & { sent: Array<{ channel: string; payload: unknown }> }
}

const event = (
  domain: DomainEvent["domain"],
  type: string,
  payload: unknown = {},
  scope?: { projectId?: string; sessionId?: string; repositoryId?: string },
): DomainEvent => ({
  domain,
  type,
  payload,
  timestamp: new Date().toISOString(),
  scope,
})

describe("Phase 0.4 EventBus integration (T4.8)", () => {
  it("emits cross both windows and routes through the right channel", () => {
    const manager = createWindowManager()
    const a = fakeWindow(1)
    const b = fakeWindow(2)
    manager.register({ id: "main", role: "main", create: () => a })
    manager.register({ id: "detail", role: "detail", create: () => b })
    manager.open("main")
    manager.open("detail")

    const bus = new EventBusImpl({
      broadcaster: new WindowBroadcaster(manager),
      defaultBackpressure: "drop-newest",
    })

    bus.emit(event("repository", "updated", { v: 1 }))
    expect(a.sent).toHaveLength(1)
    expect(b.sent).toHaveLength(1)
    expect(a.sent[0]?.channel).toBe(channelForDomain("repository"))
    expect((a.sent[0]?.payload as DomainEvent).type).toBe("updated")
  })

  it("scope filter narrows agent events to the matching window only", () => {
    const manager = createWindowManager()
    const proj1Window = fakeWindow(1)
    const proj2Window = fakeWindow(2)
    // Tag windows with their owning projectId (production wires this through
    // ProjectContainer in Phase 0.5; the integration here is enough to prove
    // the broadcaster's filter does fire).
    Object.defineProperty(proj1Window, "__projectId", { value: "p1" })
    Object.defineProperty(proj2Window, "__projectId", { value: "p2" })
    manager.register({ id: "main", role: "main", create: () => proj1Window })
    manager.register({ id: "detail", role: "detail", create: () => proj2Window })
    manager.open("main")
    manager.open("detail")

    const broadcaster = new WindowBroadcaster(manager, {
      filter: (event, win) => {
        if (event.domain !== "agent") return true
        const winProjectId = (win as unknown as { __projectId?: string }).__projectId
        if (!event.scope?.projectId || !winProjectId) return true
        return winProjectId === event.scope.projectId
      },
    })

    const bus = new EventBusImpl({
      broadcaster,
      defaultBackpressure: "drop-newest",
    })

    bus.emit(event("agent", "session.started", {}, { projectId: "p1" }))
    expect(proj1Window.sent).toHaveLength(1)
    expect(proj2Window.sent).toHaveLength(0)

    // Non-scoped event reaches both windows.
    bus.emit(event("repository", "updated"))
    expect(proj1Window.sent).toHaveLength(2)
    expect(proj2Window.sent).toHaveLength(1)
  })

  it("coalesce policy folds rapid agent.message.delta into a single emit per scope", async () => {
    const manager = createWindowManager()
    const win = fakeWindow(1)
    manager.register({ id: "main", role: "main", create: () => win })
    manager.open("main")

    const bus = new EventBusImpl({
      broadcaster: new WindowBroadcaster(manager),
      defaultBackpressure: "coalesce",
    })

    for (let i = 0; i < 10; i++) {
      bus.emit(event("agent", "message.delta", { tokens: i }, { sessionId: "s1" }), {
        coalesceWindowMs: 5,
      })
    }
    await new Promise((r) => setTimeout(r, 25))
    expect(win.sent).toHaveLength(1)
    const evt = win.sent[0]?.payload as DomainEvent
    expect((evt.payload as { tokens: number }).tokens).toBe(9)
  })
})
