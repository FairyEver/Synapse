import { describe, expect, it } from "vitest"
import type { WorkflowDefinition } from "../../../src/types/workflow"
import {
  buildWorkflowCallParams,
  extractWorkflowCallTemplateVariables,
} from "../params"

function child(params: WorkflowDefinition["params"]): Pick<WorkflowDefinition, "params"> {
  return { params }
}

describe("workflow call params", () => {
  it("extracts unique template variable names", () => {
    expect(extractWorkflowCallTemplateVariables("请总结 {{topic}} 给 {{$audience}}，再引用 {{topic}}")).toEqual([
      "topic",
      "audience",
    ])
  })

  it("renders text and number params from templates", () => {
    const result = buildWorkflowCallParams({
      childDefinition: child([
        { name: "topic", type: "text", default: null },
        { name: "limit", type: "number", default: null },
      ]),
      paramTemplates: {
        topic: "请总结：{{source}}",
        limit: "{{max_count}}",
      },
      resolvedVariables: {
        source: "搜索结果",
        max_count: "3",
      },
    })

    expect(result).toEqual({
      params: {
        topic: "请总结：搜索结果",
        limit: 3,
      },
      errors: [],
    })
  })

  it("uses child defaults when template is missing", () => {
    const result = buildWorkflowCallParams({
      childDefinition: child([
        { name: "topic", type: "text", default: "默认主题" },
        { name: "limit", type: "number", default: 2 },
      ]),
      paramTemplates: {},
      resolvedVariables: {},
    })

    expect(result.params).toEqual({ topic: "默认主题", limit: 2 })
    expect(result.errors).toEqual([])
  })

  it("reports missing required text params", () => {
    const result = buildWorkflowCallParams({
      childDefinition: child([{ name: "topic", type: "text", default: null }]),
      paramTemplates: {},
      resolvedVariables: {},
    })

    expect(result.params).toEqual({})
    expect(result.errors).toEqual(["子工作流参数「topic」缺少必填值"])
  })

  it("reports invalid number params", () => {
    const result = buildWorkflowCallParams({
      childDefinition: child([{ name: "limit", type: "number", default: null }]),
      paramTemplates: { limit: "{{bad_number}}" },
      resolvedVariables: { bad_number: "three" },
    })

    expect(result.params).toEqual({})
    expect(result.errors).toEqual(["子工作流参数「limit」必须是数字"])
  })

  it("reports template interpolation errors", () => {
    const result = buildWorkflowCallParams({
      childDefinition: child([{ name: "topic", type: "text", default: null }]),
      paramTemplates: { topic: "{{missing}}" },
      resolvedVariables: {},
    })

    expect(result.params).toEqual({})
    expect(result.errors[0]).toContain("子工作流参数「topic」模板变量解析失败")
  })
})
