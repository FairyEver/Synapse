import { describe, expect, it } from "vitest"
import { sanitizeNodeResultsForSnapshot, sanitizeWorkflowRunStatus } from "../run-snapshot-sanitize"
import type { WorkflowDefinition } from "../../../../src/types/workflow"

describe("script run content history", () => {
  it("omits input, result, and logs only from persisted snapshots", () => {
    const definition = scriptDefinition(false)
    const nodeResults = {
      script: {
        nodeId: "script",
        status: "success" as const,
        input: { variables: {}, inputs: { token: "visible-in-run" } },
        outputs: { result: { ok: true } },
        logs: [{ label: "console", value: "visible-in-run" }],
        startedAt: 1,
        endedAt: 2,
        durationMs: 1,
      },
    }

    expect(sanitizeNodeResultsForSnapshot(nodeResults, definition).script).toEqual({
      nodeId: "script",
      status: "success",
      input: { variables: {} },
      startedAt: 1,
      endedAt: 2,
      durationMs: 1,
    })

    expect(sanitizeWorkflowRunStatus({
      runId: "run",
      workflowId: definition.id,
      status: "completed",
      nodeResults,
      startedAt: 1,
      endedAt: 2,
      definition,
    }).nodeResults.script).toMatchObject({
      outputs: { result: { ok: true } },
      logs: [{ label: "console", value: "visible-in-run" }],
    })
  })

  it("persists enabled script content without heuristic rewriting", () => {
    const definition = scriptDefinition(true)
    const nodeResults = {
      script: {
        nodeId: "script",
        status: "success" as const,
        input: { variables: {}, inputs: { token: "input-token" } },
        outputs: { result: { apiKey: "result-key", path: "/Users/example/report.json" } },
        logs: [{ label: "console", value: "Authorization: Bearer visible-log" }],
      },
    }

    expect(sanitizeNodeResultsForSnapshot(nodeResults, definition).script).toEqual(nodeResults.script)
  })
})

function scriptDefinition(saveRunContent: boolean): WorkflowDefinition {
  return {
    id: "history",
    name: "History",
    version: "v1",
    createdAt: 1,
    updatedAt: 1,
    meta: { schemaVersion: "2.7.0" },
    params: [],
    edges: [],
    nodes: [{
      id: "script",
      name: "Script",
      type: "javascript_run",
      position: { x: 0, y: 0 },
      config: {
        source: "postMessage(null)",
        inputs: [],
        timeoutSeconds: 60,
        saveRunContent,
      },
    }],
  }
}
