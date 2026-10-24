import type { Worker } from "node:worker_threads"
import {
  HTML_GENERATION_MAX_CONCURRENCY,
  HTML_GENERATION_MAX_QUEUED,
  HTML_GENERATION_TIMEOUT_MS,
  HTML_GENERATION_WORKER_MAX_OLD_GENERATION_MB,
  HTML_GENERATION_WORKER_START_TIMEOUT_MS,
} from "../../../config"
import type { ActorIdentity, AuditSink, PermissionGuard } from "../../../electron/runtime/security"
import type { DispatchContext } from "../../../synapse-capabilities/shared/types"
import {
  HTML_GENERATOR_EJS_CAPABILITY_ID,
  HTML_GENERATOR_EJS_FILE_CAPABILITY_ID,
} from "../shared/capability"
import { HtmlGenerationError, normalizeHtmlGenerationError } from "../shared/errors"
import type { HtmlGenerationInput, HtmlGenerationResult } from "../shared/schema"
import { normalizeHtmlGenerationInput, validateHtmlGenerationOutput, type NormalizedHtmlGenerationInput } from "./normalization"
import { launchHtmlGenerationWorker, type HtmlGenerationWorkerFactory } from "./worker-launch"
import { parseHtmlGenerationWorkerMessage } from "./worker-protocol"

const EXECUTE_ACTION = "shell.exec" as const

export type HtmlGenerationOperation = "ejs" | "ejs_file"

export type HtmlGenerationContext = {
  readonly actor?: ActorIdentity
  readonly source?: DispatchContext["source"] | "app.ui"
  readonly metadata?: Record<string, unknown>
  readonly abortSignal?: AbortSignal
}

type HtmlGenerationLogger = {
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
}

type ScheduledRequest = {
  readonly input: NormalizedHtmlGenerationInput
  readonly signal?: AbortSignal
  readonly resolve: (result: HtmlGenerationResult) => void
  readonly reject: (error: unknown) => void
  detachAbort(): void
}

export class HtmlGenerationService {
  private readonly queue: ScheduledRequest[] = []
  private readonly runningControllers = new Set<AbortController>()
  private activeCount = 0
  private stopped = false

  constructor(private readonly deps: {
    readonly permissionGuard: PermissionGuard
    readonly auditSink: AuditSink
    readonly logger?: HtmlGenerationLogger
    readonly workerFactory?: HtmlGenerationWorkerFactory
    readonly workerBaseDir?: string
  }) {}

  generate(input: HtmlGenerationInput, context: HtmlGenerationContext = {}): Promise<HtmlGenerationResult> {
    return this.generateForOperation("ejs", input, context)
  }

