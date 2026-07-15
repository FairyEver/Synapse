import { beforeEach, describe, expect, it, vi } from "vitest"

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

const ctx = {
  projectId: "p1",
  workflowId: "wf1",
  runId: "r1",
  nodeId: "script1",
  abortSignal: new AbortController().signal,
}

function makeInput(
  config: Partial<ScriptNodeConfig>,
  runtimeDeps?: NodeRuntimeDeps,
  context: Partial<NodeExecutionInput<ScriptNodeConfig>["context"]> = {},
): NodeExecutionInput<ScriptNodeConfig> {
  return {
    config: {
      script: "echo hello",
      shell: "posix",
      variables: [],
      ...config,
    } as ScriptNodeConfig,
    resolvedVariables: {},
    context: { ...ctx, ...context },
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
    resolveProjectWorkspacePath: vi.fn().mockResolvedValue("/Users/liyang/project"),
    sendHttpRequest: vi.fn(),
  }
}

describe("scriptNodeExecutor", () => {
  beforeEach(() => {
    logger.info.mockClear()
    logger.warn.mockClear()
  })

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

  it("sanitizes runner errors returned by failed runs", async () => {
    const rawError = "token=sk-secret Authorization: Bearer abc123 at /Users/liyang/project --env API_KEY=plain-secret"
    const deps: NodeRuntimeDeps = {
      processRunner: {
        run: vi.fn().mockResolvedValue({
          exitCode: 1,
          stdout: "",
          stderr: "error output",
          signal: null,
          timedOut: false,
          durationMs: 10,
          error: rawError,
          diagnostics: undefined,
        }),
      },
      resolveProjectWorkspacePath: vi.fn().mockResolvedValue("/Users/liyang/project"),
      sendHttpRequest: vi.fn(),
    }

    const result = await scriptNodeExecutor.execute(makeInput({}, deps))

    expect(result.status).toBe("failed")
    expect(result.error).toContain("脚本执行失败")
    const payload = `${result.error}${JSON.stringify(logger.warn.mock.calls)}`
    expect(payload).not.toContain("sk-secret")
    expect(payload).not.toContain("Bearer abc123")
    expect(payload).not.toContain("/Users/liyang/project")
    expect(payload).not.toContain("plain-secret")
    expect(payload).toContain("[redacted]")
  })

  it("returns failed when processRunner.run throws", async () => {
    const deps: NodeRuntimeDeps = {
      processRunner: { run: vi.fn().mockRejectedValue(new Error("Spawn failed")) },
      resolveProjectWorkspacePath: vi.fn().mockResolvedValue("/Users/liyang/project"),
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

  it("marks shell audit metadata as workflow source", async () => {
    const deps = fakeRuntimeDeps()
    await scriptNodeExecutor.execute(makeInput({}, deps))

    expect(deps.processRunner?.run).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        source: "workflow",
        actionType: "workflow.script",
      }),
    }))
  })

  it("runs scripts from the resolved workflow project directory", async () => {
    const deps = fakeRuntimeDeps()
    await scriptNodeExecutor.execute(makeInput({}, deps))

    expect(deps.resolveProjectWorkspacePath).toHaveBeenCalledWith("p1")
    expect(deps.processRunner?.run).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "/Users/liyang/project",
    }))
  })

  it("fails before spawning when the workflow has no project", async () => {
    const deps = fakeRuntimeDeps()
    const result = await scriptNodeExecutor.execute(makeInput({}, deps, { projectId: undefined }))

    expect(result.status).toBe("failed")
    expect(result.error).toContain("脚本节点缺少项目")
    expect(deps.processRunner?.run).not.toHaveBeenCalled()
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

  it("injects single and multi resource variable strings into the script environment", async () => {
    const deps = fakeRuntimeDeps()
    const input = makeInput({ shell: "posix", script: "printf '%s\\n' \"$input_file\" \"$input_files\"" }, deps)
    input.resolvedVariables = {
      input_file: "/tmp/input.txt",
      input_files: '["/tmp/first.txt","/tmp/second.txt"]',
    }

    await scriptNodeExecutor.execute(input)

    expect(deps.processRunner?.run).toHaveBeenCalledWith(expect.objectContaining({
      env: expect.objectContaining({
        input_file: "/tmp/input.txt",
        input_files: '["/tmp/first.txt","/tmp/second.txt"]',
      }),
    }))
  })

  it("logs diagnostics without raw script content", async () => {
    const secretScript = "echo sk-secret-key"
    const deps = fakeRuntimeDeps()
    await scriptNodeExecutor.execute(makeInput({ script: secretScript }, deps))

    const payload = JSON.stringify(logger.info.mock.calls)
    expect(payload).not.toContain("sk-secret-key")
    expect(logger.info).toHaveBeenCalledWith("script node executing", expect.objectContaining({
      projectId: "p1",
      runId: "r1",
      workflowId: "wf1",
      nodeId: "script1",
      shell: "posix",
      scriptLength: secretScript.length,
    }))
  })
})
