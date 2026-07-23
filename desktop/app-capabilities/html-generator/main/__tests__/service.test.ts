import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import type { Worker, WorkerOptions } from "node:worker_threads"
import { afterEach, describe, expect, it, vi } from "vitest"
import { HtmlGenerationService } from "../service"

const services: HtmlGenerationService[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(services.splice(0).map((service) => service.stop()))
})

describe("HTML Generator scheduling and terminal state", () => {
  it("validates before permission and checks shell.exec before creating a Worker", async () => {
    const invalid = harness()
    await expect(invalid.service.generate({ template: "", data: {} }))
      .rejects.toMatchObject({ code: "INVALID_TEMPLATE" })
    expect(invalid.permissionGuard.check).not.toHaveBeenCalled()
    expect(invalid.auditSink.record).not.toHaveBeenCalled()

    const denied = harness({ allowed: false })
    await expect(denied.service.generate(
      { template: "ok", data: {} },
      { metadata: { template: "secret-template", outputPath: "/secret/report.html" } },
    ))
      .rejects.toMatchObject({ code: "PERMISSION_DENIED" })
    expect(denied.workers).toHaveLength(0)
    expect(denied.auditSink.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied" }))
    expect(JSON.stringify(denied.permissionGuard.check.mock.calls)).not.toContain("secret-template")
    expect(JSON.stringify(denied.auditSink.record.mock.calls)).not.toContain("/secret/report.html")
  })

  it("shares two FIFO render slots and rejects the seventh waiting request as retryable", async () => {
    const test = harness()
    const requests = Array.from({ length: 6 }, (_, index) => test.service.generateForOperation(
      index % 2 === 0 ? "ejs" : "ejs_file",
      { template: `job-${index}`, data: {} },
    ))
    await vi.waitFor(() => expect(test.workers).toHaveLength(2))

    await expect(test.service.generate({ template: "overflow", data: {} }))
      .rejects.toMatchObject({ code: "RENDER_QUEUE_FULL", retryable: true })

    test.workers[0]?.succeed("first")
    test.workers[1]?.succeed("second")
    await vi.waitFor(() => expect(test.workers).toHaveLength(4))
    test.workers[2]?.succeed("third")
    test.workers[3]?.succeed("fourth")
    await vi.waitFor(() => expect(test.workers).toHaveLength(6))
    test.workers[4]?.succeed("fifth")
    test.workers[5]?.succeed("sixth")
    await expect(Promise.all(requests)).resolves.toHaveLength(6)
  })

  it("releases a render slot before resolving the completed request", async () => {
    const test = harness()
    const first = test.service.generate({ template: "first", data: {} })
    const second = test.service.generate({ template: "second", data: {} })
    const third = test.service.generate({ template: "third", data: {} })
    await vi.waitFor(() => expect(test.workers).toHaveLength(2))

    test.workers[0]?.succeed("first")
    await first
    expect(test.workers).toHaveLength(3)

    test.workers[1]?.succeed("second")
    test.workers[2]?.succeed("third")
    await Promise.all([second, third])
  })

  it("cancels a queued request without starting a Worker", async () => {
    const test = harness()
    const active = [
      test.service.generate({ template: "active-a", data: {} }),
      test.service.generate({ template: "active-b", data: {} }),
    ]
    await vi.waitFor(() => expect(test.workers).toHaveLength(2))
    const controller = new AbortController()
    const queued = test.service.generate({ template: "queued", data: {} }, { abortSignal: controller.signal })
    controller.abort()
    await expect(queued).rejects.toMatchObject({ code: "RENDER_CANCELLED" })
    expect(test.workers).toHaveLength(2)
    test.workers[0]?.succeed("a")
    test.workers[1]?.succeed("b")
    await Promise.all(active)
  })

  it("uses the first accepted terminal state for success and cancellation races", async () => {
    const successFirst = harness()
    const successController = new AbortController()
    const success = successFirst.service.generate(
      { template: "success", data: {} },
      { abortSignal: successController.signal },
    )
    await vi.waitFor(() => expect(successFirst.workers).toHaveLength(1))
    successFirst.workers[0]?.succeed("done")
    successController.abort()
    await expect(success).resolves.toEqual({ html: "done", size: 4 })

    const cancelFirst = harness()
    const cancelController = new AbortController()
    const cancelled = cancelFirst.service.generate(
      { template: "cancel", data: {} },
      { abortSignal: cancelController.signal },
    )
    const cancellation = expect(cancelled).rejects.toMatchObject({ code: "RENDER_CANCELLED" })
    await vi.waitFor(() => expect(cancelFirst.workers).toHaveLength(1))
    cancelController.abort()
    cancelFirst.workers[0]?.succeed("late")
    await cancellation
    expect(cancelFirst.workers[0]?.terminate).toHaveBeenCalledOnce()
  })

  it("distinguishes startup timeout, render timeout, OOM, and protocol failure", async () => {
    vi.useFakeTimers()

    const startup = harness({ autoStart: false })
    const startupResult = startup.service.generate({ template: "startup", data: {} })
    const startupExpectation = expect(startupResult).rejects.toMatchObject({ code: "RENDER_FAILED", message: "渲染 Worker 启动失败。" })
    await vi.advanceTimersByTimeAsync(5_000)
    await startupExpectation

    const render = harness()
    const renderResult = render.service.generate({ template: "render", data: {} })
    const renderExpectation = expect(renderResult).rejects.toMatchObject({ code: "RENDER_TIMEOUT" })
    await vi.advanceTimersByTimeAsync(5_000)
    await renderExpectation

    const oom = harness()
    const oomResult = oom.service.generate({ template: "oom", data: {} })
    await vi.advanceTimersByTimeAsync(0)
    oom.workers[0]?.fail(Object.assign(new Error("secret"), { code: "ERR_WORKER_OUT_OF_MEMORY" }))
    await expect(oomResult).rejects.toMatchObject({ code: "RENDER_MEMORY_LIMIT" })

    const protocol = harness()
    const protocolResult = protocol.service.generate({ template: "protocol", data: {} })
    await vi.advanceTimersByTimeAsync(0)
    protocol.workers[0]?.emit("message", { type: "success", html: "ok", size: 999 })
    await expect(protocolResult).rejects.toMatchObject({ code: "RENDER_FAILED" })
  })
})

class FakeWorker extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly terminate = vi.fn(async () => 0)

  start(): void {
    this.emit("message", { type: "started" })
  }

  succeed(html: string): void {
    this.emit("message", { type: "success", html, size: Buffer.byteLength(html, "utf8") })
  }

  fail(error: Error): void {
    this.emit("error", error)
  }
}

function harness(options: { readonly allowed?: boolean; readonly autoStart?: boolean } = {}) {
  const workers: FakeWorker[] = []
  const permissionGuard = { check: vi.fn(async () => ({ allowed: options.allowed !== false })) }
  const auditSink = { record: vi.fn() }
  const service = new HtmlGenerationService({
    permissionGuard: permissionGuard as never,
    auditSink: auditSink as never,
    workerFactory(_filename: string, workerOptions: WorkerOptions) {
      expect(workerOptions.resourceLimits?.maxOldGenerationSizeMb).toBe(128)
      expect(workerOptions.stdout).toBe(true)
      expect(workerOptions.stderr).toBe(true)
      const worker = new FakeWorker()
      workers.push(worker)
      if (options.autoStart !== false) queueMicrotask(() => worker.start())
      return worker as unknown as Worker
    },
  })
  services.push(service)
  return { service, workers, permissionGuard, auditSink }
}