  async generateForOperation(
    operation: HtmlGenerationOperation,
    input: HtmlGenerationInput,
    context: HtmlGenerationContext = {},
  ): Promise<HtmlGenerationResult> {
    const normalized = normalizeHtmlGenerationInput(input)
    const capabilityId = capabilityForOperation(operation)
    const actor = context.actor ?? { kind: "user", id: "html-generator" }
    const metadata = {
      source: context.source ?? "app.ui",
      templateBytes: normalized.templateBytes,
      dataBytes: normalized.dataBytes,
      inputBytes: normalized.inputBytes,
    }

    await this.authorize(actor, capabilityId, metadata)
    const startedAt = Date.now()
    try {
      const result = await this.schedule(normalized, context.abortSignal)
      const auditMetadata = {
        ...metadata,
        outputBytes: result.size,
        durationMs: Date.now() - startedAt,
        result: "success",
      }
      this.record(actor, capabilityId, "allowed", auditMetadata)
      this.deps.logger?.info("HTML generation succeeded", auditMetadata)
      return result
    } catch (error) {
      const normalizedError = normalizeHtmlGenerationError(error)
      const auditMetadata = {
        ...metadata,
        durationMs: Date.now() - startedAt,
        result: "failed",
        errorCode: normalizedError.code,
      }
      this.record(actor, capabilityId, "failed", auditMetadata)
      this.deps.logger?.warn("HTML generation failed", auditMetadata)
      throw normalizedError
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    const error = new HtmlGenerationError("RENDER_CANCELLED")
    for (const request of this.queue.splice(0)) {
      request.detachAbort()
      request.reject(error)
    }
    for (const controller of this.runningControllers) controller.abort()
  }

  private async authorize(
    actor: ActorIdentity,
    resource: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const permission = await this.deps.permissionGuard.check({
      action: EXECUTE_ACTION,
      actor,
      resource,
      context: metadata,
    })
    if (permission.allowed) return
    this.record(actor, resource, "denied", { ...metadata, policyId: permission.policyId })
    throw new HtmlGenerationError("PERMISSION_DENIED")
  }

  private record(
    actor: ActorIdentity,
    resource: string,
    outcome: "allowed" | "denied" | "failed",
    metadata: Record<string, unknown>,
  ): void {
    this.deps.auditSink.record({ action: EXECUTE_ACTION, actor, resource, outcome, metadata })
  }

  private schedule(input: NormalizedHtmlGenerationInput, signal?: AbortSignal): Promise<HtmlGenerationResult> {
    if (this.stopped || signal?.aborted) return Promise.reject(new HtmlGenerationError("RENDER_CANCELLED"))
    if (this.activeCount >= HTML_GENERATION_MAX_CONCURRENCY && this.queue.length >= HTML_GENERATION_MAX_QUEUED) {
      return Promise.reject(new HtmlGenerationError("RENDER_QUEUE_FULL"))
    }
    return new Promise<HtmlGenerationResult>((resolve, reject) => {
      let detachAbort: () => void = () => undefined
      const request: ScheduledRequest = { input, signal, resolve, reject, detachAbort: () => detachAbort() }
      if (signal) {
        const onAbort = () => {
          const index = this.queue.indexOf(request)
          if (index < 0) return
          this.queue.splice(index, 1)
          detachAbort()
          reject(new HtmlGenerationError("RENDER_CANCELLED"))
        }
        signal.addEventListener("abort", onAbort, { once: true })
        detachAbort = () => signal.removeEventListener("abort", onAbort)
      }
      this.queue.push(request)
      this.pump()
    })
  }

  private pump(): void {
    while (!this.stopped && this.activeCount < HTML_GENERATION_MAX_CONCURRENCY) {
      const request = this.queue.shift()
      if (!request) return
      request.detachAbort()
      if (request.signal?.aborted) {
        request.reject(new HtmlGenerationError("RENDER_CANCELLED"))
        continue
      }
      this.activeCount += 1
      const controller = new AbortController()
      this.runningControllers.add(controller)
      const detachExternal = forwardAbort(request.signal, controller)
      const release = () => {
        detachExternal()
        this.runningControllers.delete(controller)
        this.activeCount -= 1
        this.pump()
      }
      void this.runWorker(request.input, controller.signal).then(
        (result) => {
          release()
          request.resolve(result)
        },
        (error) => {
          release()
          request.reject(error)
        },
      )
    }
  }

  private runWorker(input: NormalizedHtmlGenerationInput, signal: AbortSignal): Promise<HtmlGenerationResult> {
    if (signal.aborted) return Promise.reject(new HtmlGenerationError("RENDER_CANCELLED"))
    let worker: Worker
    try {
      worker = launchHtmlGenerationWorker({
        baseDir: this.deps.workerBaseDir ?? __dirname,
        workerData: { template: input.template, data: input.data },
        maxOldGenerationSizeMb: HTML_GENERATION_WORKER_MAX_OLD_GENERATION_MB,
        workerFactory: this.deps.workerFactory,
      })
    } catch (error) {
      return Promise.reject(new HtmlGenerationError("RENDER_FAILED", {
        cause: error,
        message: "渲染 Worker 启动失败。",
      }))
    }

    drainWorkerStream(worker.stdout, this.deps.logger, "stdout")
    drainWorkerStream(worker.stderr, this.deps.logger, "stderr")

    return new Promise<HtmlGenerationResult>((resolve, reject) => {
      let settled = false
      let started = false
      let renderTimer: ReturnType<typeof setTimeout> | undefined
      const startTimer = setTimeout(() => finish(
        new HtmlGenerationError("RENDER_FAILED", { message: "渲染 Worker 启动失败。" }),
      ), HTML_GENERATION_WORKER_START_TIMEOUT_MS)

      const onAbort = () => finish(new HtmlGenerationError("RENDER_CANCELLED"))
      const onMessage = (raw: unknown) => {
        const message = parseHtmlGenerationWorkerMessage(raw)
        if (!message) {
          finish(new HtmlGenerationError("RENDER_FAILED"))
          return
        }
        if (message.type === "started") {
          if (started) {
            finish(new HtmlGenerationError("RENDER_FAILED"))
            return
          }
          started = true
          clearTimeout(startTimer)
          renderTimer = setTimeout(() => finish(new HtmlGenerationError("RENDER_TIMEOUT")), HTML_GENERATION_TIMEOUT_MS)
          return
        }
        if (!started) {
          finish(new HtmlGenerationError("RENDER_FAILED"))
          return
        }
        if (message.type === "success") {
          try {
            finish(undefined, validateHtmlGenerationOutput(message.html, message.size))
          } catch (error) {
            finish(error)
          }
          return
        }
        finish(new HtmlGenerationError(message.code, { line: message.line }))
      }
      const onError = (error: Error) => finish(new HtmlGenerationError(
        isWorkerMemoryError(error) ? "RENDER_MEMORY_LIMIT" : "RENDER_FAILED",
        { cause: error },
      ))
      const onExit = () => finish(new HtmlGenerationError("RENDER_FAILED"))

      const finish = (error?: unknown, result?: HtmlGenerationResult) => {
        if (settled) return
        settled = true
        clearTimeout(startTimer)
        if (renderTimer) clearTimeout(renderTimer)
        signal.removeEventListener("abort", onAbort)
        worker.removeListener("message", onMessage)
        worker.removeListener("error", onError)
        worker.removeListener("exit", onExit)
        void worker.terminate().catch((terminationError) => {
          this.deps.logger?.warn("HTML generation Worker termination failed", {
            errorName: terminationError instanceof Error ? terminationError.name : undefined,
          })
        })
        if (error !== undefined) reject(error)
        else if (result) resolve(result)
        else reject(new HtmlGenerationError("RENDER_FAILED"))
      }

      signal.addEventListener("abort", onAbort, { once: true })
      worker.on("message", onMessage)
      worker.once("error", onError)
      worker.once("exit", onExit)
      if (signal.aborted) onAbort()
    })
  }
}

function capabilityForOperation(operation: HtmlGenerationOperation): string {
  return operation === "ejs" ? HTML_GENERATOR_EJS_CAPABILITY_ID : HTML_GENERATOR_EJS_FILE_CAPABILITY_ID
}

function forwardAbort(source: AbortSignal | undefined, target: AbortController): () => void {
  if (!source) return () => undefined
  const abort = () => target.abort()
  source.addEventListener("abort", abort, { once: true })
  if (source.aborted) target.abort()
  return () => source.removeEventListener("abort", abort)
}

function isWorkerMemoryError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ERR_WORKER_OUT_OF_MEMORY"
}

function drainWorkerStream(
  stream: NodeJS.ReadableStream | null,
  logger: HtmlGenerationLogger | undefined,
  name: "stdout" | "stderr",
): void {
  if (!stream) return
  stream.on("error", (error) => logger?.warn("HTML generation Worker stream failed", {
    stream: name,
    errorName: error instanceof Error ? error.name : undefined,
  }))
  stream.resume()
}
