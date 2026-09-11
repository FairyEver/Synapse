import { spawn } from "node:child_process"
import { describe, expect, it, vi } from "vitest"
import {
  DriveMarkdownPdfRenderCancelledError,
  DriveMarkdownPdfRenderQueueFullError,
  DriveMarkdownPdfRenderResourceLimitError,
  DriveMarkdownPdfRenderTimeoutError,
  renderDriveMarkdownPdfInWorker,
} from "./drive-markdown-pdf-render-worker"

describe("Drive Markdown PDF render worker", () => {
  it("terminates CPU-bound rendering at the deadline without blocking the event loop", async () => {
    const controller = new AbortController()
    const heartbeat = vi.fn()
    const interval = setInterval(heartbeat, 5)
    try {
      await expect(renderDriveMarkdownPdfInWorker(
        "paragraph\n\n".repeat(50_000),
        {},
        { signal: controller.signal, timeoutMs: 40 },
        () => createTestWorker("while (true) {}"),
      )).rejects.toBeInstanceOf(DriveMarkdownPdfRenderTimeoutError)
      expect(heartbeat).toHaveBeenCalled()
    } finally {
      clearInterval(interval)
    }
  })

  it("terminates the worker when the export is cancelled", async () => {
    const controller = new AbortController()
    const operation = renderDriveMarkdownPdfInWorker(
      "# heading",
      {},
      { signal: controller.signal, timeoutMs: 5_000 },
      () => createTestWorker("setInterval(() => undefined, 1000)"),
    )

    controller.abort()

    await expect(operation).rejects.toBeInstanceOf(DriveMarkdownPdfRenderCancelledError)
  })

  it("bounds active workers and rejects work beyond the shared queue", async () => {
    const controllers = Array.from({ length: 11 }, () => new AbortController())
    const createWorker = vi.fn(() => createTestWorker("setInterval(() => undefined, 1000)"))
    const operations = controllers.slice(0, 10).map((controller) => renderDriveMarkdownPdfInWorker(
      "# heading",
      {},
      { signal: controller.signal, timeoutMs: 5_000 },
      createWorker,
    ))

    await expect(renderDriveMarkdownPdfInWorker(
      "# overflow",
      {},
      { signal: controllers[10].signal, timeoutMs: 5_000 },
      createWorker,
    )).rejects.toBeInstanceOf(DriveMarkdownPdfRenderQueueFullError)
    expect(createWorker).toHaveBeenCalledTimes(2)

    for (const controller of controllers) controller.abort()
    await Promise.allSettled(operations)
  })

  it("contains worker heap exhaustion without terminating the API process", async () => {
    const controller = new AbortController()
    await expect(renderDriveMarkdownPdfInWorker(
      "[".repeat(10 * 1024 * 1024),
      {},
      { signal: controller.signal, timeoutMs: 5_000 },
      () => createTestWorker(
        "const values = []; while (true) values.push(new Array(100000).fill('x'))",
        ["--max-old-space-size=16"],
      ),
    )).rejects.toBeInstanceOf(DriveMarkdownPdfRenderResourceLimitError)
  })

  it("rejects an oversized worker result before cloning it into the API", async () => {
    await expect(renderDriveMarkdownPdfInWorker(
      "# heading",
      {},
      { signal: new AbortController().signal, timeoutMs: 5_000 },
      () => createTestWorker("process.once('message', () => process.send({ ok: false, code: 'RESOURCE_LIMIT', error: 'too large' }))"),
    )).rejects.toBeInstanceOf(DriveMarkdownPdfRenderResourceLimitError)
  })
})

function createTestWorker(script: string, execArgv: readonly string[] = []) {
  return spawn(process.execPath, [...execArgv, "-e", script], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  })
}
