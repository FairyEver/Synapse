import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => "/tmp" } }))

import { SubgraphRunner } from "../workflow/subgraph-runner"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"
import { promptNodeManifest, promptNodeExecutor } from "../../../workflow-nodes/prompt"
import { endNodeManifest, endNodeExecutor } from "../../../workflow-nodes/end"
import type { SubgraphDefinition } from "../../../workflow-nodes/types"
import type { WorkflowNode, WorkflowEdge } from "../../../src/types/workflow"

const nodeRegistry = nodeTypeRegistry
nodeTypeRegistry.register(promptNodeManifest, promptNodeExecutor)
nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)

const promptNode = (id: string, name: string, prompt = "hello", vars = []): WorkflowNode => ({
  id, name, type: "prompt", position: { x: 0, y: 0 },
  config: { providerId: "test-provider", modelTier: "sonnet", variables: vars, prompt },
})
const endNode = (id: string, name: string): WorkflowNode => ({
  id, name, type: "end", position: { x: 100, y: 0 },
  config: { outputType: "text", template: "done: {{out}}", variables: [] },
})

describe("SubgraphRunner", () => {
  it("executes a simple chain and returns success", async () => {
    const subgraph: SubgraphDefinition = {
      nodes: [promptNode("a", "A"), endNode("end", "End")],
      edges: [{ id: "e1", from: "a", to: "end" }],
      outputMappings: [],
    }
    const runner = new SubgraphRunner()
    const result = await runner.run({
      subgraph, contextVariables: {},
      nodeRegistry, agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "success" as const, response: "hello", durationMs: 5 }) },
      abortSignal: new AbortController().signal,
    })
    expect(result.status).toBe("success")
    expect(result.nodeResults["a"]?.status).toBe("success")
  })

  it("returns failed status when subgraph node fails", async () => {
    const subgraph: SubgraphDefinition = {
      nodes: [promptNode("a", "A"), endNode("end", "End")],
      edges: [{ id: "e1", from: "a", to: "end" }],
      outputMappings: [],
    }
    const runner = new SubgraphRunner()
    const result = await runner.run({
      subgraph, contextVariables: {},
      nodeRegistry,
      agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "failed" as const, response: "", error: "boom", durationMs: 0 }) },
      abortSignal: new AbortController().signal,
    })
    expect(result.status).toBe("failed")
  })

  it("returns cancelled when abortSignal fires", async () => {
    const ctrl = new AbortController()
    const subgraph: SubgraphDefinition = {
      nodes: [promptNode("a", "A"), endNode("end", "End")],
      edges: [{ id: "e1", from: "a", to: "end" }],
      outputMappings: [],
    }
    ctrl.abort()
    const runner = new SubgraphRunner()
    const result = await runner.run({
      subgraph, contextVariables: {},
      nodeRegistry, agentDeps: { sendToAgent: vi.fn() },
      abortSignal: ctrl.signal,
    })
    expect(result.status).toBe("cancelled")
  })
})
