import { Worker } from "node:worker_threads"
import { describe, expect, it, vi } from "vitest"
import {
  DriveMarkdownPdfRenderCancelledError,
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
        () => new Worker("while (true) {}", { eval: true }),
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
      () => new Worker("setInterval(() => undefined, 1000)", { eval: true }),
    )

    controller.abort()

    await expect(operation).rejects.toBeInstanceOf(DriveMarkdownPdfRenderCancelledError)
  })
})
