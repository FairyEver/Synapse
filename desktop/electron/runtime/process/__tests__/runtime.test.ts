import { describe, expect, it, vi } from "vitest"
import { createRecordingLogger } from "../../lib/test-helpers"
import { createMainProcessRuntime } from "../runtime"

describe("MainProcessRuntime (T5.5)", () => {
  it("spawn registers a handle and start status transitions to running", async () => {
    const rt = createMainProcessRuntime()
    const handle = await rt.spawn({ id: "agent-1", kind: "main", init: {} })
    expect(handle.kind).toBe("main")
    expect(handle.status).toBe("running")
    expect(rt.list().map((h) => h.pid)).toEqual([process.pid])
  })

  it("rejects duplicate ids", async () => {
    const rt = createMainProcessRuntime()
    await rt.spawn({ id: "x", kind: "main", init: {} })
    await expect(rt.spawn({ id: "x", kind: "main", init: {} })).rejects.toThrow(/already/)
  })

  it("rejects non-main kinds", async () => {
    const rt = createMainProcessRuntime()
    await expect(
      rt.spawn({ id: "x", kind: "utility", init: {} }),
    ).rejects.toThrow(/only supports kind="main"/)
  })

  it("send() routes to subscribed listeners", async () => {
    const rt = createMainProcessRuntime()
    const handle = await rt.spawn({ id: "x", kind: "main", init: {} })
    const seen: unknown[] = []
    handle.on("test", (payload) => seen.push(payload))
    await handle.send("test", { v: 1 })
    await handle.send("test", { v: 2 })
    expect(seen).toEqual([{ v: 1 }, { v: 2 }])
  })

  it("kill flips status to stopped", async () => {
    const rt = createMainProcessRuntime()
    const handle = await rt.spawn({ id: "x", kind: "main", init: {} })
    expect(handle.status).toBe("running")
    await handle.kill()
    expect(handle.status).toBe("stopped")
  })

  it("restartPolicy defaults to never", () => {
    const rt = createMainProcessRuntime()
    expect(rt.restartPolicy).toBe("never")
  })

  it("descriptor.run callbacks fire (and crashes mark status)", async () => {
    const rt = createMainProcessRuntime()
    let ran = false
    const handle = await rt.spawn({
      id: "x",
      kind: "main",
      init: 42,
      run: async (init) => {
        ran = init === 42
      },
    })
    // Microtask flush.
    await Promise.resolve()
    await Promise.resolve()
    expect(ran).toBe(true)
    expect(handle.status).toBe("running")
  })

  it("logs listener failures through structured logger without console.error", async () => {
    const logger = createRecordingLogger()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

    try {
      const rt = createMainProcessRuntime({ logger })
      const handle = await rt.spawn({ id: "listener-process", kind: "main", init: {} })
      handle.on("updates", () => {
        throw new Error("secret token sk-test at /Users/liyang/private")
      })

      await handle.send("updates", { prompt: "sensitive payload" })

      const record = logger.records.find((item) => item.message === "ProcessRuntime listener failed.")
      expect(record).toEqual(expect.objectContaining({
        level: "error",
        meta: expect.objectContaining({
          channel: "updates",
          errorName: "Error",
          processId: "listener-process",
        }),
      }))
      expect(consoleError).not.toHaveBeenCalled()
      const serialized = JSON.stringify(logger.records)
      expect(serialized).not.toContain("sk-test")
      expect(serialized).not.toContain("/Users/liyang")
      expect(serialized).not.toContain("sensitive payload")
    } finally {
      consoleError.mockRestore()
    }
  })

  it("logs run failures through structured logger and marks the process crashed", async () => {
    const logger = createRecordingLogger()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)

    try {
      const rt = createMainProcessRuntime({ logger })
      const handle = await rt.spawn({
        id: "runner-process",
        kind: "main",
        init: {},
        run: () => {
          throw new Error("secret token sk-test at /Users/liyang/private")
        },
      })

      await Promise.resolve()
      await Promise.resolve()

      expect(handle.status).toBe("crashed")
      const record = logger.records.find((item) => item.message === "ProcessRuntime run failed.")
      expect(record).toEqual(expect.objectContaining({
        level: "error",
        meta: expect.objectContaining({
          errorName: "Error",
          processId: "runner-process",
        }),
      }))
      expect(consoleError).not.toHaveBeenCalled()
      const serialized = JSON.stringify(logger.records)
      expect(serialized).not.toContain("sk-test")
      expect(serialized).not.toContain("/Users/liyang")
    } finally {
      consoleError.mockRestore()
    }
  })

  it("emits a sanitized process warning when run fails without a logger", async () => {
    const emitWarning = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined)

    try {
      const rt = createMainProcessRuntime()
      const handle = await rt.spawn({
        id: "runner-process",
        kind: "main",
        init: {},
        run: () => {
          throw new Error("secret token sk-test at /Users/liyang/private")
        },
      })

      await Promise.resolve()
      await Promise.resolve()

      expect(handle.status).toBe("crashed")
      expect(emitWarning).toHaveBeenCalledWith(
        "ProcessRuntime run failed.",
        expect.objectContaining({
          code: "SYNAPSE_PROCESS_RUNTIME_RUN_FAILED",
          detail: expect.stringContaining("runner-process"),
        }),
      )
      const serialized = JSON.stringify(emitWarning.mock.calls)
      expect(serialized).not.toContain("sk-test")
      expect(serialized).not.toContain("/Users/liyang")
    } finally {
      emitWarning.mockRestore()
    }
  })
})
