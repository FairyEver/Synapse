import { describe, expect, it } from "vitest"
import type {
  NodeRunResult,
  WorkflowDefinition,
  WorkflowRunSnapshot,
} from "../../../../src/types/workflow"
import {
  sanitizeWorkflowEventForRenderer,
  sanitizeWorkflowRunSnapshot,
  sanitizeWorkflowRunStatus,
} from "../run-snapshot-sanitize"

const definition: WorkflowDefinition = {
  id: "clipboard-workflow",
  name: "Clipboard",
  version: "v1",
  createdAt: 1,
  updatedAt: 2,
  layoutDirection: "horizontal",
  params: [],
  nodes: [
    {
      id: "read",
      name: "读取剪贴板",
      type: "clipboard_text_read",
      position: { x: 0, y: 0 },
      config: {},
    },
    {
      id: "write",
      name: "写入剪贴板",
      type: "clipboard_text_write",
      position: { x: 100, y: 0 },
      config: {
        text: "token: raw-template {{value}}",
        variables: [{
          name: "value",
          source: { type: "node_output", node: "read" },
        }],
      },
    },
  ],
  edges: [],
}

function readResult(text: string): NodeRunResult {
  return {
    nodeId: "read",
    status: "success",
    input: { variables: {} },
    output: text,
    outputs: { text },
    startedAt: 1,
    endedAt: 2,
    durationMs: 1,
  }
}

describe("Clipboard Workflow history boundary", () => {
  it("omits read content only from persisted snapshots and preserves the author template", () => {
    const text = "private clipboard content"
    const snapshot = sanitizeWorkflowRunSnapshot({
      runId: "run-1",
      workflowId: definition.id,
      workflowName: definition.name,
      version: definition.version,
      status: "completed",
      startedAt: 1,
      endedAt: 2,
      params: {},
      nodeResults: { read: readResult(text) },
      definition,
    } as WorkflowRunSnapshot)

    expect(snapshot.nodeResults.read).toEqual({
      nodeId: "read",
      status: "success",
      input: { variables: {} },
      startedAt: 1,
      endedAt: 2,
      durationMs: 1,
    })
    expect(JSON.stringify(snapshot.nodeResults)).not.toContain(text)
    expect(snapshot.definition?.nodes.find((node) => node.id === "write")?.config)
      .toEqual(definition.nodes[1]?.config)
  })

  it("keeps a bounded read preview in live status and renderer events", () => {
    const text = "中".repeat(40_000)
    const status = sanitizeWorkflowRunStatus({
      workflowId: definition.id,
      runId: "run-1",
      status: "running",
      startedAt: 1,
      nodeResults: { read: readResult(text) },
      definition,
    })
    const liveOutput = status.nodeResults.read?.output ?? ""
    expect(liveOutput.endsWith("[truncated]")).toBe(true)
    expect(Buffer.byteLength(liveOutput, "utf8")).toBeLessThanOrEqual(10_000)

    const event = sanitizeWorkflowEventForRenderer({
      type: "node:completed",
      runId: "run-1",
      nodeId: "read",
      output: text,
      result: readResult(text),
    }, definition)
    expect(event.type).toBe("node:completed")
    if (event.type !== "node:completed") return
    expect((event.output as string).endsWith("[truncated]")).toBe(true)
    expect(event.result?.outputs?.text).toEqual(expect.stringContaining("[truncated]"))
    expect(readResult(text).output).toBe(text)
  })

  it("always hides the resolved write input from live and persisted results", () => {
    const result: NodeRunResult = {
      nodeId: "write",
      status: "success",
      input: { variables: { value: "private value" }, prompt: "private value" },
      output: "{\"success\":true}",
      outputs: { success: true },
    }
    const status = sanitizeWorkflowRunStatus({
      workflowId: definition.id,
      runId: "run-1",
      status: "running",
      startedAt: 1,
      nodeResults: { write: result },
      definition,
    })
    expect(status.nodeResults.write?.input).toEqual({ variables: {} })
    expect(JSON.stringify(status.nodeResults)).not.toContain("private value")
  })
})
