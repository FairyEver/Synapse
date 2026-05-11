import { describe, expect, it, vi } from "vitest"
import { WorkflowEngine } from "../workflow/workflow-engine"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"
import { promptNodeManifest, promptNodeExecutor } from "../../../workflow-nodes/prompt"
import type { WorkflowDefinition, WorkflowEvent } from "../../../src/types/workflow"

nodeTypeRegistry.register(promptNodeManifest, promptNodeExecutor)

const nodeA = { id: "a", name: "A", type: "prompt", position: { x: 0, y: 0 }, config: { agent: "claude-code", variables: [], prompt: "hi" } }
const nodeB = { id: "b", name: "B", type: "prompt", position: { x: 200, y: 0 }, config: { agent: "claude-code", variables: [], prompt: "{{$prev}}" } }

function fakeAgent(response: string) {
  return { sendToAgent: vi.fn().mockResolvedValue({ status: "success" as const, response, durationMs: 5 }) }
}

describe("WorkflowEngine", () => {
  it("runs a two-node chain and emits events", async () => {
    const def: WorkflowDefinition = {
      id: "wf1", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [],
      nodes: [nodeA, nodeB],
      edges: [{ id: "e1", from: "a", to: "b" }],
    }
    const events: WorkflowEvent[] = []
    const engine = new WorkflowEngine(fakeAgent("hello"))
    const result = await engine.run(def, {}, "run1", (e) => events.push(e))
    expect(result.status).toBe("completed")
    expect(events.some((e) => e.type === "workflow:started")).toBe(true)
    expect(events.some((e) => e.type === "workflow:completed")).toBe(true)
    expect(events.filter((e) => e.type === "node:completed")).toHaveLength(2)
  })
  it("aborts when signal fires before start", async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const def: WorkflowDefinition = { id: "wf2", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [], nodes: [nodeA], edges: [] }
    const engine = new WorkflowEngine(fakeAgent("x"), ctrl.signal)
    const result = await engine.run(def, {}, "run2", () => {})
    expect(result.status).toBe("cancelled")
  })
  it("marks node failed and short-circuits when executor fails", async () => {
    const def: WorkflowDefinition = { id: "wf3", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [], nodes: [nodeA, nodeB], edges: [{ id: "e1", from: "a", to: "b" }] }
    const events: WorkflowEvent[] = []
    const engine = new WorkflowEngine({ sendToAgent: vi.fn().mockResolvedValue({ status: "failed" as const, response: "", error: "boom", durationMs: 0 }) })
    const result = await engine.run(def, {}, "run3", (e) => events.push(e))
    expect(result.status).toBe("failed")
    expect(events.some((e) => e.type === "node:failed")).toBe(true)
    expect(events.some((e) => e.type === "node:skipped")).toBe(true)
  })
  it("does not run another start node after a failure", async () => {
    const def: WorkflowDefinition = { id: "wf4", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [], nodes: [nodeA, { ...nodeB, config: { ...nodeB.config, prompt: "second" } }], edges: [] }
    const events: WorkflowEvent[] = []
    const agent = { sendToAgent: vi.fn().mockResolvedValue({ status: "failed" as const, response: "", error: "boom", durationMs: 0 }) }
    const engine = new WorkflowEngine(agent)

    const result = await engine.run(def, {}, "run4", (e) => events.push(e))

    expect(result.status).toBe("failed")
    expect(agent.sendToAgent).toHaveBeenCalledTimes(1)
    expect(result.nodeResults.b?.status).toBe("skipped")
  })
})
