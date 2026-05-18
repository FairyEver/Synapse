import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => "/tmp" } }))
const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}))
vi.mock("../../../electron/services/log-store", () => ({
  createMainLogger: () => logger,
}))

import { scriptNodeExecutor } from "../executor.main"
import type { NodeExecutionInput, NodeRuntimeDeps } from "../../types"
import type { ScriptNodeConfig } from "../schema"

const ctx = { projectId: "p1", runId: "r1", abortSignal: new AbortController().signal }

function makeInput(config: Partial<ScriptNodeConfig>, runtimeDeps?: NodeRuntimeDeps): NodeExecutionInput<ScriptNodeConfig> {
  return {
    config: {
      script: "echo hello",
      shell: "posix",
      variables: [],
      ...config,
    } as ScriptNodeConfig,
    resolvedVariables: {},
    context: ctx,
    agentDeps: { sendToAgent: vi.fn() },
    runtimeDeps,
  }
}

function fakeRuntimeDeps(exitCode = 0, stdout = "hello\n", stderr = ""): NodeRuntimeDeps {
  return {
    processRunner: {
      run: vi.fn().mockResolvedValue({
        exitCode,
        stdout,
        stderr,
        signal: null,
        timedOut: false,
        durationMs: 10,
        error: exitCode !== 0 ? `exit code ${exitCode}` : undefined,
        diagnostics: undefined,
      }),
    },
    sendHttpRequest: vi.fn(),
  }
}

describe("scriptNodeExecutor", () => {
  it("returns success with stdout as output", async () => {
    const deps = fakeRuntimeDeps(0, "hello world\n")
    const result = await scriptNodeExecutor.execute(makeInput({}, deps))
    expect(result.status).toBe("success")
    expect(result.output).toBe("hello world\n")
    expect(result.outputs?.exitCode).toBe(0)
  })

  it("fails gracefully when runtimeDeps is missing", async () => {
    const result = await scriptNodeExecutor.execute(makeInput({}))
    expect(result.status).toBe("failed")
    expect(result.error).toContain("脚本执行能力不可用")
  })

  it("returns failed for non-zero exit code", async () => {
    const deps = fakeRuntimeDeps(1, "", "error output")
    const result = await scriptNodeExecutor.execute(makeInput({}, deps))
    expect(result.status).toBe("failed")
    expect(result.error).toContain("脚本执行失败")
  })

  it("returns failed when processRunner.run throws", async () => {
    const deps: NodeRuntimeDeps = {
      processRunner: { run: vi.fn().mockRejectedValue(new Error("Spawn failed")) },
      sendHttpRequest: vi.fn(),
    }
    const result = await scriptNodeExecutor.execute(makeInput({}, deps))
    expect(result.status).toBe("failed")
    expect(result.error).toContain("Spawn failed")
  })

  it("does not call sendToAgent", async () => {
    const input = makeInput({}, fakeRuntimeDeps())
    await scriptNodeExecutor.execute(input)
    expect(input.agentDeps.sendToAgent).not.toHaveBeenCalled()
  })

  it("does not let resolved variables override protected process env names", async () => {
    const deps = fakeRuntimeDeps()
    const input = makeInput({ env: { CUSTOM: "configured" } }, deps)
    input.resolvedVariables = { PATH: "/tmp/bad", CUSTOM: "resolved", SAFE_VALUE: "ok" }
    await scriptNodeExecutor.execute(input)
    expect(deps.processRunner?.run).toHaveBeenCalledWith(expect.objectContaining({
      env: expect.objectContaining({
        CUSTOM: "resolved",
        SAFE_VALUE: "ok",
      }),
    }))
    expect((deps.processRunner?.run as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.env).not.toHaveProperty("PATH", "/tmp/bad")
  })

  it("logs diagnostics without raw script content", async () => {
    const secretScript = "echo sk-secret-key"
    const deps = fakeRuntimeDeps()
    await scriptNodeExecutor.execute(makeInput({ script: secretScript }, deps))

    const payload = JSON.stringify(logger.info.mock.calls)
    expect(payload).not.toContain("sk-secret-key")
    expect(logger.info).toHaveBeenCalledWith("script node executing", expect.objectContaining({
      shell: "posix",
      scriptLength: secretScript.length,
    }))
  })
})
