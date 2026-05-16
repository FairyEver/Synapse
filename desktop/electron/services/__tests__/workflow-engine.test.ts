import { afterEach, describe, expect, it, vi } from "vitest"
import { sanitizeError } from "../error-sanitize"

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => "/tmp" } }))
const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))
vi.mock("../log-store", () => ({
  createMainLogger: () => logger,
}))

import { WorkflowEngine } from "../workflow/workflow-engine"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"
import { promptNodeManifest, promptNodeExecutor } from "../../../workflow-nodes/prompt"
import { endNodeManifest, endNodeExecutor } from "../../../workflow-nodes/end"
import type { WorkflowDefinition, WorkflowEvent } from "../../../src/types/workflow"

nodeTypeRegistry.register(promptNodeManifest, promptNodeExecutor)
nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)

const nodeA = { id: "a", name: "A", type: "prompt", position: { x: 0, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "hi" } }
const nodeB = { id: "b", name: "B", type: "prompt", position: { x: 200, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "{{prev}}" } }
const nodeEnd = { id: "end", name: "结束", type: "end", position: { x: 400, y: 0 }, config: { outputType: "text", template: "done: {{out}}", variables: [] } }

function fakeAgent(response: string) {
  return { sendToAgent: vi.fn().mockResolvedValue({ status: "success" as const, response, durationMs: 5 }) }
}

