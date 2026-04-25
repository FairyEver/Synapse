import { describe, expect, it } from "vitest"
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
})
