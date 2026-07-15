import { describe, expect, it, vi } from "vitest"

vi.mock("../../../electron/services/log-store", () => ({
  createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { workflowCallNodeExecutor } from "../executor.main"
import type { NodeExecutionInput, NodeRuntimeDeps } from "../../types"
import type { WorkflowCallNodeConfig } from "../schema"
import type { WorkflowDefinition, WorkflowRunResult } from "../../../src/types/workflow"

const childDefinition: WorkflowDefinition = {
  id: "child-1",
  name: "子工作流",
  version: "v-child",
  createdAt: 0,
  updatedAt: 0,
  defaultProjectId: "child-project",
  params: [{ name: "topic", type: "text", default: null }],
  nodes: [],
  edges: [],
}

function makeResult(status: WorkflowRunResult["status"], output = "child end output"): WorkflowRunResult {
  return { status, output, nodeResults: {}, durationMs: 12 }
}

function makeInput(config: Partial<WorkflowCallNodeConfig>, runtimeDeps?: NodeRuntimeDeps): NodeExecutionInput<WorkflowCallNodeConfig> {
  return {
    config: {
      workflowId: "child-1",
      variables: [],
      paramTemplates: { topic: "请总结 {{topic}}" },
      paramBindings: {},
      ...config,
    },
    resolvedVariables: { topic: "搜索结果" },
    paramValues: {},
    context: {
      workflowId: "parent-1",
      workflowName: "父工作流",
      runId: "parent-run",
      nodeId: "call-1",
      nodeName: "调用子流程",
      projectId: "parent-project",
      abortSignal: new AbortController().signal,
      actor: { kind: "user", id: "automation", display: "Automation" },
      automationId: "auto-1",
      automationRunId: "auto-run-1",
      workflowCallStack: [{ workflowId: "parent-1", workflowName: "父工作流" }],
    },
    agentDeps: { sendToAgent: vi.fn() },
    runtimeDeps,
  }
}

function deps(result: WorkflowRunResult = makeResult("completed")): NodeRuntimeDeps {
  return {
    processRunner: { run: vi.fn() },
    sendHttpRequest: vi.fn(),
    workflowCall: {
      getWorkflowDefinition: vi.fn().mockResolvedValue(childDefinition),
      runWorkflow: vi.fn().mockResolvedValue({ runId: "child-run", result }),
    },
  }
}

describe("workflowCallNodeExecutor", () => {
  it("fails when runtime dependency is missing", async () => {
    const result = await workflowCallNodeExecutor.execute(makeInput({}, undefined))
    expect(result.status).toBe("failed")
    expect(result.error).toBe("调用工作流能力不可用")
  })

  it("builds child params and returns child End output", async () => {
    const runtimeDeps = deps()
    const result = await workflowCallNodeExecutor.execute(makeInput({}, runtimeDeps))

    expect(result.status).toBe("success")
    expect(result.output).toBe("child end output")
    expect(result.outputs).toMatchObject({
      childWorkflowId: "child-1",
      childWorkflowName: "子工作流",
      childRunId: "child-run",
      childStatus: "completed",
    })
    expect(runtimeDeps.workflowCall?.runWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      definition: childDefinition,
      params: { topic: "请总结 搜索结果" },
      projectId: "child-project",
      actor: { kind: "user", id: "automation", display: "Automation" },
      automationId: "auto-1",
      automationRunId: "auto-run-1",
      parentWorkflowId: "parent-1",
      parentRunId: "parent-run",
      parentNodeId: "call-1",
      callStack: [
        { workflowId: "parent-1", workflowName: "父工作流" },
        { workflowId: "child-1", workflowName: "子工作流" },
      ],
    }))
  })

  it("passes typed resource params to the child workflow", async () => {
    const resource = { kind: "local_path" as const, entryType: "file" as const, path: "/tmp/input.txt" }
    const runtimeDeps = deps()
    const input = makeInput({
      paramTemplates: {},
      paramBindings: { input_file: { mode: "value", source: { type: "param", param: "input_file" } } },
    }, runtimeDeps)
    input.paramValues = { input_file: resource }
    vi.mocked(runtimeDeps.workflowCall!.getWorkflowDefinition).mockResolvedValue({
      ...childDefinition,
      params: [{ name: "input_file", type: "file", default: null }],
    })

    const result = await workflowCallNodeExecutor.execute(input)

    expect(result.status).toBe("success")
    expect(runtimeDeps.workflowCall?.runWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      params: { input_file: resource },
    }))
  })

  it("keeps legacy single-resource template params compatible", async () => {
    const runtimeDeps = deps()
    vi.mocked(runtimeDeps.workflowCall!.getWorkflowDefinition).mockResolvedValue({
      ...childDefinition,
      params: [{ name: "input_file", type: "file", default: null }],
    })

    const result = await workflowCallNodeExecutor.execute(makeInput({
      paramTemplates: { input_file: "{{topic}}" },
    }, runtimeDeps))

    expect(result.status).toBe("success")
    expect(runtimeDeps.workflowCall?.runWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      params: { input_file: "搜索结果" },
    }))
  })

  it("rejects multi-resource templates before starting the child workflow", async () => {
    const runtimeDeps = deps()
    vi.mocked(runtimeDeps.workflowCall!.getWorkflowDefinition).mockResolvedValue({
      ...childDefinition,
      params: [{ name: "input_files", type: "file", default: null, allowMultiple: true }],
    })

    const result = await workflowCallNodeExecutor.execute(makeInput({
      paramTemplates: { input_files: "{{topic}}" },
    }, runtimeDeps))

    expect(result.status).toBe("failed")
    expect(result.error).toContain("多选资源参数「input_files」不能使用模板传值")
    expect(runtimeDeps.workflowCall?.runWorkflow).not.toHaveBeenCalled()
  })

  it("inherits parent project when child has no default project", async () => {
    const runtimeDeps = deps()
    vi.mocked(runtimeDeps.workflowCall!.getWorkflowDefinition).mockResolvedValue({
      ...childDefinition,
      defaultProjectId: undefined,
    })

    await workflowCallNodeExecutor.execute(makeInput({}, runtimeDeps))

    expect(runtimeDeps.workflowCall?.runWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "parent-project",
    }))
  })

  it("fails when child workflow is missing", async () => {
    const runtimeDeps = deps()
    vi.mocked(runtimeDeps.workflowCall!.getWorkflowDefinition).mockResolvedValue(null)

    const result = await workflowCallNodeExecutor.execute(makeInput({}, runtimeDeps))

    expect(result.status).toBe("failed")
    expect(result.error).toBe("子工作流不存在")
  })

  it("fails on indirect recursion", async () => {
    const runtimeDeps = deps()
    const result = await workflowCallNodeExecutor.execute(makeInput({}, {
      ...runtimeDeps,
      workflowCall: {
        ...runtimeDeps.workflowCall!,
        getWorkflowDefinition: vi.fn().mockResolvedValue({ ...childDefinition, id: "parent-1", name: "父工作流" }),
      },
    }))

    expect(result.status).toBe("failed")
    expect(result.error).toBe("调用链包含循环：父工作流 -> 父工作流")
  })

  it("fails when nesting depth exceeds five workflows", async () => {
    const runtimeDeps = deps()
    const result = await workflowCallNodeExecutor.execute(makeInput({}, runtimeDeps))
    expect(result.status).toBe("success")

    const deepInput = makeInput({}, runtimeDeps)
    deepInput.context.workflowCallStack = [
      { workflowId: "wf-1", workflowName: "1" },
      { workflowId: "wf-2", workflowName: "2" },
      { workflowId: "wf-3", workflowName: "3" },
      { workflowId: "wf-4", workflowName: "4" },
      { workflowId: "wf-5", workflowName: "5" },
    ]
    const deepResult = await workflowCallNodeExecutor.execute(deepInput)
    expect(deepResult.status).toBe("failed")
    expect(deepResult.error).toBe("工作流嵌套层级超过 5")
  })

  it("maps failed child workflow to failed node", async () => {
    const childResult: WorkflowRunResult = {
      status: "failed",
      output: "",
      durationMs: 12,
      nodeResults: {
        "call-cycle": {
          nodeId: "call-cycle",
          status: "failed",
          input: { variables: {} },
          error: "调用链包含循环：A -> B -> A",
        },
      },
    }
    const result = await workflowCallNodeExecutor.execute(makeInput({}, deps(childResult)))
    expect(result.status).toBe("failed")
    expect(result.error).toBe("子工作流执行失败：调用链包含循环：A -> B -> A")
  })

  it("surfaces failed child workflow run errors", async () => {
    const childResult = {
      status: "failed",
      output: "",
      durationMs: 12,
      nodeResults: {},
      error: "参数「report_type」必须是预设选项之一",
    } as WorkflowRunResult & { error: string }

    const result = await workflowCallNodeExecutor.execute(makeInput({}, deps(childResult)))

    expect(result.status).toBe("failed")
    expect(result.error).toBe("子工作流执行失败：参数「report_type」必须是预设选项之一")
  })
})
