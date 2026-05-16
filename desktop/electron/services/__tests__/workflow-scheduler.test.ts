import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => "/tmp" } }))
vi.mock("../log-store", () => ({
  createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { ReactiveScheduler } from "../workflow/workflow-scheduler"
import type { NodeExecOutcome, SchedulerCallbacks } from "../workflow/workflow-scheduler"

function ok(nodeId: string, output = ""): NodeExecOutcome {
  return { nodeId, status: "success", output, durationMs: 1 }
}
function fail(nodeId: string): NodeExecOutcome {
  return { nodeId, status: "failed", error: "boom", durationMs: 1 }
}
function delayed<T>(ms: number, value: T): Promise<T> {
  return new Promise((r) => setTimeout(() => r(value), ms))
}

function makeCallbacks(
  edges: Array<{ from: string; to: string }>,
): SchedulerCallbacks & { readyOrder: string[] } {
  const readyOrder: string[] = []
  return {
    readyOrder,
    onNodeReady: (id) => { readyOrder.push(id) },
    onNodeDone: () => {},
    resolveActivatedDownstream: (nodeId) =>
      edges.filter((e) => e.from === nodeId).map((e) => e.to),
  }
}

describe("ReactiveScheduler", () => {
  it("runs a linear chain A→B→C in order", async () => {
    const edges = [{ from: "a", to: "b" }, { from: "b", to: "c" }]
    const cb = makeCallbacks(edges)
    const s = new ReactiveScheduler()
    const results = await s.execute(
      ["a", "b", "c"], edges,
      (id) => ({ nodeId: id, execute: () => Promise.resolve(ok(id)) }),
      cb, new AbortController().signal,
    )
    expect(cb.readyOrder).toEqual(["a", "b", "c"])
    expect(results.get("c")?.status).toBe("success")
  })

  it("starts parallel roots A,B simultaneously before C", async () => {
    const edges = [{ from: "a", to: "c" }, { from: "b", to: "c" }]
    const cb = makeCallbacks(edges)
    const s = new ReactiveScheduler()
    const results = await s.execute(
      ["a", "b", "c"], edges,
      (id) => ({ nodeId: id, execute: () => Promise.resolve(ok(id, id)) }),
      cb, new AbortController().signal,
    )
    // a and b should both start before c
    expect(cb.readyOrder.indexOf("a")).toBeLessThan(cb.readyOrder.indexOf("c"))
    expect(cb.readyOrder.indexOf("b")).toBeLessThan(cb.readyOrder.indexOf("c"))
    expect(results.get("c")?.status).toBe("success")
  })

  it("starts D immediately when A completes, without waiting for B (asymmetric)", async () => {
    // A→C, A→D, B→C — D only depends on A
    const edges = [
      { from: "a", to: "c" }, { from: "a", to: "d" }, { from: "b", to: "c" },
    ]
    const startTimes: Record<string, number> = {}
    const cb = makeCallbacks(edges)
    cb.onNodeReady = (id) => { cb.readyOrder.push(id); startTimes[id] = Date.now() }
    const s = new ReactiveScheduler()
    await s.execute(
      ["a", "b", "c", "d"], edges,
      (id) => ({
        nodeId: id,
        execute: () => {
          // B takes much longer than A
          if (id === "b") return delayed(50, ok(id))
          return Promise.resolve(ok(id))
        },
      }),
      cb, new AbortController().signal,
    )
    // D should start before B finishes (and before C)
    expect(cb.readyOrder.indexOf("d")).toBeLessThan(cb.readyOrder.indexOf("c"))
  })

  it("does not start downstream nodes after a failure", async () => {
    const edges = [{ from: "a", to: "c" }, { from: "b", to: "c" }]
    const cb = makeCallbacks(edges)
    const s = new ReactiveScheduler()
    const results = await s.execute(
      ["a", "b", "c"], edges,
      (id) => ({
        nodeId: id,
        execute: () => Promise.resolve(id === "b" ? fail(id) : ok(id)),
      }),
      cb, new AbortController().signal,
    )
    expect(cb.readyOrder).not.toContain("c")
    expect(results.get("c")?.error).toContain("upstream failed")
  })

  it("lets running nodes finish when one fails (no cancel)", async () => {
    // A(slow) and B(fast,fails) → C
    const edges = [{ from: "a", to: "c" }, { from: "b", to: "c" }]
    const cb = makeCallbacks(edges)
    const s = new ReactiveScheduler()
    const results = await s.execute(
      ["a", "b", "c"], edges,
      (id) => ({
        nodeId: id,
        execute: () => {
          if (id === "a") return delayed(30, ok(id))
          if (id === "b") return Promise.resolve(fail(id))
          return Promise.resolve(ok(id))
        },
      }),
      cb, new AbortController().signal,
    )
    // A should have completed (not cancelled)
    expect(results.get("a")?.status).toBe("success")
    expect(results.get("b")?.status).toBe("failed")
  })

  it("respects maxConcurrency=1 (serial execution)", async () => {
    const edges = [{ from: "a", to: "c" }, { from: "b", to: "c" }]
    const cb = makeCallbacks(edges)
    const s = new ReactiveScheduler({ maxConcurrency: 1 })
    let maxRunning = 0
    let currentRunning = 0
    await s.execute(
      ["a", "b", "c"], edges,
      (id) => ({
        nodeId: id,
        execute: async () => {
          currentRunning++
          maxRunning = Math.max(maxRunning, currentRunning)
          await delayed(5, undefined)
          currentRunning--
          return ok(id)
        },
      }),
      cb, new AbortController().signal,
    )
    expect(maxRunning).toBe(1)
  })

  it("does not start nodes after abort signal", async () => {
    const edges = [{ from: "a", to: "b" }]
    const ctrl = new AbortController()
    const cb = makeCallbacks(edges)
    const s = new ReactiveScheduler()
    const results = await s.execute(
      ["a", "b"], edges,
      (id) => ({
        nodeId: id,
        execute: async () => {
          if (id === "a") { ctrl.abort(); return ok(id) }
          return ok(id)
        },
      }),
      cb, ctrl.signal,
    )
    // b should not have started because abort fired during a's execution
    expect(cb.readyOrder).not.toContain("b")
  })

  it("handles diamond shape: A→B, A→C, B→D, C→D", async () => {
    const edges = [
      { from: "a", to: "b" }, { from: "a", to: "c" },
      { from: "b", to: "d" }, { from: "c", to: "d" },
    ]
    const cb = makeCallbacks(edges)
    const s = new ReactiveScheduler()
    const results = await s.execute(
      ["a", "b", "c", "d"], edges,
      (id) => ({ nodeId: id, execute: () => Promise.resolve(ok(id)) }),
      cb, new AbortController().signal,
    )
    expect(cb.readyOrder.indexOf("a")).toBe(0)
    expect(cb.readyOrder.indexOf("d")).toBe(3)
    expect(results.get("d")?.status).toBe("success")
  })

  it("runs a shared downstream node after an inactive switch branch is skipped", async () => {
    const edges = [
      { from: "switch", to: "positive" },
      { from: "switch", to: "negative" },
      { from: "positive", to: "end" },
      { from: "negative", to: "end" },
    ]
    const cb = makeCallbacks(edges)
    cb.resolveActivatedDownstream = (nodeId) => {
      if (nodeId === "switch") return ["positive"]
      return edges.filter((e) => e.from === nodeId).map((e) => e.to)
    }
    const s = new ReactiveScheduler()
    const results = await s.execute(
      ["switch", "positive", "negative", "end"], edges,
      (id) => ({ nodeId: id, execute: () => Promise.resolve(ok(id)) }),
      cb, new AbortController().signal,
    )
    expect(results.get("negative")?.status).toBe("skipped")
    expect(results.get("end")?.status).toBe("success")
    expect(cb.readyOrder).toEqual(["switch", "positive", "end"])
  })

  it("handles empty node list", async () => {
    const s = new ReactiveScheduler()
    const cb = makeCallbacks([])
    const results = await s.execute([], [], () => { throw new Error("unreachable") }, cb, new AbortController().signal)
    expect(results.size).toBe(0)
  })
})
