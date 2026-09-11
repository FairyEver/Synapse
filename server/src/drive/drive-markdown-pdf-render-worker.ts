import { fork, type ChildProcess } from "node:child_process"
import { join } from "node:path"
import type {
  DriveMarkdownPdfImageReference,
  DriveMarkdownPdfWorkerRequest,
  DriveMarkdownPdfWorkerResult,
} from "./drive-markdown-pdf-render-task"

const DRIVE_MARKDOWN_WORKER_CONCURRENCY = 2
const DRIVE_MARKDOWN_WORKER_MAX_QUEUE = 8
const DRIVE_MARKDOWN_WORKER_MAX_OLD_SPACE_MB = 512
const DRIVE_MARKDOWN_WORKER_MAX_YOUNG_SPACE_MB = 64

type RenderWorkerResponse =
  | { readonly ok: true; readonly result: DriveMarkdownPdfWorkerResult }
  | { readonly ok: false; readonly error: string; readonly code?: "RESOURCE_LIMIT" }

type RenderWorkerOutcome =
  | { readonly ok: true; readonly result: DriveMarkdownPdfWorkerResult }
  | { readonly ok: false; readonly error: Error }

type QueuedRender = {
  readonly deadline: number
  readonly signal: AbortSignal
  readonly start: (remainingMs: number) => void
  readonly reject: (error: Error) => void
  timeout?: NodeJS.Timeout
  abort?: () => void
}

let activeWorkers = 0
const renderQueue: QueuedRender[] = []

export class DriveMarkdownPdfRenderTimeoutError extends Error {
  constructor() {
    super("Drive Markdown PDF rendering timed out")
    this.name = "DriveMarkdownPdfRenderTimeoutError"
  }
}

export class DriveMarkdownPdfRenderCancelledError extends Error {
  constructor() {
    super("Drive Markdown PDF rendering cancelled")
    this.name = "DriveMarkdownPdfRenderCancelledError"
  }
}

export class DriveMarkdownPdfRenderQueueFullError extends Error {
  constructor() {
    super("Drive Markdown PDF render queue is full")
    this.name = "DriveMarkdownPdfRenderQueueFullError"
  }
}

export class DriveMarkdownPdfRenderResourceLimitError extends Error {
  constructor() {
    super("Drive Markdown PDF rendering exceeded its memory limit")
    this.name = "DriveMarkdownPdfRenderResourceLimitError"
  }
}

export async function discoverDriveMarkdownPdfImagesInWorker(
  markdown: string,
  options: {
    readonly allowStandaloneRawImages: boolean
    readonly maxImages: number
    readonly resourceKeys?: ReadonlySet<string>
  },
  control: {
    readonly signal: AbortSignal
    readonly timeoutMs: number
  },
  createWorker: () => ChildProcess = createRenderWorker,
): Promise<{
  readonly images: readonly DriveMarkdownPdfImageReference[]
  readonly tooManyImages: boolean
}> {
  const result = await scheduleRenderWorker({
    kind: "discover-images",
    markdown,
    allowStandaloneRawImages: options.allowStandaloneRawImages,
    maxImages: options.maxImages,
    ...(options.resourceKeys ? { resourceKeys: options.resourceKeys } : {}),
  }, control, createWorker)
  if (result.kind !== "image-discovery") throw new Error("Drive Markdown PDF worker returned an invalid result")
  return result
}

export async function renderDriveMarkdownPdfHtmlInWorker(
  markdown: string,
  options: {
    readonly allowStandaloneRawImages: boolean
    readonly imageResourceKeys: ReadonlyMap<string, string | null>
  },
  control: {
    readonly signal: AbortSignal
    readonly timeoutMs: number
  },
  createWorker: () => ChildProcess = createRenderWorker,
): Promise<string> {
  const result = await scheduleRenderWorker({
    kind: "render-html",
    markdown,
    allowStandaloneRawImages: options.allowStandaloneRawImages,
    imageResourceKeys: options.imageResourceKeys,
  }, control, createWorker)
  if (result.kind !== "html") throw new Error("Drive Markdown PDF worker returned an invalid result")
  return result.html
}

function scheduleRenderWorker(
  request: DriveMarkdownPdfWorkerRequest,
  control: {
    readonly signal: AbortSignal
    readonly timeoutMs: number
  },
  createWorker: () => ChildProcess,
): Promise<DriveMarkdownPdfWorkerResult> {
  if (control.signal.aborted) return Promise.reject(new DriveMarkdownPdfRenderCancelledError())
  if (control.timeoutMs <= 0) return Promise.reject(new DriveMarkdownPdfRenderTimeoutError())

  const deadline = Date.now() + control.timeoutMs
  return new Promise((resolve, reject) => {
    const queued: QueuedRender = {
      deadline,
      signal: control.signal,
      reject,
      start: (remainingMs) => {
        runRenderWorker(request, control.signal, remainingMs, createWorker)
          .then((result) => {
            releaseWorkerSlot()
            resolve(result)
          }, (error) => {
            releaseWorkerSlot()
            reject(error)
          })
      },
    }

    if (activeWorkers < DRIVE_MARKDOWN_WORKER_CONCURRENCY) {
      startQueuedRender(queued)
      return
    }
    if (renderQueue.length >= DRIVE_MARKDOWN_WORKER_MAX_QUEUE) {
      reject(new DriveMarkdownPdfRenderQueueFullError())
      return
    }

    queued.abort = () => removeQueuedRender(queued, new DriveMarkdownPdfRenderCancelledError())
    queued.timeout = setTimeout(
      () => removeQueuedRender(queued, new DriveMarkdownPdfRenderTimeoutError()),
      Math.max(1, control.timeoutMs),
    )
    control.signal.addEventListener("abort", queued.abort, { once: true })
    renderQueue.push(queued)
  })
}

