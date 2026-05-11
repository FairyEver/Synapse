import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => "/tmp" } }))

import { WorkflowEngine } from "../workflow/workflow-engine"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"
import { promptNodeManifest, promptNodeExecutor } from "../../../workflow-nodes/prompt"
import { endNodeManifest, endNodeExecutor } from "../../../workflow-nodes/end"
import type { WorkflowDefinition, WorkflowEvent } from "../../../src/types/workflow"

nodeTypeRegistry.register(promptNodeManifest, promptNodeExecutor)
nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)

const nodeA = { id: "a", name: "A", type: "prompt", position: { x: 0, y: 0 }, config: { agent: "claude-code", variables: [], prompt: "hi" } }
const nodeB = { id: "b", name: "B", type: "prompt", position: { x: 200, y: 0 }, config: { agent: "claude-code", variables: [], prompt: "{{prev}}" } }
const nodeEnd = { id: "end", name: "结束", type: "end", position: { x: 400, y: 0 }, config: { outputType: "text", template: "done: {{out}}", variables: [] } }

function fakeAgent(response: string) {
  return { sendToAgent: vi.fn().mockResolvedValue({ status: "success" as const, response, durationMs: 5 }) }
}

describe("WorkflowEngine", () => {
  it("runs a two-node chain with end node and emits events", async () => {
    const def: WorkflowDefinition = {
      id: "wf1", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [],
      nodes: [nodeA, nodeB, nodeEnd],
      edges: [{ id: "e1", from: "a", to: "b" }, { id: "e2", from: "b", to: "end" }],
    }
    const events: WorkflowEvent[] = []
    const engine = new WorkflowEngine(fakeAgent("hello"))
    const result = await engine.run(def, {}, "run1", (e) => events.push(e))
    expect(result.status).toBe("completed")
    expect(events.some((e) => e.type === "workflow:started")).toBe(true)
    expect(events.some((e) => e.type === "workflow:completed")).toBe(true)
    expect(events.filter((e) => e.type === "node:completed")).toHaveLength(3)
  })

  it("populates WorkflowRunResult.output from end node template", async () => {
    const def: WorkflowDefinition = {
      id: "wf-out", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [],
      nodes: [nodeA, { ...nodeEnd, config: { outputType: "text", template: "result: done", variables: [] } }],
      edges: [{ id: "e1", from: "a", to: "end" }],
    }
    const engine = new WorkflowEngine(fakeAgent("hello"))
    const result = await engine.run(def, {}, "run-out", () => {})
    expect(result.status).toBe("completed")
    expect(result.output).toBe("result: done")
  })

  it("skips nodes not connected to end node", async () => {
    const orphan = { id: "orphan", name: "Orphan", type: "prompt", position: { x: 0, y: 200 }, config: { agent: "claude-code", variables: [], prompt: "orphan" } }
    const def: WorkflowDefinition = {
      id: "wf-prune", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [],
      nodes: [nodeA, orphan, nodeEnd],
      edges: [{ id: "e1", from: "a", to: "end" }],
    }
    const agent = fakeAgent("hello")
    const engine = new WorkflowEngine(agent)
    const result = await engine.run(def, {}, "run-prune", () => {})
    expect(result.status).toBe("completed")
    // orphan has no path to end node, so sendToAgent only called once (for nodeA)
    expect(agent.sendToAgent).toHaveBeenCalledTimes(1)
    expect(result.nodeResults["orphan"]).toBeUndefined()
  })

  it("aborts when signal fires before start", async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const def: WorkflowDefinition = { id: "wf2", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [], nodes: [nodeA, nodeEnd], edges: [{ id: "e1", from: "a", to: "end" }] }
    const engine = new WorkflowEngine(fakeAgent("x"), ctrl.signal)
    const result = await engine.run(def, {}, "run2", () => {})
    expect(result.status).toBe("cancelled")
  })

  it("marks node failed and short-circuits when executor fails", async () => {
    const def: WorkflowDefinition = { id: "wf3", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [], nodes: [nodeA, nodeB, nodeEnd], edges: [{ id: "e1", from: "a", to: "b" }, { id: "e2", from: "b", to: "end" }] }
    const events: WorkflowEvent[] = []
    const engine = new WorkflowEngine({ sendToAgent: vi.fn().mockResolvedValue({ status: "failed" as const, response: "", error: "boom", durationMs: 0 }) })
    const result = await engine.run(def, {}, "run3", (e) => events.push(e))
    expect(result.status).toBe("failed")
    expect(events.some((e) => e.type === "node:failed")).toBe(true)
    expect(events.some((e) => e.type === "node:skipped")).toBe(true)
  })

  it("does not run another start node after a failure", async () => {
    const def: WorkflowDefinition = { id: "wf4", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [], nodes: [nodeA, { ...nodeB, config: { ...nodeB.config, prompt: "second" } }, nodeEnd], edges: [{ id: "e1", from: "a", to: "end" }, { id: "e2", from: "b", to: "end" }] }
    const events: WorkflowEvent[] = []
    const agent = { sendToAgent: vi.fn().mockResolvedValue({ status: "failed" as const, response: "", error: "boom", durationMs: 0 }) }
    const engine = new WorkflowEngine(agent)
    const result = await engine.run(def, {}, "run4", (e) => events.push(e))
    expect(result.status).toBe("failed")
    expect(agent.sendToAgent).toHaveBeenCalledTimes(1)
    expect(result.nodeResults.b?.status).toBe("skipped")
  })
})
