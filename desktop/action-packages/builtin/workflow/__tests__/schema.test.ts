import { describe, expect, it } from "vitest"
import {
  buildWorkflowRunParams,
  workflowActionConfigSchema,
} from "../schema"
import type { WorkflowParam } from "../../../../src/types/workflow"

const params: WorkflowParam[] = [
  { name: "topic", type: "text", default: null, description: "主题" },
  { name: "limit", type: "number", default: 10, description: "数量" },
]

describe("workflow action schema", () => {
  it("parses workflow id and parameter templates", () => {
    const parsed = workflowActionConfigSchema.parse({
      workflowId: "wf-1",
      paramTemplates: { topic: "日报 {{trigger.triggeredAt}}", limit: "5" },
    })

    expect(parsed).toEqual({
      workflowId: "wf-1",
      paramTemplates: { topic: "日报 {{trigger.triggeredAt}}", limit: "5" },
    })
  })

  it("builds workflow params from templates and workflow defaults", () => {
    const built = buildWorkflowRunParams({
      workflowParams: params,
      paramTemplates: { topic: "{{trigger.request.body.title}}", limit: "" },
      templateVariables: { "trigger.request.body.title": "发布总结" },
    })

    expect(built).toEqual({ topic: "发布总结", limit: 10 })
  })

  it("rejects missing required text params", () => {
    expect(() => buildWorkflowRunParams({
      workflowParams: params,
      paramTemplates: { topic: "", limit: "" },
      templateVariables: {},
    })).toThrow("参数「topic」不能为空")
  })

  it("rejects invalid number params after rendering", () => {
    expect(() => buildWorkflowRunParams({
      workflowParams: params,
      paramTemplates: { topic: "发布总结", limit: "{{trigger.request.body.limit}}" },
      templateVariables: { "trigger.request.body.limit": "many" },
    })).toThrow("参数「limit」必须是数字")
  })
})
