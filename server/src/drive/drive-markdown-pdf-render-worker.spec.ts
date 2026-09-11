import { spawn, type ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import {
  DriveMarkdownPdfRenderCancelledError,
  DriveMarkdownPdfRenderQueueFullError,
  DriveMarkdownPdfRenderResourceLimitError,
  DriveMarkdownPdfRenderTimeoutError,
  discoverDriveMarkdownPdfImagesInWorker,
} from "./drive-markdown-pdf-render-worker"

describe("Drive Markdown PDF render worker", () => {
  it("terminates CPU-bound rendering at the deadline without blocking the event loop", async () => {
    const controller = new AbortController()
    const heartbeat = vi.fn()
    const interval = setInterval(heartbeat, 5)
    try {
      await expect(discoverDriveMarkdownPdfImagesInWorker(
        "paragraph\n\n".repeat(50_000),
        discoveryOptions(),
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
    const operation = discoverDriveMarkdownPdfImagesInWorker(
      "# heading",
      discoveryOptions(),
      { signal: controller.signal, timeoutMs: 5_000 },
      () => createTestWorker("setInterval(() => undefined, 1000)"),
    )

    controller.abort()

    await expect(operation).rejects.toBeInstanceOf(DriveMarkdownPdfRenderCancelledError)
  })

  it("bounds active workers and rejects work beyond the shared queue", async () => {
    const controllers = Array.from({ length: 11 }, () => new AbortController())
    const createWorker = vi.fn(() => createTestWorker("setInterval(() => undefined, 1000)"))
    const operations = controllers.slice(0, 10).map((controller) => discoverDriveMarkdownPdfImagesInWorker(
      "# heading",
      discoveryOptions(),
      { signal: controller.signal, timeoutMs: 5_000 },
      createWorker,
    ))

    await expect(discoverDriveMarkdownPdfImagesInWorker(
      "# overflow",
      discoveryOptions(),
      { signal: controllers[10].signal, timeoutMs: 5_000 },
      createWorker,
    )).rejects.toBeInstanceOf(DriveMarkdownPdfRenderQueueFullError)
    expect(createWorker).toHaveBeenCalledTimes(2)

    for (const controller of controllers) controller.abort()
    await Promise.allSettled(operations)
  })

  it("does not release worker slots until terminated processes close", async () => {
    let liveWorkers = 0
    let peakLiveWorkers = 0
    const createWorker = vi.fn(() => createDelayedExitWorker(
      () => {
        liveWorkers += 1
        peakLiveWorkers = Math.max(peakLiveWorkers, liveWorkers)
      },
      () => {
        liveWorkers -= 1
      },
    ))
    const controllers = Array.from({ length: 10 }, () => new AbortController())
    const operations = controllers.map((controller) => discoverDriveMarkdownPdfImagesInWorker(
      "# heading",
      discoveryOptions(),
      { signal: controller.signal, timeoutMs: 5_000 },
      createWorker,
    ))

    expect(createWorker).toHaveBeenCalledTimes(2)
    controllers[0]?.abort()
    controllers[1]?.abort()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(createWorker).toHaveBeenCalledTimes(2)
    expect(peakLiveWorkers).toBe(2)

    for (const controller of controllers.slice(2)) controller.abort()
    await Promise.allSettled(operations)
    expect(liveWorkers).toBe(0)
  })

  it("contains worker heap exhaustion without terminating the API process", async () => {
    const controller = new AbortController()
    await expect(discoverDriveMarkdownPdfImagesInWorker(
      "[".repeat(10 * 1024 * 1024),
      discoveryOptions(),
      { signal: controller.signal, timeoutMs: 5_000 },
      () => createTestWorker(
        "const values = []; while (true) values.push(new Array(100000).fill('x'))",
        ["--max-old-space-size=16"],
      ),
    )).rejects.toBeInstanceOf(DriveMarkdownPdfRenderResourceLimitError)
  })

  it("rejects an oversized worker result before cloning it into the API", async () => {
    await expect(discoverDriveMarkdownPdfImagesInWorker(
      "# heading",
      discoveryOptions(),
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

function discoveryOptions() {
  return { allowStandaloneRawImages: true, maxImages: 256 }
}

function createDelayedExitWorker(onStart: () => void, onClose: () => void): ChildProcess {
  const worker = new EventEmitter() as EventEmitter & ChildProcess
  const state = { connected: true, killed: false }
  Object.defineProperties(worker, {
    connected: { get: () => state.connected },
    killed: { get: () => state.killed },
  })
  worker.send = ((_message: unknown, callback?: (error: Error | null) => void) => {
    callback?.(null)
    return true
  }) as ChildProcess["send"]
  worker.disconnect = (() => {
    state.connected = false
  }) as ChildProcess["disconnect"]
  worker.kill = (() => {
    if (state.killed) return true
    state.killed = true
    setTimeout(() => {
      onClose()
      worker.emit("close", null, "SIGKILL")
    }, 100)
    return true
  }) as ChildProcess["kill"]
  onStart()
  return worker
}
