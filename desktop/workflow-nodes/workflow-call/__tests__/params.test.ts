import { describe, expect, it, vi } from "vitest"
import type { WorkflowDefinition } from "../../../src/types/workflow"

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => "/tmp" } }))

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

  it("reports blank required number params", () => {
    const result = buildWorkflowCallParams({
      childDefinition: child([{ name: "limit", type: "number", default: null }]),
      paramTemplates: { limit: "{{empty_limit}}" },
      resolvedVariables: { empty_limit: "   " },
    })

    expect(result.params).toEqual({})
    expect(result.errors).toEqual(["子工作流参数「limit」缺少必填值"])
  })

  it("renders option params from templates as strings", () => {
    const result = buildWorkflowCallParams({
      childDefinition: child([
        { name: "report_type", type: "option", default: null, options: ["日报", "周报"], allowCustomOption: false },
      ]),
      paramTemplates: { report_type: "{{kind}}" },
      resolvedVariables: { kind: "周报" },
    })

    expect(result.params).toEqual({ report_type: "周报" })
    expect(result.errors).toEqual([])
  })

  it("reports blank required option params as missing values", () => {
    const result = buildWorkflowCallParams({
      childDefinition: child([
        { name: "report_type", type: "option", default: null, options: ["日报", "周报"], allowCustomOption: false },
      ]),
      paramTemplates: { report_type: "{{kind}}" },
      resolvedVariables: { kind: "   " },
    })

    expect(result.params).toEqual({})
    expect(result.errors).toEqual(["子工作流参数「report_type」缺少必填值"])
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

  it("forwards resource params through value bindings", () => {
    const resource = { kind: "local_path" as const, entryType: "file" as const, path: "/tmp/input.txt" }
    const result = buildWorkflowCallParams({
      childDefinition: child([{ name: "input_file", type: "file", default: null }]),
      paramTemplates: {},
      paramBindings: { input_file: { mode: "value", source: { type: "param", param: "input_file" } } },
      parentParamValues: { input_file: resource },
      resolvedVariables: { input_file: "/tmp/input.txt" },
    })

    expect(result.params.input_file).toEqual(resource)
    expect(result.errors).toEqual([])
  })

  it("rejects duplicate template and binding mappings for the same child param", () => {
    const result = buildWorkflowCallParams({
      childDefinition: child([{ name: "topic", type: "text", default: null }]),
      paramTemplates: { topic: "{{topic}}" },
      paramBindings: { topic: { mode: "template", template: "{{topic}}" } },
      parentParamValues: {},
      resolvedVariables: { topic: "hello" },
    })

    expect(result.errors[0]).toBe("子工作流参数「topic」不能同时使用 paramTemplates 和 paramBindings")
  })
})
