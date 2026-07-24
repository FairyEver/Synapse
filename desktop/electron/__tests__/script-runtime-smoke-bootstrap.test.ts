import type { writeFile } from "node:fs/promises"
import { describe, expect, it, vi } from "vitest"

import {
  resolveScriptRuntimeSmokeBootstrap,
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
})
