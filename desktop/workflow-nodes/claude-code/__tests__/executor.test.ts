import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { beforeEach, describe, expect, it, vi } from "vitest"

const electronState = vi.hoisted(() => ({
  userDataPath: "/tmp/synapse-claude-code-user-data",
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

import { claudeCodeArtifactPaths, readClaudeCodeArtifact } from "../artifacts.main"
import { claudeCodeNodeExecutor } from "../executor.main"
import { defaultClaudeCodeNodeConfig, type ClaudeCodeNodeConfig } from "../schema"
import type { NodeExecutionInput, NodeRuntimeDeps } from "../../types"

const context = {
  projectId: "repo-1",
  workflowId: "wf-1",
  workflowName: "Workflow One",
  runId: "run-1",
  nodeId: "node-1",
  nodeName: "Claude Code",
  abortSignal: new AbortController().signal,
}

let projectWorkspacePath = os.tmpdir()

function makeInput(
  config: Partial<ClaudeCodeNodeConfig> = {},
  runtimeDeps?: NodeRuntimeDeps,
  variables: Record<string, string> = {},
): NodeExecutionInput<ClaudeCodeNodeConfig> {
  return {
    config: {
      ...defaultClaudeCodeNodeConfig,
      prompt: "Summarize {{topic}}",
      ...config,
    },
    resolvedVariables: { topic: "release notes", ...variables },
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
        stdout: JSON.stringify({ type: "result", subtype: "success", result: "final answer" }),
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

describe("claudeCodeNodeExecutor", () => {
  beforeEach(async () => {
    logger.info.mockClear()
    logger.warn.mockClear()
    electronState.userDataPath = await mkdtemp(path.join(os.tmpdir(), "synapse-claude-code-user-data-"))
    projectWorkspacePath = await mkdtemp(path.join(os.tmpdir(), "synapse-claude-code-project-"))
  })

  it("fails when process runner is missing", async () => {
    const result = await claudeCodeNodeExecutor.execute(makeInput({}, {
      sendHttpRequest: vi.fn(),
      resolveProjectWorkspacePath: vi.fn(),
    } as unknown as NodeRuntimeDeps))

    expect(result).toMatchObject({
      status: "failed",
      error: "Claude Code 执行能力不可用",
    })
  })

  it("fails when project is missing", async () => {
    const input = makeInput({}, makeRuntimeDeps())
    input.context = { ...context, projectId: "   " }

    const result = await claudeCodeNodeExecutor.execute(input)

    expect(result).toMatchObject({
      status: "failed",
      error: "Claude Code 节点缺少项目",
    })
  })

  it("fails when workspace resolver is missing", async () => {
    const input = makeInput({}, {
      processRunner: makeRuntimeDeps().processRunner,
      sendHttpRequest: vi.fn(),
    } as NodeRuntimeDeps)

    const result = await claudeCodeNodeExecutor.execute(input)

    expect(result).toMatchObject({
      status: "failed",
      error: "Claude Code 项目路径解析能力不可用",
    })
  })

  it("fails when project workspace path cannot be resolved", async () => {
    const runtimeDeps = makeRuntimeDeps({
      resolveProjectWorkspacePath: vi.fn().mockResolvedValue(null),
    })

    const result = await claudeCodeNodeExecutor.execute(makeInput({}, runtimeDeps))

    expect(result).toMatchObject({
      status: "failed",
      error: "Claude Code 节点项目不存在",
    })
    expect(runtimeDeps.resolveProjectWorkspacePath).toHaveBeenCalledWith("repo-1")
  })

  it("resolves project id to cwd, interpolates prompt, and does not call sendToAgent", async () => {
    const runtimeDeps = makeRuntimeDeps()
    const input = makeInput({}, runtimeDeps)

    const result = await claudeCodeNodeExecutor.execute(input)

    expect(result.status).toBe("success")
    expect(result.output).toBe("final answer")
    expect(input.agentDeps.sendToAgent).not.toHaveBeenCalled()
    expect(runtimeDeps.resolveProjectWorkspacePath).toHaveBeenCalledWith("repo-1")
    expect(runtimeDeps.processRunner.run).toHaveBeenCalledWith(expect.objectContaining({
      command: "claude",
      cwd: projectWorkspacePath,
      args: expect.arrayContaining(["-p", "--permission-mode", "acceptEdits", "Summarize release notes"]),
      metadata: expect.objectContaining({
        source: "workflow",
        actionType: "workflow.claude_code",
        workflowId: "wf-1",
        workflowRunId: "run-1",
        workflowNodeId: "node-1",
      }),
    }))
  })

  it("uses an interpolated workingDirectory as process cwd", async () => {
    const targetDir = await mkdtemp(path.join(os.tmpdir(), "synapse-claude-code-workdir-"))
    const runtimeDeps = makeRuntimeDeps()
    const input = makeInput({ workingDirectory: "{{targetDir}}" }, runtimeDeps, { targetDir })

    const result = await claudeCodeNodeExecutor.execute(input)

    expect(result.status).toBe("success")
    expect(runtimeDeps.processRunner.run).toHaveBeenCalledWith(expect.objectContaining({
      cwd: targetDir,
    }))
  })

  it("fails when workingDirectory resolves to a missing path", async () => {
    const runtimeDeps = makeRuntimeDeps()
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "synapse-claude-code-workdir-parent-"))
    const missingDir = path.join(tempDir, "missing")
    const input = makeInput({ workingDirectory: "{{targetDir}}" }, runtimeDeps, { targetDir: missingDir })

    const result = await claudeCodeNodeExecutor.execute(input)

    expect(result).toMatchObject({
      status: "failed",
      error: "Claude Code 工作目录不存在",
    })
    expect(runtimeDeps.processRunner.run).not.toHaveBeenCalled()
  })

  it("resolves additional directories and config files before spawning", async () => {
    const targetDir = await mkdtemp(path.join(os.tmpdir(), "synapse-claude-code-paths-"))
    const extraDir = path.join(targetDir, "extra")
    const settingsPath = path.join(targetDir, "settings.json")
    const mcpConfigPath = path.join(targetDir, "mcp.json")
    await mkdir(extraDir)
    await writeFile(settingsPath, "{}", "utf8")
    await writeFile(mcpConfigPath, "{}", "utf8")
    const runtimeDeps = makeRuntimeDeps()
    const result = await claudeCodeNodeExecutor.execute(makeInput({
      workingDirectory: targetDir,
      additionalDirectories: ["./extra"],
      settingsPath: "./settings.json",
      mcpConfigPath: "{{mcpConfigPath}}",
    }, runtimeDeps, { mcpConfigPath }))

    expect(result.status).toBe("success")
    expect(runtimeDeps.processRunner.run).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining([
        "--add-dir",
        extraDir,
        "--settings",
        settingsPath,
        "--mcp-config",
        mcpConfigPath,
      ]),
      metadata: expect.objectContaining({
        externalPathResources: [
          expect.objectContaining({
            source: "claude_code.additionalDirectories",
            kind: "directory",
            access: "read_write",
            resolvedPath: extraDir,
            relativeToCwd: "inside",
            pathFingerprint: expect.any(String),
          }),
          expect.objectContaining({
            source: "claude_code.settingsPath",
            kind: "file",
            access: "read",
            resolvedPath: settingsPath,
            relativeToCwd: "inside",
            pathFingerprint: expect.any(String),
          }),
          expect.objectContaining({
            source: "claude_code.mcpConfigPath",
            kind: "file",
            access: "read",
            resolvedPath: mcpConfigPath,
            relativeToCwd: "inside",
            pathFingerprint: expect.any(String),
          }),
        ],
      }),
    }))
  })

  it("fails before spawning when advanced path inputs are missing", async () => {
    const targetDir = await mkdtemp(path.join(os.tmpdir(), "synapse-claude-code-missing-paths-"))
    const runtimeDeps = makeRuntimeDeps()
    const result = await claudeCodeNodeExecutor.execute(makeInput({
      workingDirectory: targetDir,
      additionalDirectories: ["./missing"],
    }, runtimeDeps))

    expect(result).toMatchObject({
      status: "failed",
      error: "Claude Code 额外目录不存在",
    })
    expect(runtimeDeps.processRunner.run).not.toHaveBeenCalled()
  })

  it("streams stdout and stderr into sanitized debug artifacts", async () => {
    const runtimeDeps = makeRuntimeDeps({
      processRunner: {
        run: vi.fn().mockImplementation(async (request: {
          output?: { stdout?: string; stderr?: string }
          onStdoutLine?: (line: string) => void
          onStderrLine?: (line: string) => void
        }) => {
          request.onStdoutLine?.(JSON.stringify({ type: "result", result: "stream answer", session_id: "session-1" }))
          request.onStderrLine?.("warning token=sk-secret at /Users/liyang/project")
          return {
            exitCode: 0,
            signal: null,
            timedOut: false,
            durationMs: 25,
          }
        }),
      },
    })
    const artifactPaths = claudeCodeArtifactPaths(electronState.userDataPath, context.runId, context.nodeId)

    const result = await claudeCodeNodeExecutor.execute(makeInput({}, runtimeDeps))

    expect(result.status).toBe("success")
    expect(result.output).toBe("stream answer")
    const request = vi.mocked(runtimeDeps.processRunner.run).mock.calls[0]?.[0]
    expect(request).toMatchObject({
      output: { stdout: "ignore", stderr: "ignore" },
    })
    expect(request?.onStdoutLine).toEqual(expect.any(Function))
    expect(request?.onStderrLine).toEqual(expect.any(Function))
    expect(result.outputs?.claudeCodeDebug).toMatchObject({
      stdoutPath: artifactPaths.stdoutPath,
      stderrPath: artifactPaths.stderrPath,
      lastMessagePath: artifactPaths.lastMessagePath,
      stdoutPreview: expect.stringContaining("stream answer"),
      sessionHints: ["session_id=session-1"],
    })
    const stderrArtifact = await readClaudeCodeArtifact(artifactPaths.stderrPath)
    expect(stderrArtifact).not.toContain("sk-secret")
  })

  it("normalizes missing CLI errors from process result errors", async () => {
    const runtimeDeps = makeRuntimeDeps({
      processRunner: {
        run: vi.fn().mockResolvedValue({
          exitCode: null,
          signal: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          durationMs: 25,
          error: "spawn claude ENOENT",
        }),
      },
    })

    const result = await claudeCodeNodeExecutor.execute(makeInput({}, runtimeDeps))

    expect(result.status).toBe("failed")
    expect(result.error).toBe("未找到 Claude Code CLI")
  })

  it("normalizes missing CLI errors from thrown spawn errors", async () => {
    const runtimeDeps = makeRuntimeDeps({
      processRunner: {
        run: vi.fn().mockRejectedValue(Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" })),
      },
    })

    const result = await claudeCodeNodeExecutor.execute(makeInput({}, runtimeDeps))

    expect(result.status).toBe("failed")
    expect(result.error).toBe("未找到 Claude Code CLI")
  })

  it("returns sanitized debug output for non-zero exits", async () => {
    const runtimeDeps = makeRuntimeDeps({
      processRunner: {
        run: vi.fn().mockResolvedValue({
          exitCode: 1,
          signal: null,
          timedOut: false,
          durationMs: 10,
          stdout: "Authorization: Bearer sk-secret\ncreated /Users/liyang/project/out.txt",
          stderr: "not authenticated token=sk-secret",
        }),
      },
    })

    const result = await claudeCodeNodeExecutor.execute(makeInput({}, runtimeDeps))

    expect(result.status).toBe("failed")
    expect(result.output).toBe("")
    expect(result.error).toContain("Claude Code 执行失败")
    expect(JSON.stringify(result)).not.toContain("sk-secret")
    expect(JSON.stringify(result)).toContain("/Users/liyang/project/out.txt")
    expect(result.outputs?.claudeCodeDebug).toBeDefined()
  })

  it("returns empty output for timed out processes while keeping claudeCodeDebug", async () => {
    const runtimeDeps = makeRuntimeDeps({
      processRunner: {
        run: vi.fn().mockResolvedValue({
          exitCode: 124,
          signal: null,
          stdout: "partial output\n",
          stderr: "",
          timedOut: true,
          durationMs: 25,
        }),
      },
    })

    const result = await claudeCodeNodeExecutor.execute(makeInput({}, runtimeDeps))

    expect(result).toMatchObject({
      status: "failed",
      output: "",
      error: "Claude Code 执行超时",
    })
    expect(result.outputs?.claudeCodeDebug).toBeDefined()
  })

  it("skips persistent artifacts when captureDebugArtifacts is false", async () => {
    const runtimeDeps = makeRuntimeDeps()
    const input = makeInput({ captureDebugArtifacts: false }, runtimeDeps)
    const artifactPaths = claudeCodeArtifactPaths(electronState.userDataPath, context.runId, context.nodeId)

    const result = await claudeCodeNodeExecutor.execute(input)

    expect(result.status).toBe("success")
    expect(result.outputs?.claudeCodeDebug).not.toHaveProperty("lastMessagePath")
    expect(result.outputs?.claudeCodeDebug).not.toHaveProperty("promptPath")
    expect(result.outputs?.claudeCodeDebug).not.toHaveProperty("stdoutPath")
    expect(result.outputs?.claudeCodeDebug).not.toHaveProperty("stderrPath")
    await expect(readFile(artifactPaths.lastMessagePath, "utf8")).rejects.toThrow()
  })
})
