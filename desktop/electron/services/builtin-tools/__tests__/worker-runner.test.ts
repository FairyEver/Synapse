import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import { executeBuiltinToolInWorker, resolveBuiltinToolWorkerPath } from "../worker-runner"

describe("builtin tool worker runner", () => {
  it("resolves unpacked worker bootstrap inside app.asar", () => {
    const baseDir = path.join("/Applications/Synapse.app/Contents/Resources/app.asar/dist-electron/electron/services/builtin-tools")
    expect(resolveBuiltinToolWorkerPath(baseDir)).toContain("app.asar.unpacked")
    expect(resolveBuiltinToolWorkerPath(baseDir)).toContain("worker-bootstraps")
  })

  it("resolves source worker during development", () => {
    const baseDir = path.join("/repo/desktop/dist-electron/electron/services/builtin-tools")
    expect(resolveBuiltinToolWorkerPath(baseDir)).toBe(path.join(baseDir, "../../workers/builtin-tool-worker.js"))
  })

  it("returns worker success messages", async () => {
    const worker = fakeWorker()
    const resultPromise = executeBuiltinToolInWorker(
      { toolId: "docx-to-markdown", input: { inputPath: "/tmp/a.docx", outputMode: "return" } },
      { workerFactory: () => worker as never, timeoutMs: 1000 },
    )
    worker.emitMessage({ type: "success", output: { markdown: "# OK", warnings: [] } })
    await expect(resultPromise).resolves.toEqual({ markdown: "# OK", warnings: [] })
  })

  it("terminates the worker when the run is aborted", async () => {
    const worker = fakeWorker()
    const abortController = new AbortController()
    const resultPromise = executeBuiltinToolInWorker(
      {
        toolId: "docx-to-markdown",
        input: { inputPath: "/tmp/a.docx", outputMode: "return" },
        abortSignal: abortController.signal,
      },
      { workerFactory: () => worker as never, timeoutMs: 1000 },
    )

    abortController.abort()

    await expect(resultPromise).rejects.toMatchObject({ code: "cancelled" })
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })
})

function fakeWorker() {
  const listeners = new Map<string, (value: unknown) => void>()
  return {
    once: vi.fn((event: string, callback: (value: unknown) => void) => {
      listeners.set(event, callback)
      return undefined
    }),
    terminate: vi.fn(async () => undefined),
    emitMessage(value: unknown) {
      listeners.get("message")?.(value)
    },
  }
}
