import { join } from "node:path"
import { Worker } from "node:worker_threads"
import type { DriveMarkdownRenderOptions, DriveMarkdownRenderResult } from "./drive-markdown-renderer"

type RenderWorkerResponse =
  | { readonly ok: true; readonly result: DriveMarkdownRenderResult }
  | { readonly ok: false; readonly error: string }

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

export function renderDriveMarkdownPdfInWorker(
  markdown: string,
  options: DriveMarkdownRenderOptions,
  control: {
    readonly signal: AbortSignal
    readonly timeoutMs: number
  },
  createWorker: () => Worker = () => new Worker(join(__dirname, "drive-markdown-pdf-render.worker.js")),
): Promise<DriveMarkdownRenderResult> {
  if (control.signal.aborted) return Promise.reject(new DriveMarkdownPdfRenderCancelledError())

  const worker = createWorker()
  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => {
      finish(new DriveMarkdownPdfRenderTimeoutError())
    }, Math.max(1, control.timeoutMs))

    const finish = (error?: Error, result?: DriveMarkdownRenderResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      control.signal.removeEventListener("abort", abort)
      worker.removeAllListeners()
      void worker.terminate()
      if (error) reject(error)
      else if (result) resolve(result)
      else reject(new Error("Drive Markdown PDF worker returned no result"))
    }
    const abort = () => finish(new DriveMarkdownPdfRenderCancelledError())

    control.signal.addEventListener("abort", abort, { once: true })
    worker.once("message", (message: RenderWorkerResponse) => {
      if (message.ok) finish(undefined, message.result)
      else finish(new Error(message.error))
    })
    worker.once("error", (error) => finish(error instanceof Error ? error : new Error(String(error))))
    worker.once("exit", (code) => {
      if (code !== 0) finish(new Error(`Drive Markdown PDF worker exited with code ${code}`))
      else finish(new Error("Drive Markdown PDF worker exited before returning a result"))
    })
    worker.postMessage({ markdown, options })
  })
}
