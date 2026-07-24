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
import { switchNodeManifest } from "../../../workflow-nodes/switch"
import type { WorkflowDefinition, WorkflowEvent } from "../../../src/types/workflow"

nodeTypeRegistry.register(promptNodeManifest, promptNodeExecutor)
nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)
nodeTypeRegistry.register(switchNodeManifest, {
  async execute(input) {
    const start = Date.now()
    const { config } = input
    const branches = (config as Record<string, unknown>)["branches"] as Array<{ id: string }>
    const defaultBranch = (config as Record<string, unknown>)["defaultBranch"] as string | undefined
    const activeBranch = defaultBranch ?? branches[0]?.id ?? ""
    return { status: "success", output: activeBranch, activeBranch, durationMs: Date.now() - start }
  },
})

const nodeA = { id: "a", name: "A", type: "prompt", position: { x: 0, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "hi" } }
const nodeB = { id: "b", name: "B", type: "prompt", position: { x: 200, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "bye" } }
const nodeEnd = { id: "end", name: "结束", type: "end", position: { x: 400, y: 0 }, config: { outputType: "text", template: "done", variables: [] } }

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
      id: "wf1", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [],
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

  it("emits a sanitized workflow failure when preparation throws", async () => {
    const def = {
      id: "wf-bad",
      name: "WF",
      version: "v1",
      createdAt: 0,
      updatedAt: 0,
      layoutDirection: "horizontal" as const,
      params: [],
      nodes: [null],
      edges: [],
    } as unknown as WorkflowDefinition
    const events: WorkflowEvent[] = []
    const engine = new WorkflowEngine(fakeAgent("unused"))

    const result = await engine.run(def, {}, "run-bad", (event) => events.push(event))

    expect(result.status).toBe("failed")
    const failed = events.find((event) => event.type === "workflow:failed")
    expect(failed).toMatchObject({ type: "workflow:failed", runId: "run-bad" })
    expect(JSON.stringify(failed)).not.toContain("/Users/")
  })

  it("populates WorkflowRunResult.output from end node template", async () => {
    const def: WorkflowDefinition = {
      id: "wf-out", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [],
      nodes: [nodeA, { ...nodeEnd, config: { outputType: "text", template: "result: done", variables: [] } }],
      edges: [{ id: "e1", from: "a", to: "end" }],
    }
    const engine = new WorkflowEngine(fakeAgent("hello"))
    const result = await engine.run(def, {}, "run-out", () => {})
    expect(result.status).toBe("completed")
    expect(result.output).toBe("result: done")
  })

  it("passes workflow call stack into node execution context", async () => {
    const seenStacks: unknown[] = []
    nodeTypeRegistry.register({
      type: "stack_probe",
      title: "Stack Probe",
      icon: promptNodeManifest.icon,
      color: "bg-primary/10",
      defaultConfig: {},
      ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
      cardSummary: () => ({ title: "Stack Probe", subtitle: "" }),
      configFields: [],
      configSchema: { parse: (value: unknown) => value, safeParse: (value: unknown) => ({ success: true, data: value }) } as never,
      share: {
        selfContained: true,
        capability: { id: "workflow.node.stack_probe", minVersion: "1.0.0" },
      },
    }, {
      async execute(input) {
        seenStacks.push(input.context.workflowCallStack)
        return { status: "success", output: "probe", durationMs: 1 }
      },
    })

    const def: WorkflowDefinition = {
      id: "wf-stack",
      name: "Stack WF",
      version: "v1",
      createdAt: 0,
      updatedAt: 0,
      layoutDirection: "horizontal" as const,
      params: [],
      nodes: [
        { id: "probe", name: "Probe", type: "stack_probe", position: { x: 0, y: 0 }, config: {} },
        nodeEnd,
      ],
      edges: [{ id: "e1", from: "probe", to: "end" }],
    }

    const engine = new WorkflowEngine(fakeAgent("unused"))
    await engine.run(def, {}, "run-stack", () => {}, undefined, undefined, "test", undefined, [
      { workflowId: "parent", workflowName: "Parent" },
      { workflowId: "wf-stack", workflowName: "Stack WF" },
    ])

    expect(seenStacks).toEqual([[
      { workflowId: "parent", workflowName: "Parent" },
      { workflowId: "wf-stack", workflowName: "Stack WF" },
    ]])
  })

  it("stores workflow usage cost snapshots from Agent Runtime local cost metadata", async () => {
    const def: WorkflowDefinition = {
      id: "wf-usage", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [],
      nodes: [nodeA, nodeEnd],
      edges: [{ id: "e1", from: "a", to: "end" }],
    }
    const events: WorkflowEvent[] = []
    const usage = {
      input_tokens: 10,
      output_tokens: 2,
      cache_read_input_tokens: 30,
      cache_creation_input_tokens: 4,
    }
    const engine = new WorkflowEngine({
      sendToAgent: vi.fn().mockResolvedValue({
        status: "success" as const,
        response: "hello",
        durationMs: 5,
        usage,
        modelName: "test-model-v1",
        costUsd: 0.01,
        costCny: 0.0147,
        costBreakdownCny: {
          input: 0.01,
          output: 0.004,
          cacheRead: 0.0003,
          cacheWrite: 0.0004,
          reasoning: 0,
        },
        costCurrency: "CNY" as const,
      }),
    })

    const result = await engine.run(def, {}, "run-usage", (event) => events.push(event))
    const completedNode = events.find((event) => event.type === "node:completed" && event.nodeId === "a")

    expect(result.nodeResults.a).toMatchObject({
      usage,
      costUsd: 0.01,
      costCny: 0.0147,
      usageCost: {
        modelName: "test-model-v1",
        costCny: 0.0147,
        costBreakdownCny: {
          input: 0.01,
          output: 0.004,
          cacheRead: 0.0003,
          cacheWrite: 0.0004,
          reasoning: 0,
        },
        costCurrency: "CNY",
        priceKnown: true,
        estimatedCost: true,
      },
    })
    expect(completedNode).toMatchObject({
      type: "node:completed",
      result: expect.objectContaining({
        usage,
        costCny: 0.0147,
        usageCost: expect.objectContaining({ costCny: 0.0147 }),
      }),
    })
    expect(logger.info).toHaveBeenCalledWith("node succeeded", expect.objectContaining({
      usage,
      costUsd: 0.01,
      costCny: 0.0147,
      usageCost: expect.objectContaining({ costCny: 0.0147 }),
    }))
  })

  it("logs aggregate usage and total cost when workflow completes", async () => {
    const def: WorkflowDefinition = {
      id: "wf-aggregate-usage", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [],
      nodes: [nodeA, nodeB, nodeEnd],
      edges: [{ id: "e1", from: "a", to: "b" }, { id: "e2", from: "b", to: "end" }],
    }
    const agent = {
      sendToAgent: vi.fn()
        .mockResolvedValueOnce({
          status: "success" as const,
          response: "hello",
          durationMs: 5,
          usage: { input_tokens: 10, output_tokens: 2 },
          costUsd: 0.01,
        })
        .mockResolvedValueOnce({
          status: "success" as const,
          response: "bye",
          durationMs: 5,
          usage: { input_tokens: 5, cache_read_input_tokens: 30, ignored: "text" },
          costUsd: 0.02,
        }),
    }

    await new WorkflowEngine(agent).run(def, {}, "run-aggregate-usage", () => {})

    expect(logger.info).toHaveBeenCalledWith("workflow run completed", expect.objectContaining({
      runId: "run-aggregate-usage",
      totalCostUsd: 0.03,
      usage: {
        input_tokens: 15,
        output_tokens: 2,
        cache_read_input_tokens: 30,
      },
    }))
  })

  it("does not treat bare SDK cost fields as Synapse workflow cost snapshots", async () => {
    const def: WorkflowDefinition = {
      id: "wf-sdk-cost", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [],
      nodes: [nodeA, nodeEnd],
      edges: [{ id: "e1", from: "a", to: "end" }],
    }
    const usage = { input_tokens: 10, output_tokens: 2 }
    const engine = new WorkflowEngine({
      sendToAgent: vi.fn().mockResolvedValue({
        status: "success" as const,
        response: "hello",
        durationMs: 5,
        usage,
        modelName: "unknown-model",
        costCny: 99,
      }),
    })

    const result = await engine.run(def, {}, "run-sdk-cost", () => {})

    expect(result.nodeResults.a).toMatchObject({
      usage,
      costCny: 99,
      usageCost: {
        modelName: "unknown-model",
        priceKnown: false,
        estimatedCost: false,
      },
    })
    expect(result.nodeResults.a.usageCost).not.toHaveProperty("costCny")
  })

  it("stores unpriced workflow usage snapshots without CNY cost", async () => {
    const def: WorkflowDefinition = {
      id: "wf-unpriced", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [],
      nodes: [nodeA, nodeEnd],
      edges: [{ id: "e1", from: "a", to: "end" }],
    }
    const usage = { input_tokens: 10, output_tokens: 2 }
    const engine = new WorkflowEngine({
      sendToAgent: vi.fn().mockResolvedValue({
        status: "success" as const,
        response: "hello",
        durationMs: 5,
        usage,
        modelName: "unknown-model",
      }),
    })

    const result = await engine.run(def, {}, "run-unpriced", () => {})

    expect(result.nodeResults.a).toMatchObject({
      usage,
      usageCost: {
        modelName: "unknown-model",
        priceKnown: false,
        estimatedCost: false,
      },
    })
    expect(result.nodeResults.a.usageCost).not.toHaveProperty("costCny")
  })

  it("emits and stores Agent conversation targets for AI nodes", async () => {
    const target = {
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "workflow:project-1:123",
      platform: "workflow" as const,
    }
    const def: WorkflowDefinition = {
      id: "wf-agent-target", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [],
      nodes: [nodeA, nodeEnd],
      edges: [{ id: "e1", from: "a", to: "end" }],
    }
    const engine = new WorkflowEngine({
      sendToAgent: vi.fn(async (input: { onConversationCreated?: (conversationTarget: typeof target) => void }) => {
        input.onConversationCreated?.(target)
        return {
          status: "success" as const,
          response: "hello",
          durationMs: 5,
          agentConversation: target,
        }
      }),
    })
    const events: WorkflowEvent[] = []

    const result = await engine.run(def, {}, "run-agent-target", (event) => events.push(event))

    expect(events).toContainEqual({
      type: "node:agent-conversation",
      runId: "run-agent-target",
      nodeId: "a",
      target,
    })
    expect(result.nodeResults.a.outputs?.agentConversation).toEqual(target)
    const completedNode = events.find((event) => event.type === "node:completed" && event.nodeId === "a")
    expect(completedNode).toMatchObject({
      type: "node:completed",
      result: expect.objectContaining({
        outputs: { agentConversation: target },
      }),
    })
  })

  it("logs usage and cost when a node fails", async () => {
    const usage = { input_tokens: 12, output_tokens: 3 }
    nodeTypeRegistry.register(
      { ...promptNodeManifest, type: "costly-failure" },
      { execute: vi.fn().mockResolvedValue({ status: "failed", error: "agent failed", durationMs: 5, usage, costUsd: 0.02 }) },
    )
    const failingNode = {
      ...nodeA,
      id: "costly-failure",
      type: "costly-failure",
    }
    const def: WorkflowDefinition = {
      id: "wf-costly-failure", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [],
      nodes: [failingNode, nodeEnd],
      edges: [{ id: "e1", from: "costly-failure", to: "end" }],
    }

    await new WorkflowEngine(fakeAgent("unused")).run(def, {}, "run-costly-failure", () => {})

    expect(logger.warn).toHaveBeenCalledWith("node failed", expect.objectContaining({
      usage,
      costUsd: 0.02,
    }))
    expect(logger.error).toHaveBeenCalledWith("workflow run failed", expect.objectContaining({
      totalCostUsd: 0.02,
      usage,
    }))
  })

  it("skips nodes not connected to end node", async () => {
    const orphan = { id: "orphan", name: "Orphan", type: "prompt", position: { x: 0, y: 200 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "orphan" } }
    const def: WorkflowDefinition = {
      id: "wf-prune", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [],
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
    const def: WorkflowDefinition = { id: "wf2", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [], nodes: [nodeA, nodeEnd], edges: [{ id: "e1", from: "a", to: "end" }] }
    const engine = new WorkflowEngine(fakeAgent("x"), ctrl.signal)
    const result = await engine.run(def, {}, "run2", () => {})
    expect(result.status).toBe("cancelled")
  })

  it("keeps not-started downstream nodes cancelled when the run is cancelled", async () => {
    const ctrl = new AbortController()
    nodeTypeRegistry.register(
      { ...promptNodeManifest, type: "abort-on-start" },
      {
        execute: vi.fn().mockImplementation(async () => {
          ctrl.abort()
          return { status: "success" as const, output: "started", durationMs: 1 }
        }),
      },
    )
    const abortingNode = {
      ...nodeA,
      id: "abort",
      name: "Abort",
      type: "abort-on-start",
    }
    const def: WorkflowDefinition = {
      id: "wf-cancel-downstream", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [],
      nodes: [abortingNode, nodeB, nodeEnd],
      edges: [{ id: "e1", from: "abort", to: "b" }, { id: "e2", from: "b", to: "end" }],
    }
    const events: WorkflowEvent[] = []
    const engine = new WorkflowEngine(fakeAgent("unused"), ctrl.signal)

    const result = await engine.run(def, {}, "run-cancel-downstream", (event) => events.push(event))

    expect(result.status).toBe("cancelled")
    expect(result.nodeResults.abort?.status).toBe("cancelled")
    expect(result.nodeResults.b).toMatchObject({ status: "cancelled", error: "运行被取消" })
    expect(result.nodeResults.end).toMatchObject({ status: "cancelled", error: "运行被取消" })
    expect(events.some((event) => event.type === "node:skipped" && (event.nodeId === "b" || event.nodeId === "end"))).toBe(false)
  })

  it("marks node failed and short-circuits when executor fails", async () => {
    const def: WorkflowDefinition = { id: "wf3", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [], nodes: [nodeA, nodeB, nodeEnd], edges: [{ id: "e1", from: "a", to: "b" }, { id: "e2", from: "b", to: "end" }] }
    const events: WorkflowEvent[] = []
    const engine = new WorkflowEngine({ sendToAgent: vi.fn().mockResolvedValue({ status: "failed" as const, response: "", error: "boom", durationMs: 0 }) })
    const result = await engine.run(def, {}, "run3", (e) => events.push(e))
    expect(result.status).toBe("failed")
    expect(events.some((e) => e.type === "node:failed")).toBe(true)
    expect(events.some((e) => e.type === "node:skipped")).toBe(true)
  })

  it("does not run downstream nodes after parallel root failures", async () => {
    const def: WorkflowDefinition = { id: "wf4", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [], nodes: [nodeA, { ...nodeB, config: { ...nodeB.config, prompt: "second" } }, nodeEnd], edges: [{ id: "e1", from: "a", to: "end" }, { id: "e2", from: "b", to: "end" }] }
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
    const secretError = "agent failed at /Users/liyang/private/source.txt with token=raw-error"
    const def: WorkflowDefinition = {
      id: "wf-logs",
      name: "WF",
      version: "v1",
      createdAt: 0,
      updatedAt: 0,
      layoutDirection: "horizontal" as const,
      params: [{ name: "apiToken", type: "text", default: null }],
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
    expect(logPayload).not.toContain("/Users/liyang/private/source.txt")
    expect(logPayload).not.toContain("raw-error")
    expect(logPayload).not.toContain("apiToken")
    expect(logger.info).toHaveBeenCalledWith("workflow run started", expect.objectContaining({
      workflowId: "wf-logs",
      nodeCount: 2,
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
      id: "wf-trigger", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [],
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
    const rawError = "SDK error at /Users/liyang/private/source.txt with token=raw-throw"
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
      layoutDirection: "horizontal" as const,
      params: [],
      nodes: [throwingNode, nodeEnd],
      edges: [{ id: "e1", from: "throwing", to: "end" }],
    }
    const events: WorkflowEvent[] = []

    const result = await new WorkflowEngine(fakeAgent("unused"))
      .run(def, {}, "run-throw", (event) => events.push(event), undefined, undefined, "scheduler")

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
      triggerSource: "scheduler",
    }))
    const throwLog = logger.warn.mock.calls.find(([message]) => message === "node threw exception")
    const serializedThrowLog = JSON.stringify(throwLog)
    expect(serializedThrowLog).not.toContain("/Users/liyang/private/source.txt")
    expect(serializedThrowLog).not.toContain("raw-throw")
  })

  it("runs parallel roots A,B simultaneously before C (end node)", async () => {
    const nodeC = { id: "c", name: "C", type: "prompt", position: { x: 100, y: 100 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "c" } }
    const def: WorkflowDefinition = {
      id: "wf-par", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [],
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
      layoutDirection: "horizontal" as const,
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
      layoutDirection: "horizontal" as const,
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

  it("falls back to workflow project when node projectId is blank", async () => {
    const nodeWithBlankProject = {
      id: "blank-project",
      name: "Blank Project",
      type: "prompt",
      position: { x: 0, y: 0 },
      config: { providerId: "test-provider", modelTier: "sonnet", projectId: "", variables: [], prompt: "test" },
    }
    const def: WorkflowDefinition = {
      id: "wf-project-default", name: "WF", version: "v1", createdAt: 0, updatedAt: 0,
      layoutDirection: "horizontal" as const,
      defaultProjectId: "workflow-project",
      params: [],
      nodes: [nodeWithBlankProject, nodeEnd],
      edges: [{ id: "e1", from: "blank-project", to: "end" }],
    }
    const agent = fakeAgent("ok")
    const engine = new WorkflowEngine(agent)
    await engine.run(def, {}, "run-project-default", () => {}, undefined, "workflow-project")
    expect(agent.sendToAgent).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "workflow-project" }),
    )
  })

  it("resolves Agent timeout from workflow default when node omits it", async () => {
    const nodeNoTimeout = { id: "nt", name: "NT", type: "prompt", position: { x: 0, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "test" } }
    const def: WorkflowDefinition = {
      id: "wf-default-timeout", name: "WF", version: "v1", createdAt: 0, updatedAt: 0,
      layoutDirection: "horizontal" as const,
      defaultNodeTimeoutMins: 45,
      params: [],
      nodes: [nodeNoTimeout, nodeEnd],
      edges: [{ id: "e1", from: "nt", to: "end" }],
    }
    const agent = fakeAgent("ok")
    const engine = new WorkflowEngine(agent)
    await engine.run(def, {}, "run-timeout-default", () => {})
    expect(agent.sendToAgent).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMins: 45 }),
    )
  })

  it("falls back to one-hour Agent timeout when workflow and node omit it", async () => {
    const nodeNoTimeout = { id: "nt", name: "NT", type: "prompt", position: { x: 0, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "test" } }
    const def: WorkflowDefinition = {
      id: "wf-timeout-fallback", name: "WF", version: "v1", createdAt: 0, updatedAt: 0,
      layoutDirection: "horizontal" as const,
      params: [],
      nodes: [nodeNoTimeout, nodeEnd],
      edges: [{ id: "e1", from: "nt", to: "end" }],
    }
    const agent = fakeAgent("ok")
    const engine = new WorkflowEngine(agent)
    await engine.run(def, {}, "run-timeout-fallback", () => {})
    expect(agent.sendToAgent).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMins: 60 }),
    )
  })

  it("node-level Agent timeout takes priority over workflow default", async () => {
    const nodeWithTimeout = { id: "wt", name: "WT", type: "prompt", position: { x: 0, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "test", timeoutMins: 5 } }
    const def: WorkflowDefinition = {
      id: "wf-timeout-override", name: "WF", version: "v1", createdAt: 0, updatedAt: 0,
      layoutDirection: "horizontal" as const,
      defaultNodeTimeoutMins: 45,
      params: [],
      nodes: [nodeWithTimeout, nodeEnd],
      edges: [{ id: "e1", from: "wt", to: "end" }],
    }
    const agent = fakeAgent("ok")
    const engine = new WorkflowEngine(agent)
    await engine.run(def, {}, "run-timeout-override", () => {})
    expect(agent.sendToAgent).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMins: 5 }),
    )
  })

  it("does not use workflow id as a fallback project id for node executors", async () => {
    const execute = vi.fn().mockResolvedValue({ status: "success" as const, output: "ok", durationMs: 1 })
    nodeTypeRegistry.register(
      { ...promptNodeManifest, type: "project-capture" },
      { execute },
    )
    const def: WorkflowDefinition = {
      id: "wf-not-project", name: "WF", version: "v1", createdAt: 0, updatedAt: 0,
      layoutDirection: "horizontal" as const,
      params: [],
      nodes: [
        { id: "capture", name: "Capture", type: "project-capture", position: { x: 0, y: 0 }, config: { variables: [], prompt: "test" } },
        nodeEnd,
      ],
      edges: [{ id: "e1", from: "capture", to: "end" }],
    }

    const engine = new WorkflowEngine(fakeAgent("unused"))
    await engine.run(def, {}, "run-project", () => {})

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({
        projectId: undefined,
        workflowId: "wf-not-project",
        workflowName: "WF",
        runId: "run-project",
        nodeId: "capture",
        nodeName: "Capture",
      }),
    }))
  })

  it("parallel root failure skips downstream but lets other running nodes finish", async () => {
    const nodeC = { id: "c", name: "C", type: "prompt", position: { x: 100, y: 100 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "c" } }
    const def: WorkflowDefinition = {
      id: "wf-par-fail", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [],
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

  it("executes side-effect branches and waits for them before End", async () => {
    const nodeA1 = { id: "a1", name: "A1", type: "prompt", position: { x: 100, y: -100 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "side1" } }
    const nodeA2 = { id: "a2", name: "A2", type: "prompt", position: { x: 100, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "main" } }
    const nodeA3 = { id: "a3", name: "A3", type: "prompt", position: { x: 100, y: 100 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "side2" } }
    const nodeBB = { id: "bb", name: "BB", type: "prompt", position: { x: 200, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "after-main" } }
    const def: WorkflowDefinition = {
      id: "wf-side", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [],
      nodes: [nodeA, nodeA1, nodeA2, nodeA3, nodeBB, nodeEnd],
      edges: [
        { id: "e1", from: "a", to: "a1" },
        { id: "e2", from: "a", to: "a2" },
        { id: "e3", from: "a", to: "a3" },
        { id: "e4", from: "a2", to: "bb" },
        { id: "e5", from: "bb", to: "end" },
      ],
    }
    const events: WorkflowEvent[] = []
    const engine = new WorkflowEngine(fakeAgent("ok"))
    const result = await engine.run(def, {}, "run-side", (e) => events.push(e))
    expect(result.status).toBe("completed")
    // A1 and A3 should have executed (not skipped)
    expect(result.nodeResults["a1"]?.status).toBe("success")
    expect(result.nodeResults["a3"]?.status).toBe("success")
    // End should be the last node to start
    const startedEvents = events.filter((e) => e.type === "node:started")
    const endStartIdx = startedEvents.findIndex((e) => e.type === "node:started" && e.nodeId === "end")
    const a1StartIdx = startedEvents.findIndex((e) => e.type === "node:started" && e.nodeId === "a1")
    const a3StartIdx = startedEvents.findIndex((e) => e.type === "node:started" && e.nodeId === "a3")
    expect(a1StartIdx).toBeLessThan(endStartIdx)
    expect(a3StartIdx).toBeLessThan(endStartIdx)
  })

  it("executes multi-node side-effect chains and End waits for chain tail", async () => {
    const nodeA1 = { id: "a1", name: "A1", type: "prompt", position: { x: 100, y: -100 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "chain1" } }
    const nodeA1a = { id: "a1a", name: "A1a", type: "prompt", position: { x: 200, y: -100 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "chain2" } }
    const nodeA1b = { id: "a1b", name: "A1b", type: "prompt", position: { x: 300, y: -100 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "chain3" } }
    const nodeA2 = { id: "a2", name: "A2", type: "prompt", position: { x: 100, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "main" } }
    const def: WorkflowDefinition = {
      id: "wf-chain", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [],
      nodes: [nodeA, nodeA1, nodeA1a, nodeA1b, nodeA2, nodeEnd],
      edges: [
        { id: "e1", from: "a", to: "a1" },
        { id: "e2", from: "a1", to: "a1a" },
        { id: "e3", from: "a1a", to: "a1b" },
        { id: "e4", from: "a", to: "a2" },
        { id: "e5", from: "a2", to: "end" },
      ],
    }
    const engine = new WorkflowEngine(fakeAgent("ok"))
    const result = await engine.run(def, {}, "run-chain", () => {})
    expect(result.status).toBe("completed")
    expect(result.nodeResults["a1"]?.status).toBe("success")
    expect(result.nodeResults["a1a"]?.status).toBe("success")
    expect(result.nodeResults["a1b"]?.status).toBe("success")
  })

  it("fails workflow when a side-effect branch node fails", async () => {
    const nodeA1 = { id: "a1", name: "A1", type: "prompt", position: { x: 100, y: -100 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "side" } }
    const nodeA2 = { id: "a2", name: "A2", type: "prompt", position: { x: 100, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "main" } }
    const def: WorkflowDefinition = {
      id: "wf-side-fail", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [],
      nodes: [nodeA, nodeA1, nodeA2, nodeEnd],
      edges: [
        { id: "e1", from: "a", to: "a1" },
        { id: "e2", from: "a", to: "a2" },
        { id: "e3", from: "a2", to: "end" },
      ],
    }
    let callCount = 0
    const agent = {
      sendToAgent: vi.fn().mockImplementation(() => {
        callCount++
        // A succeeds, A1 fails, A2 succeeds
        if (callCount === 1) return Promise.resolve({ status: "success" as const, response: "ok", durationMs: 1 })
        if (callCount === 2) return Promise.resolve({ status: "failed" as const, response: "", error: "side boom", durationMs: 1 })
        return Promise.resolve({ status: "success" as const, response: "ok", durationMs: 1 })
      }),
    }
    const engine = new WorkflowEngine(agent)
    const result = await engine.run(def, {}, "run-side-fail", () => {})
    expect(result.status).toBe("failed")
  })

  it("End node can reference side-effect branch output via variables", async () => {
    const nodeA1 = { id: "a1", name: "A1", type: "prompt", position: { x: 100, y: -100 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "side" } }
    const nodeA2 = { id: "a2", name: "A2", type: "prompt", position: { x: 100, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "main" } }
    const endWithRef = {
      id: "end", name: "结束", type: "end", position: { x: 400, y: 0 },
      config: {
        outputType: "text",
        template: "side={{sideOut}} main={{mainOut}}",
        variables: [
          { name: "sideOut", source: { type: "node_output", node: "a1" } },
          { name: "mainOut", source: { type: "node_output", node: "a2" } },
        ],
      },
    }
    const def: WorkflowDefinition = {
      id: "wf-side-ref", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [],
      nodes: [nodeA, nodeA1, nodeA2, endWithRef],
      edges: [
        { id: "e1", from: "a", to: "a1" },
        { id: "e2", from: "a", to: "a2" },
        { id: "e3", from: "a2", to: "end" },
      ],
    }
    const engine = new WorkflowEngine(fakeAgent("side-result"))
    const result = await engine.run(def, {}, "run-side-ref", () => {})
    expect(result.status).toBe("completed")
    expect(result.output).toBe("side=side-result main=side-result")
  })

  it("handles diamond side-effect branches (shared leaf)", async () => {
    const nodeA1 = { id: "a1", name: "A1", type: "prompt", position: { x: 100, y: -100 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "s1" } }
    const nodeA3 = { id: "a3", name: "A3", type: "prompt", position: { x: 100, y: 100 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "s2" } }
    const nodeX = { id: "x", name: "X", type: "prompt", position: { x: 200, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "join" } }
    const nodeA2 = { id: "a2", name: "A2", type: "prompt", position: { x: 100, y: 50 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "main" } }
    const def: WorkflowDefinition = {
      id: "wf-diamond", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [],
      nodes: [nodeA, nodeA1, nodeA3, nodeX, nodeA2, nodeEnd],
      edges: [
        { id: "e1", from: "a", to: "a1" },
        { id: "e2", from: "a", to: "a3" },
        { id: "e3", from: "a1", to: "x" },
        { id: "e4", from: "a3", to: "x" },
        { id: "e5", from: "a", to: "a2" },
        { id: "e6", from: "a2", to: "end" },
      ],
    }
    const engine = new WorkflowEngine(fakeAgent("ok"))
    const result = await engine.run(def, {}, "run-diamond", () => {})
    expect(result.status).toBe("completed")
    expect(result.nodeResults["a1"]?.status).toBe("success")
    expect(result.nodeResults["a3"]?.status).toBe("success")
    expect(result.nodeResults["x"]?.status).toBe("success")
  })

  it("main path B starts immediately after A2 without waiting for slow side-effect A1", async () => {
    const nodeA1 = { id: "a1", name: "A1", type: "prompt", position: { x: 100, y: -100 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "slow-side" } }
    const nodeA2 = { id: "a2", name: "A2", type: "prompt", position: { x: 100, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "fast-main" } }
    const nodeBB = { id: "bb", name: "BB", type: "prompt", position: { x: 200, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "after" } }
    const def: WorkflowDefinition = {
      id: "wf-timing", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [],
      nodes: [nodeA, nodeA1, nodeA2, nodeBB, nodeEnd],
      edges: [
        { id: "e1", from: "a", to: "a1" },
        { id: "e2", from: "a", to: "a2" },
        { id: "e3", from: "a2", to: "bb" },
        { id: "e4", from: "bb", to: "end" },
      ],
    }
    const events: WorkflowEvent[] = []
    const agent = {
      sendToAgent: vi.fn().mockImplementation(({ prompt }: { prompt: string }) => {
        if (prompt === "slow-side") {
          return new Promise((r) => setTimeout(() => r({ status: "success" as const, response: "slow", durationMs: 80 }), 80))
        }
        return Promise.resolve({ status: "success" as const, response: "fast", durationMs: 1 })
      }),
    }
    const engine = new WorkflowEngine(agent)
    const result = await engine.run(def, {}, "run-timing", (e) => {
      events.push(e)
    })
    expect(result.status).toBe("completed")
    // BB should start before A1 finishes (BB depends on A2 only, not A1)
    const startedOrder = events.filter((e) => e.type === "node:started").map((e) => (e as { nodeId: string }).nodeId)
    const bbIdx = startedOrder.indexOf("bb")
    const endIdx = startedOrder.indexOf("end")
    // BB starts before End (obvious), and End starts after A1
    expect(bbIdx).toBeLessThan(endIdx)
    // A1 should be the last to complete (slow), so End starts last
    expect(result.nodeResults["a1"]?.status).toBe("success")
  })

  it("behaves identically when no side-effect branches exist (regression)", async () => {
    const def: WorkflowDefinition = {
      id: "wf-no-side", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [],
      nodes: [nodeA, nodeB, nodeEnd],
      edges: [{ id: "e1", from: "a", to: "b" }, { id: "e2", from: "b", to: "end" }],
    }
    const engine = new WorkflowEngine(fakeAgent("hello"))
    const result = await engine.run(def, {}, "run-no-side", () => {})
    expect(result.status).toBe("completed")
    expect(result.nodeResults["a"]?.status).toBe("success")
    expect(result.nodeResults["b"]?.status).toBe("success")
    expect(result.nodeResults["end"]?.status).toBe("success")
  })

  it("routes switch branch to end node correctly", async () => {
    const sw = {
      id: "sw", name: "Switch", type: "switch", position: { x: 100, y: 0 },
      config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "?", branches: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }], defaultBranch: "no" },
    }
    const def: WorkflowDefinition = {
      id: "wf-sw-end", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [],
      nodes: [sw, nodeA, nodeEnd],
      edges: [
        { id: "e1", from: "sw", to: "a", branch: "yes" },
        { id: "e2", from: "sw", to: "end", branch: "no" },
        { id: "e3", from: "a", to: "end" },
      ],
    }
    const engine = new WorkflowEngine(fakeAgent("unused"))
    const result = await engine.run(def, {}, "run-sw-end", () => {})
    expect(result.status).toBe("completed")
    expect(result.nodeResults["sw"]?.activeBranch).toBe("no")
    expect(result.nodeResults["end"]?.status).toBe("success")
    expect(result.nodeResults["a"]?.status).toBe("skipped")
  })

  it("routes switch with both branches to same end node", async () => {
    const sw = {
      id: "sw", name: "Switch", type: "switch", position: { x: 100, y: 0 },
      config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "?", branches: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }], defaultBranch: "no" },
    }
    const def: WorkflowDefinition = {
      id: "wf-sw-both-end", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [],
      nodes: [sw, nodeEnd],
      edges: [
        { id: "e1", from: "sw", to: "end", branch: "yes" },
        { id: "e2", from: "sw", to: "end", branch: "no" },
      ],
    }
    const engine = new WorkflowEngine(fakeAgent("unused"))
    const result = await engine.run(def, {}, "run-sw-both", () => {})
    expect(result.status).toBe("completed")
    expect(result.nodeResults["sw"]?.activeBranch).toBe("no")
    expect(result.nodeResults["end"]?.status).toBe("success")
  })

  it("switch activates correct branch path in diamond graph", async () => {
    const sw = {
      id: "sw", name: "Switch", type: "switch", position: { x: 100, y: 0 },
      config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "?", branches: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }], defaultBranch: "yes" },
    }
    const nodeX = { id: "x", name: "X", type: "prompt", position: { x: 200, y: -50 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "yes-path" } }
    const nodeY = { id: "y", name: "Y", type: "prompt", position: { x: 200, y: 50 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "no-path" } }
    const def: WorkflowDefinition = {
      id: "wf-sw-diamond", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, layoutDirection: "horizontal" as const, params: [],
      nodes: [sw, nodeX, nodeY, nodeEnd],
      edges: [
        { id: "e1", from: "sw", to: "x", branch: "yes" },
        { id: "e2", from: "sw", to: "y", branch: "no" },
        { id: "e3", from: "x", to: "end" },
        { id: "e4", from: "y", to: "end" },
      ],
    }
    const agent = fakeAgent("ok")
    const engine = new WorkflowEngine(agent)
    const result = await engine.run(def, {}, "run-sw-diamond", () => {})
    expect(result.status).toBe("completed")
    expect(result.nodeResults["sw"]?.activeBranch).toBe("yes")
    expect(result.nodeResults["x"]?.status).toBe("success")
    expect(result.nodeResults["y"]?.status).toBe("skipped")
    expect(result.nodeResults["end"]?.status).toBe("success")
  })
})
