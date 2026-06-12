import { access, mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { beforeEach, describe, expect, it, vi } from "vitest"

const electronState = vi.hoisted(() => ({
  userDataPath: "/tmp/synapse-codex-user-data",
}))

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => (name === "userData" ? electronState.userDataPath : os.tmpdir()),
  },
}))

vi.mock("../../../electron/services/log-store", () => ({
  createMainLogger: () => logger,
}))

import {
  buildCodexDebugOutput,
  codexArtifactPaths,
  finalOutputFromResult,
  readCodexArtifact,
  writeCodexArtifact,
} from "../artifacts.main"
import { codexNodeExecutor } from "../executor.main"
import { defaultCodexNodeConfig, type CodexNodeConfig } from "../schema"
import type { NodeExecutionInput, NodeRuntimeDeps } from "../../types"

const context = {
  projectId: "repo-1",
  workflowId: "wf-1",
  workflowName: "Workflow One",
  runId: "run-1",
  nodeId: "node-1",
  nodeName: "Codex",
  abortSignal: new AbortController().signal,
}

function makeInput(
  config: Partial<CodexNodeConfig> = {},
  runtimeDeps?: NodeRuntimeDeps,
): NodeExecutionInput<CodexNodeConfig> {
  return {
    config: {
      ...defaultCodexNodeConfig,
      prompt: "Summarize {{topic}}",
      ...config,
    },
    resolvedVariables: { topic: "release notes" },
    context,
    agentDeps: {
      sendToAgent: vi.fn(),
    },
    runtimeDeps,
  }
}

function makeRuntimeDeps(
  overrides: Partial<NodeRuntimeDeps> = {},
): NodeRuntimeDeps {
  return {
    processRunner: {
      run: vi.fn().mockResolvedValue({
        exitCode: 0,
        signal: null,
        stdout: "stdout answer\n",
        stderr: "",
        timedOut: false,
        durationMs: 25,
      }),
    },
    sendHttpRequest: vi.fn(),
    resolveProjectWorkspacePath: vi.fn().mockResolvedValue("/Users/liyang/project"),
    ...overrides,
  }
}

describe("codex artifacts", () => {
  beforeEach(() => {
    logger.info.mockClear()
    logger.warn.mockClear()
  })

  it("builds the expected path shape", () => {
    const paths = codexArtifactPaths("/tmp/synapse", "run-1", "node-1")

    expect(paths).toEqual({
      directory: path.join("/tmp/synapse", "workflow-runs", "run-1", "nodes", "node-1", "codex"),
      promptPath: path.join("/tmp/synapse", "workflow-runs", "run-1", "nodes", "node-1", "codex", "prompt.txt"),
      stdoutPath: path.join("/tmp/synapse", "workflow-runs", "run-1", "nodes", "node-1", "codex", "stdout.log"),
      stderrPath: path.join("/tmp/synapse", "workflow-runs", "run-1", "nodes", "node-1", "codex", "stderr.log"),
      lastMessagePath: path.join("/tmp/synapse", "workflow-runs", "run-1", "nodes", "node-1", "codex", "last-message.txt"),
    })
  })

  it("redacts secret-looking debug previews while keeping normal paths", () => {
    const debug = buildCodexDebugOutput({
      args: ["exec", "--config", "ANTHROPIC_API_KEY=sk-test-secret", "--cd", "/Users/liyang/project"],
      cwd: "/Users/liyang/project",
      exitCode: 1,
      durationMs: 123,
      stdout: "created /Users/liyang/project/out.txt\nAuthorization: Bearer secret-token",
      stderr: "token=secret-token at /Users/liyang/project/error.log",
    })

    expect(JSON.stringify(debug)).not.toContain("sk-test-secret")
    expect(JSON.stringify(debug)).not.toContain("secret-token")
    expect(debug.cwd).toBe("/Users/liyang/project")
    expect(debug.args).toContain("/Users/liyang/project")
    expect(debug.stdoutPreview).toContain("/Users/liyang/project/out.txt")
    expect(debug.stderrPreview).toContain("/Users/liyang/project/error.log")
  })

  it("redacts URL query secrets in debug args and previews", () => {
    const debug = buildCodexDebugOutput({
      args: ["exec", "--config", "endpoint=https://example.com/path?token=secret-token"],
      cwd: "/Users/liyang/project",
      exitCode: 1,
      durationMs: 123,
      stdout: "opened https://example.com/path?token=secret-token",
      stderr: "failed https://example.com/path?api_key=secret-token",
    })

    expect(JSON.stringify(debug)).not.toContain("secret-token")
    expect(debug.args.join(" ")).toContain("token=[redacted]")
    expect(debug.stdoutPreview).toContain("token=[redacted]")
    expect(debug.stderrPreview).toContain("api_key=[redacted]")
  })

  it("truncates debug previews to 2000 characters", () => {
    const debug = buildCodexDebugOutput({
      args: ["exec"],
      cwd: "/Users/liyang/project",
      exitCode: 0,
      durationMs: 10,
      stdout: "x".repeat(2001),
    })

    expect(debug.stdoutPreview).toHaveLength(2000)
    expect(debug.stdoutPreview?.endsWith("...")).toBe(true)
  })

  it("prefers last message before stdout fallback", () => {
    expect(finalOutputFromResult(" final answer \n", " stdout ")).toBe("final answer")
    expect(finalOutputFromResult(" \n", " stdout \n")).toBe("stdout")
    expect(finalOutputFromResult(undefined, undefined)).toBe("")
  })

  it("extracts and dedupes JSONL session hints", () => {
    const debug = buildCodexDebugOutput({
      args: ["exec"],
      cwd: "/Users/liyang/project",
      exitCode: 0,
      durationMs: 10,
      stdout: [
        JSON.stringify({ thread_id: "thread-1", session_id: "session-1" }),
        JSON.stringify({ thread_id: "thread-1", session_path: "/Users/liyang/.codex/sessions/session-1.jsonl" }),
        "not json",
      ].join("\n"),
    })

    expect(debug.sessionHints).toEqual([
      "thread_id=thread-1",
      "session_id=session-1",
      "session_path=/Users/liyang/.codex/sessions/session-1.jsonl",
    ])
  })

  it("writes sanitized artifact content", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-codex-artifacts-"))
    const filePath = path.join(tempDir, "stdout.log")

    await writeCodexArtifact(filePath, "result\nAuthorization: Bearer secret-token")

    const content = await readCodexArtifact(filePath)
    expect(content).toContain("result")
    expect(content).not.toContain("secret-token")
  })
})