afterEach(() => {
  logger.info.mockClear()
  logger.warn.mockClear()
  logger.error.mockClear()
})

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
    const orphan = { id: "orphan", name: "Orphan", type: "prompt", position: { x: 0, y: 200 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "orphan" } }
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
    expect(result.nodeResults["orphan"]?.status).toBe("skipped")
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

  it("does not run downstream nodes after parallel root failures", async () => {
    const def: WorkflowDefinition = { id: "wf4", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [], nodes: [nodeA, { ...nodeB, config: { ...nodeB.config, prompt: "second" } }, nodeEnd], edges: [{ id: "e1", from: "a", to: "end" }, { id: "e2", from: "b", to: "end" }] }
    const events: WorkflowEvent[] = []
    const agent = { sendToAgent: vi.fn().mockResolvedValue({ status: "failed" as const, response: "", error: "boom", durationMs: 0 }) }
    const engine = new WorkflowEngine(agent)
    const result = await engine.run(def, {}, "run4", (e) => events.push(e))
    expect(result.status).toBe("failed")
    // Both parallel roots are launched simultaneously
    expect(agent.sendToAgent).toHaveBeenCalledTimes(2)
    // End node should not have been reached
    expect(result.nodeResults.end?.status).not.toBe("success")
  })

  it("logs runtime diagnostics without prompt, params, output, or raw errors", async () => {
    const secretParam = "sk-secret-workflow-param"
    const secretPrompt = `ask with ${secretParam}`
    const secretOutput = "model output with token=raw-output"
    const secretError = "agent failed with authorization=Bearer-secret"
    const def: WorkflowDefinition = {
      id: "wf-logs",
      name: "WF",
      version: "v1",
      createdAt: 0,
      updatedAt: 0,
      params: [{ name: "apiToken", type: "string", required: false }],
      nodes: [
        {
          ...nodeA,
          config: {
            providerId: "test-provider",
            modelTier: "sonnet",
            variables: [{ name: "secret", source: { type: "param", param: "apiToken" } }],
            prompt: "ask with {{secret}}",
          },
        },
        {
          ...nodeEnd,
          config: {
            outputType: "text",
            variables: [{ name: "out", source: { type: "node_output", node: "a" } }],
            template: "done: {{out}}",
          },
        },
      ],
      edges: [{ id: "e1", from: "a", to: "end" }],
    }

    const successEngine = new WorkflowEngine(fakeAgent(secretOutput))
    await successEngine.run(def, { apiToken: secretParam }, "run-logs-success", () => {})

    const failedEngine = new WorkflowEngine({
      sendToAgent: vi.fn().mockResolvedValue({ status: "failed" as const, response: "", error: secretError, durationMs: 0 }),
    })
    await failedEngine.run(def, { apiToken: secretParam }, "run-logs-failed", () => {})

    const engineLogMessages = new Set([
      "workflow run started",
      "node started",
      "node succeeded",
      "node failed",
      "workflow run failed",
      "workflow run completed",
    ])
    const engineInfoCalls = logger.info.mock.calls.filter(([message]) => engineLogMessages.has(message))
    const engineWarnCalls = logger.warn.mock.calls.filter(([message]) => engineLogMessages.has(message))
    const engineErrorCalls = logger.error.mock.calls.filter(([message]) => engineLogMessages.has(message))
    const logPayload = JSON.stringify([engineInfoCalls, engineWarnCalls, engineErrorCalls])
    expect(logPayload).not.toContain(secretParam)
    expect(logPayload).not.toContain(secretPrompt)
    expect(logPayload).not.toContain(secretOutput)
    expect(logPayload).not.toContain(secretError)
    expect(logger.info).toHaveBeenCalledWith("workflow run started", expect.objectContaining({
      paramKeys: ["apiToken"],
      paramCount: 1,
    }))
    expect(logger.info).toHaveBeenCalledWith("node started", expect.objectContaining({
      inputVariableKeys: ["secret"],
      inputVariableCount: 1,
      promptLength: secretPrompt.length,
    }))
    expect(logger.info).toHaveBeenCalledWith("node succeeded", expect.objectContaining({
      outputLength: secretOutput.length,
    }))
    expect(logger.warn).toHaveBeenCalledWith("node failed", expect.objectContaining({
      errorName: "agent",
      errorLength: expect.any(Number),
    }))
    expect(logger.error).toHaveBeenCalledWith("workflow run failed", expect.objectContaining({
      errorName: "workflow",
      errorLength: expect.any(Number),
    }))
  })

  it("logs triggerSource when provided, defaults to unknown otherwise", async () => {
    const def: WorkflowDefinition = {
      id: "wf-trigger", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [],
      nodes: [nodeA, nodeEnd],
      edges: [{ id: "e1", from: "a", to: "end" }],
    }
    const engine = new WorkflowEngine(fakeAgent("ok"))
    await engine.run(def, {}, "run-trigger-known", () => {}, undefined, undefined, "renderer")
    expect(logger.info).toHaveBeenCalledWith("workflow run started", expect.objectContaining({
      triggerSource: "renderer",
    }))
    logger.info.mockClear()
    await engine.run(def, {}, "run-trigger-unknown", () => {})
    expect(logger.info).toHaveBeenCalledWith("workflow run started", expect.objectContaining({
      triggerSource: "unknown",
    }))
  })

  it("summarizes executor exceptions before storing and emitting workflow failure results", async () => {
    const rawError = "SDK error authorization=Bearer-secret prompt=raw-user-prompt"
    nodeTypeRegistry.register(
      { ...promptNodeManifest, type: "throwing-prompt" },
      { execute: vi.fn().mockRejectedValue(new Error(rawError)) },
    )
    const throwingNode = {
      ...nodeA,
      id: "throwing",
      type: "throwing-prompt",
    }
    const def: WorkflowDefinition = {
      id: "wf-throw",
      name: "WF",
      version: "v1",
      createdAt: 0,
      updatedAt: 0,
      params: [],
      nodes: [throwingNode, nodeEnd],
      edges: [{ id: "e1", from: "throwing", to: "end" }],
    }
    const events: WorkflowEvent[] = []

    const result = await new WorkflowEngine(fakeAgent("unused"))
      .run(def, {}, "run-throw", (event) => events.push(event))

    const failedEvent = events.find((event) => event.type === "node:failed")
    const summarizedError = `节点执行异常：${sanitizeError(rawError)}`
    expect(result.nodeResults.throwing?.error).toBe(summarizedError)
    expect(failedEvent).toEqual(expect.objectContaining({
      type: "node:failed",
      error: summarizedError,
    }))
    expect(JSON.stringify(result)).not.toContain(rawError)
    expect(JSON.stringify(events)).not.toContain(rawError)
    expect(logger.warn).toHaveBeenCalledWith("node threw exception", expect.objectContaining({
      errorName: "Error",
      errorLength: rawError.length,
    }))
  })

  it("runs parallel roots A,B simultaneously before C (end node)", async () => {
    const nodeC = { id: "c", name: "C", type: "prompt", position: { x: 100, y: 100 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "c" } }
    const def: WorkflowDefinition = {
      id: "wf-par", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [],
      nodes: [nodeA, nodeC, nodeEnd],
      edges: [{ id: "e1", from: "a", to: "end" }, { id: "e2", from: "c", to: "end" }],
    }
    const events: WorkflowEvent[] = []
    const engine = new WorkflowEngine(fakeAgent("hi"))
    const result = await engine.run(def, {}, "run-par", (e) => events.push(e))
    expect(result.status).toBe("completed")
    const startedEvents = events.filter((e) => e.type === "node:started")
    // Both a and c should start before end
    const aIdx = startedEvents.findIndex((e) => e.type === "node:started" && e.nodeId === "a")
    const cIdx = startedEvents.findIndex((e) => e.type === "node:started" && e.nodeId === "c")
    const endIdx = startedEvents.findIndex((e) => e.type === "node:started" && e.nodeId === "end")
    expect(aIdx).toBeLessThan(endIdx)
    expect(cIdx).toBeLessThan(endIdx)
  })

  it("resolves provider from workflow default when node omits it", async () => {
    const nodeNoProvider = { id: "np", name: "NP", type: "prompt", position: { x: 0, y: 0 }, config: { variables: [], prompt: "test" } }
    const def: WorkflowDefinition = {
      id: "wf-default-provider", name: "WF", version: "v1", createdAt: 0, updatedAt: 0,
      defaultProviderId: "resolved-provider", defaultModelTier: "opus" as const,
      params: [],
      nodes: [nodeNoProvider, nodeEnd],
      edges: [{ id: "e1", from: "np", to: "end" }],
    }
    const agent = fakeAgent("ok")
    const engine = new WorkflowEngine(agent)
    await engine.run(def, {}, "run-resolve", () => {})
    expect(agent.sendToAgent).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "resolved-provider", modelTier: "opus" }),
    )
  })

  it("node-level provider takes priority over workflow default", async () => {
    const nodeWithProvider = { id: "wp", name: "WP", type: "prompt", position: { x: 0, y: 0 }, config: { providerId: "node-provider", modelTier: "haiku", variables: [], prompt: "test" } }
    const def: WorkflowDefinition = {
      id: "wf-override", name: "WF", version: "v1", createdAt: 0, updatedAt: 0,
      defaultProviderId: "wf-provider", defaultModelTier: "opus" as const,
      params: [],
      nodes: [nodeWithProvider, nodeEnd],
      edges: [{ id: "e1", from: "wp", to: "end" }],
    }
    const agent = fakeAgent("ok")
    const engine = new WorkflowEngine(agent)
    await engine.run(def, {}, "run-override", () => {})
    expect(agent.sendToAgent).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "node-provider", modelTier: "haiku" }),
    )
  })

  it("parallel root failure skips downstream but lets other running nodes finish", async () => {
    const nodeC = { id: "c", name: "C", type: "prompt", position: { x: 100, y: 100 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "c" } }
    const def: WorkflowDefinition = {
      id: "wf-par-fail", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [],
      nodes: [nodeA, nodeC, nodeEnd],
      edges: [{ id: "e1", from: "a", to: "end" }, { id: "e2", from: "c", to: "end" }],
    }
    let callCount = 0
    const agent = {
      sendToAgent: vi.fn().mockImplementation(() => {
        callCount++
        // First call succeeds, second fails
        if (callCount === 1) return Promise.resolve({ status: "success" as const, response: "ok", durationMs: 1 })
        return Promise.resolve({ status: "failed" as const, response: "", error: "boom", durationMs: 1 })
      }),
    }
    const engine = new WorkflowEngine(agent)
    const result = await engine.run(def, {}, "run-par-fail", () => {})
    expect(result.status).toBe("failed")
    // Both roots should have been called (parallel — both started before either finished)
    expect(agent.sendToAgent).toHaveBeenCalledTimes(2)
  })
})
