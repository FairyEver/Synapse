import { describe, expect, it, vi } from "vitest"

import type { WorkflowDefinition } from "../../../../src/types/workflow"
import type { NodeExecutor } from "../../../../workflow-nodes/types"
import { defaultCodexNodeConfig, type CodexNodeConfig } from "../../../../workflow-nodes/codex/schema"
import { codexNodeManifest } from "../../../../workflow-nodes/codex/manifest"
import { endNodeExecutor } from "../../../../workflow-nodes/end/executor.main"
import { endNodeManifest } from "../../../../workflow-nodes/end/manifest"
import { nodeTypeRegistry } from "../../../../workflow-nodes/registry"
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
})

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
