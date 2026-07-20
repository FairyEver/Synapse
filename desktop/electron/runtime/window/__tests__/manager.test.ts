import { describe, expect, it, vi } from "vitest"
import { createWindowManager, type ManagedWindow } from "../index"

interface FakeWindow extends ManagedWindow {
  destroyed: boolean
  visible: boolean
  focused: boolean
  minimized: boolean
  sent: Array<{ channel: string; payload: unknown }>
}

const makeFakeWindow = (id: number): FakeWindow => {
  const win: FakeWindow = {
    id,
    role: "main",
    destroyed: false,
    visible: false,
    focused: false,
    minimized: false,
    sent: [],
    isDestroyed: () => win.destroyed,
    isVisible: () => win.visible,
    isMinimized: () => win.minimized,
    show: () => {
      win.visible = true
    },
    focus: () => {
      win.focused = true
    },
    restore: () => {
      win.minimized = false
      win.visible = true
    },
    send: (channel, payload) => {
      win.sent.push({ channel, payload })
    },
    close: () => {
      win.destroyed = true
      win.visible = false
    },
  }
  return win
}

describe("WindowManager (T3.12)", () => {
  it("register + open creates the window via the descriptor factory", () => {
    const manager = createWindowManager()
    const fake = makeFakeWindow(1)
    const factory = vi.fn(() => fake)
    manager.register({ id: "main", role: "main", create: factory })
    const opened = manager.open("main")
    expect(factory).toHaveBeenCalledOnce()
    expect(opened).toBe(fake)
  })

  it("open() reuses an existing alive window by default (and focuses it)", () => {
    const manager = createWindowManager()
    const first = makeFakeWindow(1)
    const second = makeFakeWindow(2)
    const factory = vi.fn(() => (factory.mock.calls.length === 1 ? first : second))
    manager.register({ id: "main", role: "main", create: factory })
    const a = manager.open("main")
    const b = manager.open("main")
    expect(a).toBe(b)
    expect(factory).toHaveBeenCalledOnce()
    expect(first.focused).toBe(true)
    expect(first.visible).toBe(true)
  })

  it("shouldReuse=false → manager closes the existing window and re-creates", () => {
    const manager = createWindowManager()
    const a = makeFakeWindow(1)
    const b = makeFakeWindow(2)
    let nth = 0
    manager.register({
      id: "detail",
      role: "detail",
      create: () => (++nth === 1 ? a : b),
      shouldReuse: () => false,
    })
    const first = manager.open("detail")
    const second = manager.open("detail")
    expect(a.destroyed).toBe(true)
    expect(first).toBe(a)
    expect(second).toBe(b)
  })

  it("close() destroys the live window handle and frees the slot", () => {
    const manager = createWindowManager()
    const fake = makeFakeWindow(1)
    manager.register({ id: "main", role: "main", create: () => fake })
    manager.open("main")
    manager.close("main")
    expect(fake.destroyed).toBe(true)
    expect(manager.list()).toEqual([])
  })

  it("list() returns descriptors only for alive windows with their webContentsId", () => {
    const manager = createWindowManager()
    const a = makeFakeWindow(1)
    const b = makeFakeWindow(2)
    manager.register({ id: "main", role: "main", create: () => a })
    manager.register({ id: "detail", role: "detail", create: () => b })
    manager.open("main")
    manager.open("detail")
    a.destroyed = true
    expect(manager.list()).toEqual([{ id: "detail", role: "detail", webContentsId: 2 }])
  })

  it("broadcast() pushes payload to all alive windows that match the filter", () => {
    const manager = createWindowManager()
    const a = makeFakeWindow(1)
    const b = makeFakeWindow(2)
    manager.register({ id: "main", role: "main", create: () => a })
    manager.register({ id: "detail", role: "detail", create: () => b })
    manager.open("main")
    manager.open("detail")
    const sent = manager.broadcast("synapse:app:test:operation", { v: 1 })
    expect(sent).toBe(2)
    expect(a.sent[0]).toEqual({ operationId: "app.test.operation", payload: { v: 1 } })
    expect(b.sent[0]).toEqual({ operationId: "app.test.operation", payload: { v: 1 } })
  })

  it("broadcast() reaches an externally attached main window", () => {
    const manager = createWindowManager()
    const main = makeFakeWindow(1)
    manager.attach({ id: "main", role: "main" }, main)
    const sent = manager.broadcast("synapse:app:test:operation", { v: 1 })
    expect(sent).toBe(1)
    expect(main.sent[0]).toEqual({ operationId: "app.test.operation", payload: { v: 1 } })
  })

  it("detach() drops an attached handle without closing it", () => {
    const manager = createWindowManager()
    const detail = makeFakeWindow(1)
    manager.attach({ id: "detail", role: "detail" }, detail)

    manager.detach("detail")

    expect(detail.destroyed).toBe(false)
    expect(manager.list()).toEqual([])
    expect(manager.broadcast("synapse:app:test:operation", { v: 1 })).toBe(0)
  })

  it("detach() releases attached dynamic descriptors from the broadcast table", () => {
    const manager = createWindowManager()
    const detail = makeFakeWindow(1)
    manager.attach({ id: "detail:1", role: "detail" }, detail)

    manager.detach("detail:1")

    manager.register({ id: "detail:1", role: "detail", create: () => makeFakeWindow(2) })
    expect(manager.list()).toEqual([])
  })

  it("detach() keeps registered descriptors reusable", () => {
    const manager = createWindowManager()
    const first = makeFakeWindow(1)
    const second = makeFakeWindow(2)
    const factory = vi.fn(() => (factory.mock.calls.length === 1 ? first : second))
    manager.register({ id: "detail", role: "detail", create: factory })
    manager.open("detail")

    manager.detach("detail")
    const reopened = manager.open("detail")

    expect(first.destroyed).toBe(false)
    expect(reopened).toBe(second)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it("broadcast() filter excludes destroyed windows automatically", () => {
    const manager = createWindowManager()
    const a = makeFakeWindow(1)
    const b = makeFakeWindow(2)
    manager.register({ id: "main", role: "main", create: () => a })
    manager.register({ id: "detail", role: "detail", create: () => b })
    manager.open("main")
    manager.open("detail")
    a.destroyed = true
    const sent = manager.broadcast("synapse:app:test:operation", { v: 1 })
    expect(sent).toBe(1)
    expect(a.sent).toHaveLength(0)
  })

  it("broadcast() filter parameter narrows recipients", () => {
    const manager = createWindowManager()
    const a = makeFakeWindow(1)
    const b = makeFakeWindow(2)
    manager.register({ id: "main", role: "main", create: () => a })
    manager.register({
      id: "detail",
      role: "detail",
      create: () => ({ ...b, role: "detail" } as ManagedWindow),
    })
    manager.open("main")
    manager.open("detail")
    const sent = manager.broadcast("synapse:app:test:operation", { v: 1 }, (w) => w.role === "main")
    expect(sent).toBe(1)
    expect(a.sent).toHaveLength(1)
    expect(b.sent).toHaveLength(0)
  })

  it("rejects duplicate descriptor ids", () => {
    const manager = createWindowManager()
    manager.register({ id: "main", role: "main", create: () => makeFakeWindow(1) })
    expect(() =>
      manager.register({ id: "main", role: "main", create: () => makeFakeWindow(2) }),
    ).toThrow(/already registered/)
  })

  it("open() throws on unknown id", () => {
    const manager = createWindowManager()
    expect(() => manager.open("ghost")).toThrow(/Unknown window id/)
  })
})
