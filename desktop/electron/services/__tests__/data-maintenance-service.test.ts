import { describe, expect, it, vi } from "vitest"

import type {
  DataMaintenanceExecutor,
  DataMaintenanceProgress,
  DataMaintenanceResult,
} from "../../runtime/data-repo"
import { DataMaintenanceService } from "../data-maintenance-service"

describe("DataMaintenanceService", () => {
  it("schedules maintenance without waiting for Worker completion", async () => {
    const executor = { run: vi.fn() } as unknown as DataMaintenanceExecutor
    const service = createService(executor, { initialDelayMs: 60_000 })

    expect(service.start()).toBeUndefined()
    expect(service.inspect()).toMatchObject({ status: "scheduled" })
    expect(executor.run).not.toHaveBeenCalled()

    await service.stop()
  })

  it("tracks progress and completed cleanup diagnostics", async () => {
    let progressListener: ((progress: DataMaintenanceProgress) => void) | undefined
    const result = deferred<DataMaintenanceResult>()
    const executor: DataMaintenanceExecutor = {
      run: vi.fn((_policy, onProgress) => {
        progressListener = onProgress
        return { result: result.promise, terminate: vi.fn(async () => 0) }
      }),
    }
    const auditSink = { record: vi.fn() }
    const service = createService(executor, { auditSink })

    const run = service.runNow()
    await vi.waitFor(() => expect(executor.run).toHaveBeenCalledOnce())
    progressListener?.({
      phase: "outbox-local",
      deleted: { localOutbox: 500, retainedOutbox: 0, rawAgentDiagnostics: 0, orphanAgentEvents: 0 },
    })
    expect(service.inspect()).toMatchObject({
      status: "running",
      phase: "outbox-local",
      deleted: { localOutbox: 500 },
    })

    result.resolve(maintenanceResult())
    await run

    expect(service.inspect()).toMatchObject({
      status: "completed",
      deleted: { localOutbox: 1_500, rawAgentDiagnostics: 20 },
      nextRunAt: expect.any(String),
    })
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "database.mutate",
      outcome: "allowed",
    }))
    await service.stop()
  })

  it("records a retryable failure without exposing the raw error message", async () => {
    const executor: DataMaintenanceExecutor = {
      run: vi.fn(() => ({
        result: Promise.reject(new Error("database locked token=secret")),
        terminate: vi.fn(async () => 0),
      })),
    }
    const logger = { info: vi.fn(), warn: vi.fn() }
    const auditSink = { record: vi.fn() }
    const service = createService(executor, { logger, auditSink })

    await service.runNow()

    expect(service.inspect()).toMatchObject({
      status: "failed",
      errorName: "Error",
      errorLength: "database locked token=secret".length,
      nextRunAt: expect.any(String),
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("token=secret")
    expect(JSON.stringify(auditSink.record.mock.calls)).not.toContain("token=secret")
    await service.stop()
  })
})

function createService(
  executor: DataMaintenanceExecutor,
  overrides: Partial<ConstructorParameters<typeof DataMaintenanceService>[0]> = {},
): DataMaintenanceService {
  return new DataMaintenanceService({
    executor,
    logger: { info: vi.fn(), warn: vi.fn() },
    permissionGuard: { check: vi.fn(async () => ({ allowed: true as const })) },
    now: () => new Date("2026-09-05T12:00:00.000Z"),
    initialDelayMs: 60_000,
    intervalMs: 60_000,
    partialDelayMs: 60_000,
    failureDelayMs: 60_000,
    timeoutMs: 60_000,
    ...overrides,
  })
}

function maintenanceResult(): DataMaintenanceResult {
  return {
    status: "completed",
    startedAt: "2026-09-05T12:00:00.000Z",
    finishedAt: "2026-09-05T12:00:01.000Z",
    durationMs: 1_000,
    databaseBytesBefore: 1_000,
    databaseBytesAfter: 900,
    freePagesBefore: 0,
    freePagesAfter: 10,
    deleted: {
      localOutbox: 1_500,
      retainedOutbox: 0,
      rawAgentDiagnostics: 20,
      orphanAgentEvents: 2,
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
