import type { writeFile } from "node:fs/promises"
import { describe, expect, it, vi } from "vitest"

import {
  resolveScriptRuntimeSmokeBootstrap,
  ScriptRuntimeSmokeCheckFailure,
  startScriptRuntimeSmokeBootstrap,
} from "../script-runtime-smoke-bootstrap"

describe("script runtime smoke bootstrap", () => {
  it("is disabled unless both smoke variables are present", () => {
    expect(resolveScriptRuntimeSmokeBootstrap({})).toBeNull()
    expect(resolveScriptRuntimeSmokeBootstrap({
      SYNAPSE_SCRIPT_RUNTIME_SMOKE_RESULT: "/tmp/result",
    })).toBeNull()
    expect(resolveScriptRuntimeSmokeBootstrap({
      SYNAPSE_SCRIPT_RUNTIME_SMOKE: "1",
    })).toBeNull()
    expect(resolveScriptRuntimeSmokeBootstrap({
      SYNAPSE_SCRIPT_RUNTIME_SMOKE: "1",
      SYNAPSE_SCRIPT_RUNTIME_SMOKE_RESULT: "/tmp/result",
    })).toEqual({ resultPath: "/tmp/result" })
  })

  it.each([
    ["an existing result path", "EEXIST", "already_exists"],
    ["an unwritable result path", "EACCES", "permission_denied"],
  ])("contains %s failures without starting the app", async (_label, code, reason) => {
    const logger = { warn: vi.fn() }
    const whenReady = vi.fn(async () => undefined)
    const runSmoke = vi.fn(async () => undefined)
    const exit = vi.fn()
    const writeResult = vi.fn(async () => {
      throw Object.assign(new Error("/private/result-path secret"), { code })
    }) as unknown as typeof writeFile

    await startScriptRuntimeSmokeBootstrap({
      config: { resultPath: "/private/result-path" },
      executablePath: "/private/Synapse",
      whenReady,
      runSmoke,
      exit,
      logger,
      stdout: { write: vi.fn() as never },
      stderr: { write: vi.fn() as never },
      writeResult,
    })

    expect(whenReady).not.toHaveBeenCalled()
    expect(runSmoke).not.toHaveBeenCalled()
    expect(exit).toHaveBeenCalledWith(1)
    expect(logger.warn).toHaveBeenCalledWith("Packaged script runtime smoke failed.", {
      stage: "result_create",
      reason,
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("/private")
  })

  it("writes only stable stage and reason values when the runtime fails", async () => {
    const writes: string[] = []
    const writeResult = vi.fn(async (_path, data) => {
      writes.push(String(data))
    }) as unknown as typeof writeFile
    const exit = vi.fn()

    await startScriptRuntimeSmokeBootstrap({
      config: { resultPath: "/tmp/result" },
      executablePath: "/private/Synapse",
      whenReady: vi.fn(async () => undefined),
      runSmoke: vi.fn(async () => {
        throw new Error("secret runtime detail at /private/path")
      }),
      exit,
      logger: { warn: vi.fn() },
      stdout: { write: vi.fn() as never },
      stderr: { write: vi.fn() as never },
      writeResult,
    })

    expect(exit).toHaveBeenCalledWith(1)
    expect(writes).toEqual([
      "{\"stage\":\"result_create\",\"reason\":\"started\"}\n",
      "{\"stage\":\"runtime\",\"reason\":\"smoke_failed\"}\n",
    ])
    expect(writes.join("")).not.toContain("secret")
    expect(writes.join("")).not.toContain("/private")
  })

  it("reports a trusted check and outcome without copying error details", async () => {
    const error = Object.assign(new ScriptRuntimeSmokeCheckFailure("worker_result", "RUNNER_START_FAILED"), {
      message: "secret at /private/path",
      stack: "secret stack",
      source: "secret source",
      logs: ["secret log"],
    })
    const result = await captureRuntimeFailure(error)

    expect(result.records).toEqual([
      { stage: "result_create", reason: "started" },
      { stage: "runtime", reason: "smoke_failed", check: "worker_result", outcome: "RUNNER_START_FAILED" },
    ])
    expect(result.logger.warn).toHaveBeenCalledWith("Packaged script runtime smoke failed.", result.records[1])
    expect(result.exit).toHaveBeenCalledWith(1)
    expect(JSON.stringify(result)).not.toContain("secret")
    expect(JSON.stringify(result)).not.toContain("/private")
  })

  it("reports a trusted non-runner check without inventing an outcome", async () => {
    const result = await captureRuntimeFailure(new ScriptRuntimeSmokeCheckFailure("node_timeout_pid_read"))

    expect(result.records[1]).toEqual({
      stage: "runtime", reason: "smoke_failed", check: "node_timeout_pid_read",
    })
  })

  it("rejects diagnostic fields forged on an ordinary error", async () => {
    const result = await captureRuntimeFailure(Object.assign(new Error("secret at /private/path"), {
      check: "worker_result",
      outcome: "RUNNER_START_FAILED",
    }))

    expect(result.records[1]).toEqual({ stage: "runtime", reason: "smoke_failed" })
    expect(JSON.stringify(result)).not.toContain("secret")
    expect(JSON.stringify(result)).not.toContain("/private")
  })

  it.each(["check", "outcome"])("rejects an unknown %s even on the diagnostic class", async (field) => {
    const error = Object.assign(new ScriptRuntimeSmokeCheckFailure("worker_result", "RUNNER_START_FAILED"), {
      [field]: "secret at /private/path",
    })
    const result = await captureRuntimeFailure(error)

    expect(result.records[1]).toEqual({ stage: "runtime", reason: "smoke_failed" })
    expect(JSON.stringify(result)).not.toContain("secret")
    expect(JSON.stringify(result)).not.toContain("/private")
  })

  it.each(["check", "outcome"])("validates the same %s value that it emits", async (field) => {
    const error = new ScriptRuntimeSmokeCheckFailure("worker_result", "RUNNER_START_FAILED")
    let reads = 0
    Object.defineProperty(error, field, {
      get: () => reads++ === 0
        ? field === "check" ? "worker_result" : "RUNNER_START_FAILED"
        : "secret at /private/path",
    })
    const result = await captureRuntimeFailure(error)

    expect(result.records[1]).toEqual({
      stage: "runtime", reason: "smoke_failed", check: "worker_result", outcome: "RUNNER_START_FAILED",
    })
    expect(JSON.stringify(result)).not.toContain("secret")
    expect(JSON.stringify(result)).not.toContain("/private")
  })
})

async function captureRuntimeFailure(error: unknown) {
  const records: unknown[] = []
  const logger = { warn: vi.fn() }
  const exit = vi.fn()
  await startScriptRuntimeSmokeBootstrap({
    config: { resultPath: "/tmp/result" },
    executablePath: "/private/Synapse",
    whenReady: async () => undefined,
    runSmoke: async () => { throw error },
    exit,
    logger,
    stdout: { write: vi.fn() as never },
    stderr: { write: vi.fn() as never },
    writeResult: vi.fn(async (_path, data) => {
      records.push(JSON.parse(String(data)))
    }) as unknown as typeof writeFile,
  })
  return { records, logger, exit }
}
