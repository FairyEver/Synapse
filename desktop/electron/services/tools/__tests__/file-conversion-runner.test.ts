import { EventEmitter } from "node:events"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import {
  convertFilesInWorker,
  resolveFileConversionWorkerPath,
} from "../file-conversion-runner"

class WorkerMock extends EventEmitter {
  readonly once = vi.fn(super.once.bind(this))
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

  it("maps app.asar paths to app.asar.unpacked worker paths", () => {
    const baseDir = path.join("/Applications/Synapse.app/Contents/Resources/app.asar/electron/services/tools")

    expect(resolveFileConversionWorkerPath(baseDir)).toContain("app.asar.unpacked")
    expect(resolveFileConversionWorkerPath(baseDir)).toContain("workers/file-conversion-worker.js")
  })
})
