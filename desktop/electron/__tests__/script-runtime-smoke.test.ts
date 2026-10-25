import { mkdir, readFile, readdir } from "node:fs/promises"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { runChromiumWorkerScript } from "../../app-capabilities/script-runtime/main/chromium-worker-runner"
import { runNodeCliScript } from "../../app-capabilities/script-runtime/main/node-cli-runner"
import type { ScriptRunFailure } from "../../app-capabilities/script-runtime/main/types"
import { runScriptRuntimeSmoke } from "../script-runtime-smoke"

vi.mock("../../app-capabilities/script-runtime/main/chromium-worker-runner", () => ({
  runChromiumWorkerScript: vi.fn(),
}))
vi.mock("../../app-capabilities/script-runtime/main/node-cli-runner", () => ({
  runNodeCliScript: vi.fn(),
}))
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>()
  return {
    ...actual,
    mkdir: vi.fn(actual.mkdir),
    readdir: vi.fn(actual.readdir),
    readFile: vi.fn(async (filePath, ...args) => String(filePath).endsWith(".pid")
      ? "12345"
      : actual.readFile(filePath, ...args)),
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("Process does not exist"), { code: "ESRCH" })
  })
  vi.mocked(runChromiumWorkerScript).mockReset()
    .mockResolvedValueOnce({
      status: "success",
      result: {
        input: 42,
        processType: "undefined",
        requireType: "undefined",
        electronType: "undefined",
        documentType: "undefined",
      },
      logs: [{ label: "console", value: "worker-log" }],
      durationMs: 1,
    })
    .mockResolvedValueOnce(failure("SCRIPT_FAILED"))
    .mockResolvedValueOnce(failure("OUTPUT_TOO_LARGE"))
    .mockResolvedValueOnce(failure("TIMEOUT"))
    .mockResolvedValueOnce(failure("CANCELLED"))
  vi.mocked(runNodeCliScript).mockReset()
    .mockImplementationOnce(async (request) => ({
      status: "success",
      result: { value: 42, cwd: request.cwd, commonjs: true },
      logs: [{ label: "stderr", value: "node-log" }],
      durationMs: 1,
    }))
    .mockResolvedValueOnce({ status: "success", result: { value: 42, esm: true }, logs: [], durationMs: 1 })
    .mockResolvedValueOnce(failure("OUTPUT_TOO_LARGE"))
    .mockResolvedValueOnce(failure("TIMEOUT"))
    .mockResolvedValueOnce(failure("CANCELLED"))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("script runtime smoke diagnostics", () => {
  it("still completes when every existing contract passes", async () => {
    await expect(runScriptRuntimeSmoke("/private/Synapse")).resolves.toBeUndefined()
  })

  it("identifies a missing timeout PID file without exposing its error", async () => {
    vi.mocked(readFile).mockRejectedValueOnce(Object.assign(new Error("secret at /private/timeout.pid"), {
      code: "ENOENT",
    }))

    await expectSafeFailure("node_timeout_pid_read")
  })

  it("identifies a process still alive after timeout cleanup", async () => {
    vi.mocked(process.kill).mockImplementation(() => true)

    await expectSafeFailure("node_timeout_process_stopped")
  })

  it("identifies a temporary script left after the runs", async () => {
    vi.mocked(readdir).mockResolvedValueOnce([".synapse-node-secret.cjs"] as never)

    await expectSafeFailure("node_temp_cleanup")
  })

  it("identifies fixture preparation without copying an unknown underlying error", async () => {
    vi.mocked(mkdir).mockRejectedValueOnce(new Error("secret fixture at /private/path"))

    await expectSafeFailure("node_fixture_prepare")
  })

  it("identifies the worker assertion and its finite unexpected outcome", async () => {
    vi.mocked(runChromiumWorkerScript).mockReset().mockResolvedValue(failure("RUNNER_START_FAILED"))

    await expectSafeFailure("worker_result", "RUNNER_START_FAILED")
  })
})

async function expectSafeFailure(check: string, outcome?: string): Promise<void> {
  const error = await runScriptRuntimeSmoke("/private/Synapse").catch((caught: unknown) => caught)
  expect(error).toMatchObject({ check, ...(outcome ? { outcome } : {}) })
  expect(error).toBeInstanceOf(Error)
  expect(String(error)).not.toContain("secret")
  expect(String(error)).not.toContain("/private")
  expect(JSON.stringify(error)).not.toContain("secret")
  expect(JSON.stringify(error)).not.toContain("/private")
}

function failure(code: ScriptRunFailure["code"]): ScriptRunFailure {
  return {
    status: code === "TIMEOUT" ? "timeout" : code === "CANCELLED" ? "cancelled" : "failed",
    code,
    error: "secret runner detail at /private/path",
    logs: [],
    durationMs: 1,
  }
}