describe("codexNodeExecutor", () => {
  beforeEach(async () => {
    logger.info.mockClear()
    logger.warn.mockClear()
    electronState.userDataPath = await mkdtemp(path.join(os.tmpdir(), "synapse-codex-user-data-"))
  })

  it("fails when process runner is missing", async () => {
    const input = makeInput({}, {
      sendHttpRequest: vi.fn(),
      resolveProjectWorkspacePath: vi.fn(),
    } as NodeRuntimeDeps)

    const result = await codexNodeExecutor.execute(input)

    expect(result).toMatchObject({
      status: "failed",
      error: "Codex 执行能力不可用",
    })
  })

  it("fails when project is missing", async () => {
    const input = makeInput({}, makeRuntimeDeps())
    input.context = {
      ...context,
      projectId: "   ",
    }

    const result = await codexNodeExecutor.execute(input)

    expect(result).toMatchObject({
      status: "failed",
      error: "Codex 节点缺少项目",
    })
  })

  it("fails when workspace resolver is missing", async () => {
    const input = makeInput({}, {
      processRunner: makeRuntimeDeps().processRunner,
      sendHttpRequest: vi.fn(),
    } as NodeRuntimeDeps)

    const result = await codexNodeExecutor.execute(input)

    expect(result).toMatchObject({
      status: "failed",
      error: "Codex 项目路径解析能力不可用",
    })
  })

  it("fails when project workspace path cannot be resolved", async () => {
    const runtimeDeps = makeRuntimeDeps({
      resolveProjectWorkspacePath: vi.fn().mockResolvedValue(null),
    })

    const result = await codexNodeExecutor.execute(makeInput({}, runtimeDeps))

    expect(result).toMatchObject({
      status: "failed",
      error: "Codex 节点项目不存在",
    })
    expect(runtimeDeps.resolveProjectWorkspacePath).toHaveBeenCalledWith("repo-1")
  })

  it("resolves project id to cwd, interpolates prompt, and does not call sendToAgent", async () => {
    const runtimeDeps = makeRuntimeDeps()
    const input = makeInput({}, runtimeDeps)

    const result = await codexNodeExecutor.execute(input)

    expect(result.status).toBe("success")
    expect(result.output).toBe("stdout answer")
    expect(input.agentDeps.sendToAgent).not.toHaveBeenCalled()
    expect(runtimeDeps.resolveProjectWorkspacePath).toHaveBeenCalledWith("repo-1")
    expect(runtimeDeps.processRunner.run).toHaveBeenCalledWith(expect.objectContaining({
      command: "codex",
      cwd: "/Users/liyang/project",
      stdin: "Summarize release notes",
      metadata: expect.objectContaining({
        source: "workflow",
        actionType: "workflow.codex",
        workflowId: "wf-1",
        workflowRunId: "run-1",
        workflowNodeId: "node-1",
      }),
    }))
  })

  it("prefers last-message.txt over stdout when the file exists", async () => {
    const runtimeDeps = makeRuntimeDeps({
      processRunner: {
        run: vi.fn().mockImplementation(async (request: { args?: readonly string[] }) => {
          const lastMessagePathIndex = request.args?.indexOf("--output-last-message") ?? -1
          const lastMessagePath = lastMessagePathIndex >= 0 ? request.args?.[lastMessagePathIndex + 1] : undefined
          if (typeof lastMessagePath === "string") {
            await writeFile(lastMessagePath, "final answer from file\n", "utf8")
          }

          return {
            exitCode: 0,
            signal: null,
            stdout: "stdout answer\n",
            stderr: "",
            timedOut: false,
            durationMs: 25,
          }
        }),
      },
    })

    const result = await codexNodeExecutor.execute(makeInput({}, runtimeDeps))

    expect(result.status).toBe("success")
    expect(result.output).toBe("final answer from file")
  })

  it("falls back to stdout when last-message.txt is missing", async () => {
    const runtimeDeps = makeRuntimeDeps()

    const result = await codexNodeExecutor.execute(makeInput({}, runtimeDeps))

    expect(result.status).toBe("success")
    expect(result.output).toBe("stdout answer")
  })

  it("returns sanitized codex debug output for non-zero exits", async () => {
    const runtimeDeps = makeRuntimeDeps({
      processRunner: {
        run: vi.fn().mockResolvedValue({
          exitCode: 1,
          signal: null,
          stdout: "created /Users/liyang/project/out.txt\ntoken=sk-secret\nthread_id=thread-1",
          stderr: "failed with token=sk-secret at /Users/liyang/private",
          timedOut: false,
          durationMs: 25,
          error: "Codex failed with token=sk-secret at /Users/liyang/private",
        }),
      },
    })

    const result = await codexNodeExecutor.execute(makeInput({}, runtimeDeps))

    expect(result.status).toBe("failed")
    expect(result.output).toBe("")
    expect(result.error).toContain("Codex 执行失败")
    expect(result.error).not.toContain("sk-secret")
    expect(result.error).not.toContain("/Users/liyang/private")
    expect(result.outputs?.codexDebug).toBeDefined()
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("sk-secret")
    expect(serialized).toContain("/Users/liyang/project/out.txt")
  })

  it("returns empty output for timed out processes while keeping codexDebug", async () => {
    const runtimeDeps = makeRuntimeDeps({
      processRunner: {
        run: vi.fn().mockResolvedValue({
          exitCode: 124,
          signal: null,
          stdout: "partial jsonl output\n",
          stderr: "",
          timedOut: true,
          durationMs: 25,
        }),
      },
    })

    const result = await codexNodeExecutor.execute(makeInput({}, runtimeDeps))

    expect(result).toMatchObject({
      status: "failed",
      output: "",
      error: "Codex 执行超时",
    })
    expect(result.outputs?.codexDebug).toBeDefined()
  })

  it("skips prompt/stdout/stderr artifact persistence when captureDebugArtifacts is false", async () => {
    const runtimeDeps = makeRuntimeDeps({
      processRunner: {
        run: vi.fn().mockImplementation(async (request: { args?: readonly string[] }) => {
          const lastMessagePathIndex = request.args?.indexOf("--output-last-message") ?? -1
          const lastMessagePath = lastMessagePathIndex >= 0 ? request.args?.[lastMessagePathIndex + 1] : undefined
          if (typeof lastMessagePath === "string") {
            await writeFile(lastMessagePath, "final answer from file\n", "utf8")
          }

          return {
            exitCode: 0,
            signal: null,
            stdout: "stdout answer\n",
            stderr: "stderr output\n",
            timedOut: false,
            durationMs: 25,
          }
        }),
      },
    })

    const input = makeInput({ captureDebugArtifacts: false }, runtimeDeps)
    const artifactPaths = codexArtifactPaths(electronState.userDataPath, context.runId, context.nodeId)
    const result = await codexNodeExecutor.execute(input)

    expect(result.status).toBe("success")
    expect(result.output).toBe("final answer from file")
    expect(result.outputs?.codexDebug).toMatchObject({
      lastMessagePath: artifactPaths.lastMessagePath,
    })
    expect(result.outputs?.codexDebug).not.toHaveProperty("promptPath")
    expect(result.outputs?.codexDebug).not.toHaveProperty("stdoutPath")
    expect(result.outputs?.codexDebug).not.toHaveProperty("stderrPath")
    await expect(access(artifactPaths.promptPath)).rejects.toThrow()
    await expect(access(artifactPaths.stdoutPath)).rejects.toThrow()
    await expect(access(artifactPaths.stderrPath)).rejects.toThrow()
  })
})
