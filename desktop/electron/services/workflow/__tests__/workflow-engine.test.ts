import { describe, expect, it, vi } from "vitest"

import type { WorkflowDefinition } from "../../../../src/types/workflow"
import type { NodeExecutor } from "../../../../workflow-nodes/types"
import { defaultCodexNodeConfig, type CodexNodeConfig } from "../../../../workflow-nodes/codex/schema"
import { defaultClaudeCodeNodeConfig, type ClaudeCodeNodeConfig } from "../../../../workflow-nodes/claude-code/schema"
import { codexNodeManifest } from "../../../../workflow-nodes/codex/manifest"
import { claudeCodeNodeManifest } from "../../../../workflow-nodes/claude-code/manifest"
import { endNodeExecutor } from "../../../../workflow-nodes/end/executor.main"
import { endNodeManifest } from "../../../../workflow-nodes/end/manifest"
import { nodeTypeRegistry } from "../../../../workflow-nodes/registry"
import { workflowCallNodeExecutor } from "../../../../workflow-nodes/workflow-call/executor.main"
import { workflowCallNodeManifest } from "../../../../workflow-nodes/workflow-call/manifest"
import { WorkflowEngine } from "../workflow-engine"

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock("../../log-store", () => ({
  createMainLogger: () => logger,
}))

describe("WorkflowEngine", () => {
  it("applies workflow default timeout to codex nodes with blank timeout", async () => {
    const receivedConfigs: CodexNodeConfig[] = []
    const codexExecutor: NodeExecutor<CodexNodeConfig> = {
      execute: vi.fn(async (input) => {
        receivedConfigs.push(input.config)
        return { status: "success" as const, output: "codex done", durationMs: 1 }
      }),
    }
    nodeTypeRegistry.register(codexNodeManifest, codexExecutor)
    nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)
    const engine = new WorkflowEngine({
      sendToAgent: vi.fn(),
    })

    const result = await engine.run(workflowWithCodexNode(), {}, "run-1", vi.fn(), undefined, "project-1")

    expect(result.status).toBe("completed")
    expect(receivedConfigs[0]?.timeoutMins).toBe(30)
  })

  it("preserves executor outputs when a codex node returns after cancellation", async () => {
    const abortController = new AbortController()
    const codexDebug = {
      command: "codex exec",
      cwd: "/tmp/project",
      stdoutPreview: "partial output",
      stderrPreview: "",
    }
    const codexExecutor: NodeExecutor<CodexNodeConfig> = {
      execute: vi.fn(async () => {
        abortController.abort()
        return {
          status: "cancelled" as const,
          output: "",
          error: "运行被取消",
          durationMs: 9,
          outputs: { codexDebug },
        }
      }),
    }
    nodeTypeRegistry.register(codexNodeManifest, codexExecutor)
    nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)
    const engine = new WorkflowEngine({
      sendToAgent: vi.fn(),
    })

    const result = await engine.run(
      workflowWithCodexNode(),
      {},
      "run-1",
      vi.fn(),
      abortController.signal,
      "project-1",
    )

    expect(result.status).toBe("cancelled")
    expect(result.nodeResults["codex-1"]).toMatchObject({
      status: "cancelled",
      outputs: { codexDebug },
      durationMs: 9,
    })
  })

  it("passes claude code final output to downstream node bindings", async () => {
    const claudeExecutor: NodeExecutor<ClaudeCodeNodeConfig> = {
      execute: vi.fn(async () => ({
        status: "success" as const,
        output: "claude done",
        outputs: {
          claudeCodeDebug: {
            command: "claude -p",
            args: ["-p", "[prompt]"],
            cwd: "/tmp",
            exitCode: 0,
            durationMs: 1,
          },
        },
        durationMs: 1,
      })),
    }
    nodeTypeRegistry.register(claudeCodeNodeManifest, claudeExecutor)
    nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)
    const engine = new WorkflowEngine({
      sendToAgent: vi.fn(),
    })

    const result = await engine.run(workflowWithClaudeCodeNode(), {}, "run-1", vi.fn(), undefined, "project-1")

    expect(result.status).toBe("completed")
    expect(result.nodeResults.end?.output).toBe("claude done")
  })

  it("applies workflow default timeout to claude code nodes with blank timeout", async () => {
    const receivedConfigs: ClaudeCodeNodeConfig[] = []
    const claudeExecutor: NodeExecutor<ClaudeCodeNodeConfig> = {
      execute: vi.fn(async (input) => {
        receivedConfigs.push(input.config)
        return { status: "success" as const, output: "claude done", durationMs: 1 }
      }),
    }
    nodeTypeRegistry.register(claudeCodeNodeManifest, claudeExecutor)
    nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)
    const engine = new WorkflowEngine({
      sendToAgent: vi.fn(),
    })

    const result = await engine.run(workflowWithClaudeCodeNode(), {}, "run-1", vi.fn(), undefined, "project-1")

    expect(result.status).toBe("completed")
    expect(receivedConfigs[0]?.timeoutMins).toBe(30)
  })

  it("passes upstream node outputs to workflow call value bindings", async () => {
    const codexExecutor: NodeExecutor<CodexNodeConfig> = {
      execute: vi.fn(async () => ({
        status: "success" as const,
        output: "/tmp/generated.txt",
        durationMs: 1,
      })),
    }
    const runWorkflow = vi.fn(async () => ({
      runId: "child-run",
      result: { status: "completed" as const, output: "child done", nodeResults: {}, durationMs: 1 },
    }))
    nodeTypeRegistry.register(codexNodeManifest, codexExecutor)
    nodeTypeRegistry.register(workflowCallNodeManifest, workflowCallNodeExecutor)
    nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)
    const engine = new WorkflowEngine({ sendToAgent: vi.fn() }, undefined, {
      processRunner: { run: vi.fn() },
      sendHttpRequest: vi.fn(),
      workflowCall: {
        getWorkflowDefinition: vi.fn(async () => childWorkflowWithFileParam()),
        runWorkflow,
      },
    })

    const result = await engine.run(workflowWithNodeOutputCall(), {}, "run-1", vi.fn(), undefined, "project-1")

    expect(result.status).toBe("completed")
    expect(runWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      params: { input_file: "/tmp/generated.txt" },
    }))
  })
})

