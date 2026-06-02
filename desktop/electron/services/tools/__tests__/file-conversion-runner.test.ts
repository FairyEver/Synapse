import { EventEmitter } from "node:events"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import {
  convertFilesInWorker,
  resolveFileConversionWorkerPath,
} from "../file-conversion-runner"

class WorkerMock extends EventEmitter {
  readonly once = vi.fn(super.once.bind(this))
  readonly terminate = vi.fn(async () => 1)
}

describe("convertFilesInWorker", () => {
  it("runs conversion in a worker process", async () => {
    const worker = new WorkerMock()
    const workerFactory = vi.fn(() => worker as never)
    const promise = convertFilesInWorker({
      filePaths: ["/tmp/report.docx"],
      outputDirectory: "/tmp/out",
    }, { workerFactory })

    worker.emit("message", {
      type: "success",
      result: {
        successes: [{ sourcePath: "/tmp/report.docx", outputPath: "/tmp/out/report.md", warningCount: 0 }],
        failures: [],
      },
    })

    await expect(promise).resolves.toEqual({
      successes: [{ sourcePath: "/tmp/report.docx", outputPath: "/tmp/out/report.md", warningCount: 0 }],
      failures: [],
    })
    expect(workerFactory).toHaveBeenCalledWith(expect.stringContaining("file-conversion-worker.js"), {
      filePaths: ["/tmp/report.docx"],
      outputDirectory: "/tmp/out",
    })
  })

  it("terminates the worker when conversion times out", async () => {
    vi.useFakeTimers()
    try {
      const worker = new WorkerMock()
      const workerFactory = vi.fn(() => worker as never)
      const promise = convertFilesInWorker({
        filePaths: ["/tmp/hung.pdf"],
        outputDirectory: "/tmp/out",
      }, { workerFactory, timeoutMs: 5 })
      const rejection = expect(promise).rejects.toThrow("File conversion timed out after 5ms")

      await vi.advanceTimersByTimeAsync(5)

      await rejection
      expect(worker.terminate).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("maps app.asar paths to app.asar.unpacked worker paths", () => {
    const baseDir = path.join("/Applications/Synapse.app/Contents/Resources/app.asar/electron/services/tools")
    const workerPath = resolveFileConversionWorkerPath(baseDir).replace(/\\/g, "/")

    expect(workerPath).toContain("app.asar.unpacked")
    expect(workerPath).toContain("workers/file-conversion-worker.js")
  })
})
