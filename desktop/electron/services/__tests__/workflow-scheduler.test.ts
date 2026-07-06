import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => "/tmp" } }))
const schedLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))
vi.mock("../log-store", () => ({
  createMainLogger: () => schedLogger,
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
  afterEach(() => {
    schedLogger.info.mockClear()
    schedLogger.warn.mockClear()
    schedLogger.error.mockClear()
  })

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

  it("propagates skip through inactive branch chain when a shared downstream node has both activated and non-activated upstream paths", async () => {
    // switch → A, switch → B ; A → C, B → C ; C → D
    // switch activates "A" only. B and anything only reachable via B should be "skipped".
    // But C is also reachable via A, and D via C, so C and D should still execute.
    const edges = [
      { from: "switch", to: "a" },
      { from: "switch", to: "b" },
      { from: "a", to: "c" },
      { from: "b", to: "c" },
      { from: "c", to: "d" },
    ]
    const cb = makeCallbacks(edges)
    cb.resolveActivatedDownstream = (nodeId) => {
      if (nodeId === "switch") return ["a"]
      return edges.filter((e) => e.from === nodeId).map((e) => e.to)
    }
    const s = new ReactiveScheduler()
    const results = await s.execute(
      ["switch", "a", "b", "c", "d"], edges,
      (id) => ({ nodeId: id, execute: () => Promise.resolve(ok(id)) }),
      cb, new AbortController().signal,
    )
    // Activated branch
    expect(results.get("a")?.status).toBe("success")
    // Inactive branch
    expect(results.get("b")?.status).toBe("skipped")
    // Shared downstream — activated by A's chain, not by B (which was skipped)
    expect(results.get("c")?.status).toBe("success")
    // Transitive downstream from C
    expect(results.get("d")?.status).toBe("success")
    // B never starts; D starts after C
    expect(cb.readyOrder).toEqual(["switch", "a", "c", "d"])
  })

  it("does not start a node when the final skipped dependency arrives after a failed upstream", async () => {
    const edges = [
      { from: "fail", to: "z" },
      { from: "active", to: "z" },
      { from: "switch", to: "z" },
    ]
    const cb = makeCallbacks(edges)
    cb.resolveActivatedDownstream = (nodeId) => {
      if (nodeId === "switch") return []
      return edges.filter((e) => e.from === nodeId).map((e) => e.to)
    }
    const s = new ReactiveScheduler()
    const results = await s.execute(
      ["fail", "active", "switch", "z"], edges,
      (id) => ({
        nodeId: id,
        execute: () => {
          if (id === "fail") return Promise.resolve(fail(id))
          if (id === "switch") return delayed(5, ok(id))
          return Promise.resolve(ok(id))
        },
      }),
      cb, new AbortController().signal,
    )

    expect(cb.readyOrder).not.toContain("z")
    expect(results.get("z")).toMatchObject({ status: "skipped", error: "upstream failed" })
  })

  it("emits done callbacks for nodes skipped through inactive branch propagation", async () => {
    const edges = [{ from: "switch", to: "inactive" }]
    const done: NodeExecOutcome[] = []
    const cb = makeCallbacks(edges)
    cb.onNodeDone = (outcome) => { done.push(outcome) }
    cb.resolveActivatedDownstream = () => []
    const results = await new ReactiveScheduler().execute(
      ["switch", "inactive"], edges,
      (id) => ({ nodeId: id, execute: () => Promise.resolve(ok(id)) }),
      cb, new AbortController().signal,
    )
    expect(results.get("inactive")?.status).toBe("skipped")
    expect(done).toContainEqual({ nodeId: "inactive", status: "skipped" })
  })

  it("records a taskFactory synchronous throw and still awaits in-flight nodes", async () => {
    const edges: Array<{ from: string; to: string }> = []
    const done: NodeExecOutcome[] = []
    const cb = makeCallbacks(edges)
    cb.onNodeDone = (outcome) => { done.push(outcome) }
    const results = await new ReactiveScheduler().execute(
      ["a", "bad"], edges,
      (id) => {
        if (id === "bad") throw new Error("factory exploded")
        return { nodeId: id, execute: () => delayed(5, ok(id)) }
      },
      cb, new AbortController().signal,
    )
    expect(results.get("a")?.status).toBe("success")
    expect(results.get("bad")).toMatchObject({ nodeId: "bad", status: "failed", error: "factory exploded" })
    expect(done.map((outcome) => outcome.nodeId)).toEqual(expect.arrayContaining(["a", "bad"]))
  })

  it("continues unrelated queued branches after one branch fails", async () => {
    const edges = [{ from: "fail", to: "blocked" }]
    const cb = makeCallbacks(edges)
    const results = await new ReactiveScheduler({ maxConcurrency: 1 }).execute(
      ["fail", "other", "blocked"], edges,
      (id) => ({
        nodeId: id,
        execute: () => Promise.resolve(id === "fail" ? fail(id) : ok(id)),
      }),
      cb, new AbortController().signal,
    )
    expect(results.get("fail")?.status).toBe("failed")
    expect(results.get("blocked")?.status).toBe("skipped")
    expect(results.get("other")?.status).toBe("success")
  })

  it("returns after abort grace timeout even when a task ignores abort", async () => {
    const ctrl = new AbortController()
    const cb = makeCallbacks([])
    const startedAt = Date.now()
    const promise = new ReactiveScheduler({ cancelGraceMs: 1 }).execute(
      ["a"], [],
      (id) => ({
        nodeId: id,
        execute: async () => {
          ctrl.abort()
          await delayed(50, undefined)
          return ok(id)
        },
      }),
      cb, ctrl.signal,
    )
    const results = await promise
    expect(results.get("a")?.status).toBe("cancelled")
    expect(Date.now() - startedAt).toBeLessThan(40)
  })

  it("records cancelled outcomes on abort grace timeout and ignores late task results", async () => {
    const ctrl = new AbortController()
    const done: NodeExecOutcome[] = []
    const cb = makeCallbacks([])
    cb.onNodeDone = (outcome) => { done.push(outcome) }
    const results = await new ReactiveScheduler({ cancelGraceMs: 1, runId: "late-run" }).execute(
      ["a"], [],
      (id) => ({
        nodeId: id,
        execute: async () => {
          ctrl.abort()
          await delayed(20, undefined)
          return ok(id, "late success")
        },
      }),
      cb, ctrl.signal,
    )

    expect(results.get("a")).toMatchObject({
      nodeId: "a",
      status: "cancelled",
      error: "运行被取消（取消宽限期超时）",
    })
    expect(done).toEqual([
      expect.objectContaining({
        nodeId: "a",
        status: "cancelled",
        error: "运行被取消（取消宽限期超时）",
      }),
    ])

    await delayed(25, undefined)
    expect(results.get("a")?.status).toBe("cancelled")
    expect(schedLogger.warn).toHaveBeenCalledWith(
      "scheduler: node settled after abort grace timeout",
      expect.objectContaining({ nodeId: "a", runId: "late-run" }),
    )
  })

  it("preserves a completed node result that resolves at the abort grace boundary", async () => {
    vi.useFakeTimers()
    const ctrl = new AbortController()
    const cb = makeCallbacks([])
    let finishTask: ((outcome: NodeExecOutcome) => void) | undefined
    const promise = new ReactiveScheduler({ cancelGraceMs: 1 }).execute(
      ["a"], [],
      (id) => ({
        nodeId: id,
        execute: () => new Promise<NodeExecOutcome>((resolve) => {
          finishTask = resolve
        }),
      }),
      cb, ctrl.signal,
    )

    try {
      await Promise.resolve()
      ctrl.abort()
      await Promise.resolve()
      await Promise.resolve()
      expect(schedLogger.info).toHaveBeenCalledWith(
        "scheduler: abort detected, waiting for in-flight nodes",
        expect.objectContaining({ runningNodeIds: ["a"] }),
      )
      setTimeout(() => {
        finishTask?.({
          nodeId: "a",
          status: "success",
          output: "finished at boundary",
          usage: { input_tokens: 10 },
          costUsd: 0.01,
        })
      }, 1)

      await vi.advanceTimersToNextTimerAsync()
      await vi.advanceTimersToNextTimerAsync()
      await vi.advanceTimersToNextTimerAsync()

      const results = await promise
      expect(results.get("a")).toEqual({
        nodeId: "a",
        status: "success",
        output: "finished at boundary",
        usage: { input_tokens: 10 },
        costUsd: 0.01,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it("handles empty node list", async () => {
    const s = new ReactiveScheduler()
    const cb = makeCallbacks([])
    const results = await s.execute([], [], () => { throw new Error("unreachable") }, cb, new AbortController().signal)
    expect(results.size).toBe(0)
  })

  it("includes runId in abort-detected log when provided via SchedulerOptions", async () => {
    const edges = [{ from: "a", to: "b" }]
    const cb = makeCallbacks(edges)
    const ctrl = new AbortController()
    const s = new ReactiveScheduler({ runId: "test-run-abc" })
    const executePromise = s.execute(
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
    const results = await executePromise
    expect(results.get("a")?.status).toBe("success")
    expect(schedLogger.info).toHaveBeenCalledWith(
      "scheduler: abort detected, waiting for in-flight nodes",
      expect.objectContaining({ runId: "test-run-abc" }),
    )
  })

  it("includes runId in node-failed log when provided via SchedulerOptions", async () => {
    const edges = [{ from: "a", to: "b" }]
    const cb = makeCallbacks(edges)
    const s = new ReactiveScheduler({ runId: "test-run-def" })
    const results = await s.execute(
      ["a", "b"], edges,
      (id) => ({ nodeId: id, execute: () => Promise.resolve(fail(id)) }),
      cb, new AbortController().signal,
    )
    expect(results.get("a")?.status).toBe("failed")
    expect(schedLogger.info).toHaveBeenCalledWith(
      "scheduler: node failed, stopping new launches",
      expect.objectContaining({ nodeId: "a", runId: "test-run-def" }),
    )
  })
})
