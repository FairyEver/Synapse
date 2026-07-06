import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
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

let projectWorkspacePath = os.tmpdir()

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
    resolveProjectWorkspacePath: vi.fn().mockResolvedValue(projectWorkspacePath),
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

  it("rejects unsafe artifact path ids", () => {
    expect(() => codexArtifactPaths("/tmp/synapse", "../run", "node-1")).toThrow("Invalid workflow id")
    expect(() => codexArtifactPaths("/tmp/synapse", "run-1", "../node")).toThrow("Invalid workflow node id")
    expect(() => codexArtifactPaths("/tmp/synapse", "run-1", "/tmp/node")).toThrow("Invalid workflow node id")
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
    expect(debug.args.join(" ")).toContain("endpoint=[redacted]")
    expect(debug.stdoutPreview).toContain("token=[redacted]")
    expect(debug.stderrPreview).toContain("api_key=[redacted]")
  })

  it("redacts all config override values in debug args", () => {
    const debug = buildCodexDebugOutput({
      args: ["exec", "--config", "project_context=customer-alpha", "--config", "model_reasoning_effort=high"],
      cwd: "/Users/liyang/project",
      exitCode: 0,
      durationMs: 10,
    })

    expect(debug.args).toEqual([
      "exec",
      "--config",
      "project_context=[redacted]",
      "--config",
      "model_reasoning_effort=[redacted]",
    ])
    expect(JSON.stringify(debug)).not.toContain("customer-alpha")
    expect(JSON.stringify(debug)).not.toContain("high")
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

  it("does not return raw JSONL stdout as final output", () => {
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
      JSON.stringify({ type: "tool.result", content: "raw tool output token=secret" }),
    ].join("\n")

    expect(finalOutputFromResult(undefined, stdout)).toBe("")
  })

  it("extracts final text from known JSONL final message events", () => {
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
      JSON.stringify({ type: "final_message", message: "done" }),
    ].join("\n")

    expect(finalOutputFromResult(undefined, stdout)).toBe("done")
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

  it("writes sanitized artifact content while keeping normal paths", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-codex-artifacts-"))
    const filePath = path.join(tempDir, "stdout.log")

    await writeCodexArtifact(filePath, "result /Users/liyang/project/out.txt\nAuthorization: Bearer secret-token")

    const content = await readCodexArtifact(filePath)
    expect(content).toContain("result")
    expect(content).toContain("/Users/liyang/project/out.txt")
    expect(content).not.toContain("secret-token")
  })
})

