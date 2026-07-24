import { describe, expect, it, vi } from "vitest"
import { createWorkflowAction } from "../executor.main"
import type { WorkflowDefinition } from "../../../../src/types/workflow"

const definition: WorkflowDefinition = {
  id: "wf-1",
  name: "每日汇总",
  version: "v1",
  createdAt: 1,
  updatedAt: 2,
  layoutDirection: "horizontal" as const,
  params: [{ name: "topic", type: "text", default: null }],
  nodes: [],
  edges: [],
}

const context = {
  taskId: "auto-1",
  taskName: "自动化",
  runId: "auto-run-1",
  triggeredBy: "manual" as const,
  cwd: "/Users/example/project",
  actor: { kind: "user", id: "automation", display: "Automation" } as const,
  abortSignal: new AbortController().signal,
  templateVariables: { "trigger.request.body.title": "发布总结" },
}

describe("workflow action executor", () => {
  it("requests workflow.run permission", () => {
    const action = createWorkflowAction({
      getWorkflowDefinition: vi.fn(),
      runWorkflowAndWait: vi.fn(),
    })

    expect(action.buildPermissionRequest({
      config: { workflowId: "wf-1", paramTemplates: {} },
      context,
    })).toMatchObject({
      action: "workflow.run",
      resource: "builtin.workflow:wf-1",
      actor: context.actor,
    })
  })

  it("runs workflow with rendered params and maps completed result", async () => {
    const runWorkflowAndWait = vi.fn(async () => ({
      runId: "workflow-run-1",
      definition,
      result: { status: "completed" as const, nodeResults: {}, durationMs: 20, output: "完成" },
    }))
    const action = createWorkflowAction({
      getWorkflowDefinition: vi.fn(async () => definition),
      runWorkflowAndWait,
    })

    const result = await action.execute({
      config: { workflowId: "wf-1", paramTemplates: { topic: "{{trigger.request.body.title}}" } },
      context,
    })

    expect(runWorkflowAndWait).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: "wf-1",
      params: { topic: "发布总结" },
      triggerSource: "automation",
      automationId: "auto-1",
      automationRunId: "auto-run-1",
      actor: context.actor,
      expectedVersion: "v1",
    }))
    expect(result).toMatchObject({
      status: "success",
      summary: "工作流完成：每日汇总",
      outputs: {
        workflowId: "wf-1",
        workflowName: "每日汇总",
        workflowRunId: "workflow-run-1",
        workflowStatus: "completed",
        output: "完成",
      },
    })
  })

  it("redacts workflow output before returning action outputs", async () => {
    const runWorkflowAndWait = vi.fn(async () => ({
      runId: "workflow-run-1",
      definition,
      result: {
        status: "completed" as const,
        nodeResults: {},
        durationMs: 20,
        output: [
          "Authorization: Bearer workflow-token",
          "Cookie: session=workflow-cookie",
          "apiKey=workflow-api-key",
          "/Users/liyang/private.txt",
        ].join(" "),
      },
    }))
    const action = createWorkflowAction({
      getWorkflowDefinition: vi.fn(async () => definition),
      runWorkflowAndWait,
    })

    const result = await action.execute({
      config: { workflowId: "wf-1", paramTemplates: { topic: "{{trigger.request.body.title}}" } },
      context,
    })

    expect(result.outputs?.output).toContain("[redacted]")
    expect(result.outputs?.output).toContain("[path]")
    expect(JSON.stringify(result.outputs)).not.toContain("workflow-token")
    expect(JSON.stringify(result.outputs)).not.toContain("workflow-cookie")
    expect(JSON.stringify(result.outputs)).not.toContain("workflow-api-key")
    expect(JSON.stringify(result.outputs)).not.toContain("/Users/liyang/private.txt")
  })

  it("returns failed result when workflow is missing", async () => {
    const action = createWorkflowAction({
      getWorkflowDefinition: vi.fn(async () => null),
      runWorkflowAndWait: vi.fn(),
    })

    await expect(action.execute({
      config: { workflowId: "missing", paramTemplates: {} },
      context,
    })).resolves.toMatchObject({
      status: "failed",
      error: "工作流不存在",
    })
  })
})