function releaseWorkerSlot(): void {
  activeWorkers -= 1
  startQueuedRenders()
}

function startQueuedRender(queued: QueuedRender): void {
  cleanupQueuedRender(queued)
  if (queued.signal.aborted) {
    queued.reject(new DriveMarkdownPdfRenderCancelledError())
    startQueuedRenders()
    return
  }
  const remainingMs = queued.deadline - Date.now()
  if (remainingMs <= 0) {
    queued.reject(new DriveMarkdownPdfRenderTimeoutError())
    startQueuedRenders()
    return
  }
  activeWorkers += 1
  queued.start(remainingMs)
}

function startQueuedRenders(): void {
  while (activeWorkers < DRIVE_MARKDOWN_WORKER_CONCURRENCY) {
    const queued = renderQueue.shift()
    if (!queued) return
    startQueuedRender(queued)
  }
}

function removeQueuedRender(queued: QueuedRender, error: Error): void {
  const index = renderQueue.indexOf(queued)
  if (index < 0) return
  renderQueue.splice(index, 1)
  cleanupQueuedRender(queued)
  queued.reject(error)
}

function cleanupQueuedRender(queued: QueuedRender): void {
  if (queued.timeout) clearTimeout(queued.timeout)
  if (queued.abort) queued.signal.removeEventListener("abort", queued.abort)
}

function createRenderWorker(): ChildProcess {
  return fork(join(__dirname, "drive-markdown-pdf-render.worker.js"), [], {
    execArgv: [
      `--max-old-space-size=${DRIVE_MARKDOWN_WORKER_MAX_OLD_SPACE_MB}`,
      `--max-semi-space-size=${DRIVE_MARKDOWN_WORKER_MAX_YOUNG_SPACE_MB}`,
    ],
    serialization: "advanced",
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  })
}

function runRenderWorker(
  request: DriveMarkdownPdfWorkerRequest,
  signal: AbortSignal,
  timeoutMs: number,
  createWorker: () => ChildProcess,
): Promise<DriveMarkdownPdfWorkerResult> {
  if (signal.aborted) return Promise.reject(new DriveMarkdownPdfRenderCancelledError())

  let worker: ChildProcess
  try {
    worker = createWorker()
  } catch (error) {
    return Promise.reject(normalizeWorkerError(error))
  }

  return new Promise((resolve, reject) => {
    let outcome: RenderWorkerOutcome | undefined
    let reaped = false
    const timeout = setTimeout(() => {
      terminateWith({ ok: false, error: new DriveMarkdownPdfRenderTimeoutError() })
    }, Math.max(1, timeoutMs))

    const terminateWith = (nextOutcome: RenderWorkerOutcome) => {
      if (outcome) return
      outcome = nextOutcome
      clearTimeout(timeout)
      signal.removeEventListener("abort", abort)
      if (worker.connected) worker.disconnect()
      if (!worker.killed) worker.kill("SIGKILL")
    }
    const abort = () => terminateWith({ ok: false, error: new DriveMarkdownPdfRenderCancelledError() })
    const settleAfterExit = (code: number | null, exitSignal: NodeJS.Signals | null) => {
      if (reaped) return
      reaped = true
      clearTimeout(timeout)
      signal.removeEventListener("abort", abort)

      const finalOutcome = outcome ?? outcomeFromWorkerExit(code, exitSignal)
      if (finalOutcome.ok) resolve(finalOutcome.result)
      else reject(finalOutcome.error)
    }

    signal.addEventListener("abort", abort, { once: true })
    worker.once("message", (message: RenderWorkerResponse) => {
      if (message.ok) terminateWith({ ok: true, result: message.result })
      else if (message.code === "RESOURCE_LIMIT") {
        terminateWith({ ok: false, error: new DriveMarkdownPdfRenderResourceLimitError() })
      } else {
        terminateWith({ ok: false, error: new Error(message.error) })
      }
    })
    worker.once("error", (error) => terminateWith({ ok: false, error: normalizeWorkerError(error) }))
    worker.once("exit", settleAfterExit)
    worker.once("close", settleAfterExit)
    try {
      worker.send(request, (error) => {
        if (error) terminateWith({ ok: false, error: normalizeWorkerError(error) })
      })
    } catch (error) {
      terminateWith({ ok: false, error: normalizeWorkerError(error) })
    }
  })
}

function outcomeFromWorkerExit(
  code: number | null,
  exitSignal: NodeJS.Signals | null,
): RenderWorkerOutcome {
  if (exitSignal === "SIGABRT" || exitSignal === "SIGKILL" || code === 134) {
    return { ok: false, error: new DriveMarkdownPdfRenderResourceLimitError() }
  }
  if (code !== 0) {
    return { ok: false, error: new Error(`Drive Markdown PDF worker exited with code ${code}`) }
  }
  return { ok: false, error: new Error("Drive Markdown PDF worker exited before returning a result") }
}

function normalizeWorkerError(error: unknown): Error {
  if (
    error instanceof Error
    && "code" in error
    && error.code === "ERR_WORKER_OUT_OF_MEMORY"
  ) {
    return new DriveMarkdownPdfRenderResourceLimitError()
  }
  return error instanceof Error ? error : new Error(String(error))
}