function childWorkflowWithFileParam(): WorkflowDefinition {
  return {
    id: "child-1",
    name: "Child",
    version: "v1",
    createdAt: 1,
    updatedAt: 1,
    params: [{ name: "input_file", type: "file", default: null }],
    nodes: [],
    edges: [],
  }
}

function workflowWithNodeOutputCall(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Workflow call",
    version: "v1",
    createdAt: 1,
    updatedAt: 1,
    defaultProjectId: "project-1",
    params: [],
    nodes: [
      {
        id: "prepare",
        name: "Prepare",
        type: "codex",
        position: { x: 0, y: 0 },
        config: { ...defaultCodexNodeConfig, prompt: "Generate" },
      },
      {
        id: "call",
        name: "Call",
        type: "workflow_call",
        position: { x: 200, y: 0 },
        config: {
          workflowId: "child-1",
          variables: [],
          paramTemplates: {},
          paramBindings: {
            input_file: { mode: "value", source: { type: "node_output", node: "prepare" } },
          },
        },
      },
      {
        id: "end",
        name: "End",
        type: "end",
        position: { x: 400, y: 0 },
        config: {
          outputType: "text",
          template: "{{result}}",
          variables: [{ name: "result", source: { type: "node_output", node: "call" } }],
        },
      },
    ],
    edges: [
      { id: "edge-1", from: "prepare", to: "call" },
      { id: "edge-2", from: "call", to: "end" },
    ],
  }
}

function workflowWithCodexNode(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Codex workflow",
    version: "v1",
    createdAt: 1,
    updatedAt: 1,
    defaultProjectId: "project-1",
    defaultNodeTimeoutMins: 30,
    params: [],
    nodes: [
      {
        id: "codex-1",
        name: "Codex",
        type: "codex",
        position: { x: 0, y: 0 },
        config: {
          ...defaultCodexNodeConfig,
          prompt: "Run codex",
        },
      },
      {
        id: "end",
        name: "End",
        type: "end",
        position: { x: 200, y: 0 },
        config: { outputType: "text", template: "{{result}}", variables: [{ name: "result", source: { type: "node_output", node: "codex-1" } }] },
      },
    ],
    edges: [{ id: "edge-1", from: "codex-1", to: "end" }],
  }
}

function workflowWithClaudeCodeNode(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Claude Code workflow",
    version: "v1",
    createdAt: 1,
    updatedAt: 1,
    defaultProjectId: "project-1",
    defaultNodeTimeoutMins: 30,
    params: [],
    nodes: [
      {
        id: "claude-code-1",
        name: "Claude Code",
        type: "claude_code",
        position: { x: 0, y: 0 },
        config: {
          ...defaultClaudeCodeNodeConfig,
          prompt: "Run",
        },
      },
      {
        id: "end",
        name: "End",
        type: "end",
        position: { x: 200, y: 0 },
        config: { outputType: "text", template: "{{result}}", variables: [{ name: "result", source: { type: "node_output", node: "claude-code-1" } }] },
      },
    ],
    edges: [{ id: "edge-1", from: "claude-code-1", to: "end" }],
  }
}