describe("codexNodeExecutor", () => {
  beforeEach(async () => {
    logger.info.mockClear()
    logger.warn.mockClear()
    electronState.userDataPath = await mkdtemp(path.join(os.tmpdir(), "synapse-codex-user-data-"))
    projectWorkspacePath = await mkdtemp(path.join(os.tmpdir(), "synapse-codex-project-"))
  })

  it("fails when process runner is missing", async () => {
    const runtimeDeps: Partial<NodeRuntimeDeps> = {
      sendHttpRequest: vi.fn(),
      resolveProjectWorkspacePath: vi.fn(),
    }
    const input = makeInput({}, runtimeDeps as unknown as NodeRuntimeDeps)

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
    const actor = { kind: "user" as const, id: "automation", display: "Automation" }
    input.context = {
      ...input.context,
      actor,
      automationId: "auto-1",
      automationRunId: "auto-run-1",
    }

    const result = await codexNodeExecutor.execute(input)

    expect(result.status).toBe("success")
    expect(result.output).toBe("stdout answer")
    expect(input.agentDeps.sendToAgent).not.toHaveBeenCalled()
    expect(runtimeDeps.resolveProjectWorkspacePath).toHaveBeenCalledWith("repo-1")
    expect(runtimeDeps.processRunner.run).toHaveBeenCalledWith(expect.objectContaining({
      actor,
      command: "codex",
      cwd: projectWorkspacePath,
      stdin: "Summarize release notes",
      metadata: expect.objectContaining({
        source: "workflow",
        actionType: "workflow.codex",
        workflowId: "wf-1",
        workflowRunId: "run-1",
        workflowNodeId: "node-1",
        automationId: "auto-1",
        automationRunId: "auto-run-1",
      }),
    }))
  })

  it("uses an interpolated workingDirectory as process cwd and codex --cd", async () => {
    const runtimeDeps = makeRuntimeDeps()
    const targetDir = await mkdtemp(path.join(os.tmpdir(), "synapse-codex-workdir-"))
    const input = makeInput({ workingDirectory: "{{targetDir}}" }, runtimeDeps)
    input.resolvedVariables = { ...input.resolvedVariables, targetDir }

    const result = await codexNodeExecutor.execute(input)

    expect(result.status).toBe("success")
    expect(runtimeDeps.resolveProjectWorkspacePath).toHaveBeenCalledWith("repo-1")
    expect(runtimeDeps.processRunner.run).toHaveBeenCalledWith(expect.objectContaining({
      cwd: targetDir,
      args: expect.arrayContaining(["--cd", targetDir]),
    }))
    const request = vi.mocked(runtimeDeps.processRunner.run).mock.calls[0]?.[0]
    expect(request?.args).not.toEqual(expect.arrayContaining(["--add-dir", targetDir]))
  })

  it("fails when workingDirectory resolves to a missing path", async () => {
    const runtimeDeps = makeRuntimeDeps()
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-codex-workdir-parent-"))
    const missingDir = path.join(tempDir, "missing")
    const input = makeInput({ workingDirectory: "{{targetDir}}" }, runtimeDeps)
    input.resolvedVariables = { ...input.resolvedVariables, targetDir: missingDir }

    const result = await codexNodeExecutor.execute(input)

    expect(result).toMatchObject({
      status: "failed",
      error: "Codex 工作目录不存在",
    })
    expect(runtimeDeps.processRunner.run).not.toHaveBeenCalled()
  })

  it("resolves additional writable directories and images before building the codex request", async () => {
    const runtimeDeps = makeRuntimeDeps()
    const targetDir = await mkdtemp(path.join(os.tmpdir(), "synapse-codex-paths-"))
    const writableDir = path.join(targetDir, "writable")
    const imagePath = path.join(targetDir, "screen.png")
    await mkdir(writableDir)
    await writeFile(imagePath, "image", "utf8")
    const input = makeInput({
      workingDirectory: targetDir,
      additionalWritableDirs: ["./writable"],
      images: ["{{imagePath}}"],
    }, runtimeDeps)
    input.resolvedVariables = { ...input.resolvedVariables, imagePath }

    const result = await codexNodeExecutor.execute(input)

    expect(result.status).toBe("success")
    expect(runtimeDeps.processRunner.run).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining([
        "--add-dir",
        writableDir,
        "--image",
        imagePath,
      ]),
      metadata: expect.objectContaining({
        externalPathResources: [
          expect.objectContaining({
            source: "codex.additionalWritableDirs",
            kind: "directory",
            access: "read_write",
            resolvedPath: writableDir,
            relativeToCwd: "inside",
            pathFingerprint: expect.any(String),
          }),
          expect.objectContaining({
            source: "codex.images",
            kind: "file",
            access: "read",
            resolvedPath: imagePath,
            relativeToCwd: "inside",
            pathFingerprint: expect.any(String),
          }),
        ],
      }),
    }))
  })

  it("fails before spawning codex when advanced path inputs are missing", async () => {
    const runtimeDeps = makeRuntimeDeps()
    const targetDir = await mkdtemp(path.join(os.tmpdir(), "synapse-codex-missing-paths-"))
    const input = makeInput({
      workingDirectory: targetDir,
      additionalWritableDirs: ["./missing"],
    }, runtimeDeps)

    const result = await codexNodeExecutor.execute(input)

    expect(result).toMatchObject({
      status: "failed",
      error: "Codex 可写目录不存在",
    })
    expect(runtimeDeps.processRunner.run).not.toHaveBeenCalled()
  })

  it("prefers last-message.txt over stdout when the file exists", async () => {
    let capturedLastMessagePath: string | undefined
    const runtimeDeps = makeRuntimeDeps({
      processRunner: {
        run: vi.fn().mockImplementation(async (request: { args?: readonly string[] }) => {
          const lastMessagePathIndex = request.args?.indexOf("--output-last-message") ?? -1
          const lastMessagePath = lastMessagePathIndex >= 0 ? request.args?.[lastMessagePathIndex + 1] : undefined
          capturedLastMessagePath = lastMessagePath
          if (typeof lastMessagePath === "string") {
            await writeFile(lastMessagePath, "final answer token=sk-secret from file\n", "utf8")
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
    const artifactPaths = codexArtifactPaths(electronState.userDataPath, context.runId, context.nodeId)
    const persistedLastMessage = await readFile(artifactPaths.lastMessagePath, "utf8")

    expect(result.status).toBe("success")
    expect(result.output).toBe("final answer token=sk-secret from file")
    expect(result.outputs?.codexDebug).toMatchObject({
      lastMessagePath: artifactPaths.lastMessagePath,
    })
    expect(capturedLastMessagePath).toBeDefined()
    expect(capturedLastMessagePath).not.toBe(artifactPaths.lastMessagePath)
    await expect(access(capturedLastMessagePath!)).rejects.toThrow()
    expect(persistedLastMessage).toContain("token=[redacted]")
    expect(persistedLastMessage).not.toContain("sk-secret")
  })

  it("streams codex stdout and stderr without requiring buffered process output", async () => {
    const runtimeDeps = makeRuntimeDeps({
      processRunner: {
        run: vi.fn().mockImplementation(async (request: {
          args?: readonly string[]
          output?: { stdout?: string; stderr?: string }
          onStdoutLine?: (line: string) => void
          onStderrLine?: (line: string) => void
        }) => {
          const lastMessagePathIndex = request.args?.indexOf("--output-last-message") ?? -1
          const lastMessagePath = lastMessagePathIndex >= 0 ? request.args?.[lastMessagePathIndex + 1] : undefined
          if (typeof lastMessagePath === "string") {
            await writeFile(lastMessagePath, "final answer from file\n", "utf8")
          }
          request.onStdoutLine?.(JSON.stringify({ type: "session", thread_id: "thread-stream" }))
          request.onStderrLine?.("warning token=sk-secret at /Users/liyang/private")

          return {
            exitCode: 0,
            signal: null,
            timedOut: false,
            durationMs: 25,
          }
        }),
      },
    })
    const artifactPaths = codexArtifactPaths(electronState.userDataPath, context.runId, context.nodeId)

    const result = await codexNodeExecutor.execute(makeInput({}, runtimeDeps))

    expect(result.status).toBe("success")
    expect(result.output).toBe("final answer from file")
    const request = vi.mocked(runtimeDeps.processRunner?.run).mock.calls[0]?.[0]
    expect(request).toMatchObject({
      output: { stdout: "ignore", stderr: "ignore" },
    })
    expect(request?.onStdoutLine).toEqual(expect.any(Function))
    expect(request?.onStderrLine).toEqual(expect.any(Function))
    expect(result.outputs?.codexDebug).toMatchObject({
      stdoutPath: artifactPaths.stdoutPath,
      stderrPath: artifactPaths.stderrPath,
      stdoutPreview: expect.stringContaining("thread-stream"),
      sessionHints: ["thread_id=thread-stream"],
    })
    const stderrArtifact = await readCodexArtifact(artifactPaths.stderrPath)
    expect(stderrArtifact).not.toContain("sk-secret")
  })

  it("uses captured stderr for non-zero exit errors when process output is ignored", async () => {
    const runtimeDeps = makeRuntimeDeps({
      processRunner: {
        run: vi.fn().mockImplementation(async (request: {
          onStderrLine?: (line: string) => void
        }) => {
          request.onStderrLine?.("model not found")
          return {
            exitCode: 1,
            signal: null,
            timedOut: false,
            durationMs: 25,
          }
        }),
      },
    })

    const result = await codexNodeExecutor.execute(makeInput({}, runtimeDeps))

    expect(result.status).toBe("failed")
    expect(result.error).toContain("model not found")
    expect(result.error).not.toContain("Codex 退出码 1")
  })

  it("returns a stable error when codex is missing from process result errors", async () => {
    const runtimeDeps = makeRuntimeDeps({
      processRunner: {
        run: vi.fn().mockResolvedValue({
          exitCode: null,
          signal: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          durationMs: 25,
          error: "spawn codex ENOENT",
        }),
      },
    })

    const result = await codexNodeExecutor.execute(makeInput({}, runtimeDeps))

    expect(result.status).toBe("failed")
    expect(result.error).toBe("未找到 Codex CLI")
  })

  it("returns a stable error when spawning codex throws ENOENT", async () => {
    const spawnError = Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" })
    const runtimeDeps = makeRuntimeDeps({
      processRunner: {
        run: vi.fn().mockRejectedValue(spawnError),
      },
    })

    const result = await codexNodeExecutor.execute(makeInput({}, runtimeDeps))

    expect(result.status).toBe("failed")
    expect(result.error).toBe("未找到 Codex CLI")
  })

  it("falls back to stdout when last-message.txt is missing", async () => {
    const runtimeDeps = makeRuntimeDeps()

    const result = await codexNodeExecutor.execute(makeInput({}, runtimeDeps))

    expect(result.status).toBe("success")
    expect(result.output).toBe("stdout answer")
    expect(result.outputs?.codexDebug).not.toHaveProperty("lastMessagePath")
  })

  it("does not use raw JSONL stdout as successful fallback output", async () => {
    const runtimeDeps = makeRuntimeDeps({
      processRunner: {
        run: vi.fn().mockResolvedValue({
          exitCode: 0,
          signal: null,
          stdout: JSON.stringify({ type: "tool.result", content: "raw tool output token=secret" }),
          stderr: "",
          timedOut: false,
          durationMs: 25,
        }),
      },
    })

    const result = await codexNodeExecutor.execute(makeInput({}, runtimeDeps))

    expect(result.status).toBe("success")
    expect(result.output).toBe("")
    expect(JSON.stringify(result)).not.toContain("token=secret")
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

  it("skips persistent artifacts when captureDebugArtifacts is false", async () => {
    let capturedLastMessagePath: string | undefined
    const runtimeDeps = makeRuntimeDeps({
      processRunner: {
        run: vi.fn().mockImplementation(async (request: { args?: readonly string[] }) => {
          const lastMessagePathIndex = request.args?.indexOf("--output-last-message") ?? -1
          const lastMessagePath = lastMessagePathIndex >= 0 ? request.args?.[lastMessagePathIndex + 1] : undefined
          capturedLastMessagePath = lastMessagePath
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
    const codexDebug = result.outputs?.codexDebug as { readonly args?: readonly string[] } | undefined

    expect(result.status).toBe("success")
    expect(result.output).toBe("final answer from file")
    expect(result.outputs?.codexDebug).not.toHaveProperty("lastMessagePath")
    expect(result.outputs?.codexDebug).not.toHaveProperty("promptPath")
    expect(result.outputs?.codexDebug).not.toHaveProperty("stdoutPath")
    expect(result.outputs?.codexDebug).not.toHaveProperty("stderrPath")
    expect(codexDebug?.args).toContain("--output-last-message")
    expect(codexDebug?.args).toContain("[temporary last-message path]")
    expect(capturedLastMessagePath).toBeDefined()
    expect(codexDebug?.args).not.toContain(capturedLastMessagePath)
    expect(capturedLastMessagePath).not.toBe(artifactPaths.lastMessagePath)
    await expect(access(capturedLastMessagePath!)).rejects.toThrow()
    await expect(access(artifactPaths.lastMessagePath)).rejects.toThrow()
    await expect(access(artifactPaths.promptPath)).rejects.toThrow()
    await expect(access(artifactPaths.stdoutPath)).rejects.toThrow()
    await expect(access(artifactPaths.stderrPath)).rejects.toThrow()
  })
})
