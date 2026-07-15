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

  it("keeps legacy single-resource static and node-output value bindings compatible", () => {
    const staticResult = buildWorkflowCallParams({
      childDefinition: child([{ name: "input_file", type: "file", default: null }]),
      paramTemplates: {},
      paramBindings: { input_file: { mode: "value", source: { type: "static", value: "/tmp/static.txt" } } },
      resolvedVariables: {},
    })
    const nodeOutputResult = buildWorkflowCallParams({
      childDefinition: child([{ name: "input_dir", type: "directory", default: null }]),
      paramTemplates: {},
      paramBindings: { input_dir: { mode: "value", source: { type: "node_output", node: "prepare" } } },
      resolvedVariables: { prepare: "/tmp/wrong-variable-value" },
      nodeOutputs: { prepare: "/tmp/generated" },
    })

    expect(staticResult).toEqual({ params: { input_file: "/tmp/static.txt" }, errors: [] })
    expect(nodeOutputResult).toEqual({ params: { input_dir: "/tmp/generated" }, errors: [] })
  })

  it("rejects static and node-output bindings for multi-resource params", () => {
    for (const source of [
      { type: "static" as const, value: "/tmp/input.txt" },
      { type: "node_output" as const, node: "prepare" },
    ]) {
      const result = buildWorkflowCallParams({
        childDefinition: child([{ name: "input_files", type: "file", default: null, allowMultiple: true }]),
        paramTemplates: {},
        paramBindings: { input_files: { mode: "value", source } },
        resolvedVariables: { prepare: "/tmp/input.txt" },
      })

      expect(result.params).toEqual({})
      expect(result.errors[0]).toContain(`不能绑定 ${source.type} 字符串来源`)
    }
  })

  it("rejects templates for multi-resource params before the child run", () => {
    const result = buildWorkflowCallParams({
      childDefinition: child([{ name: "input_files", type: "file", default: null, allowMultiple: true }]),
      paramTemplates: { input_files: "{{generated_files}}" },
      resolvedVariables: { generated_files: '["/tmp/a.txt","/tmp/b.txt"]' },
    })

    expect(result.params).toEqual({})
    expect(result.errors).toEqual([
      "子工作流多选资源参数「input_files」不能使用模板传值，必须直接绑定类型和多选设置一致的父工作流参数",
    ])
  })

  it("keeps legacy templates compatible for single-resource params", () => {
    const result = buildWorkflowCallParams({
      childDefinition: child([{ name: "input_file", type: "file", default: null }]),
      paramTemplates: { input_file: "{{generated_file}}" },
      resolvedVariables: { generated_file: "/tmp/input.txt" },
    })

    expect(result).toEqual({ params: { input_file: "/tmp/input.txt" }, errors: [] })
  })

  it("rejects direct resource bindings when parent and child cardinality differ", () => {
    const result = buildWorkflowCallParams({
      childDefinition: child([{ name: "input_files", type: "file", default: null, allowMultiple: true }]),
      paramTemplates: {},
      paramBindings: { input_files: { mode: "value", source: { type: "param", param: "input_file" } } },
      parentParamDefinitions: [{ name: "input_file", type: "file", default: null }],
      parentParamValues: { input_file: { kind: "local_path", entryType: "file", path: "/tmp/input.txt" } },
      resolvedVariables: {},
    })

    expect(result.params).toEqual({})
    expect(result.errors).toEqual([
      "子工作流参数「input_files」与父工作流参数「input_file」的资源类型或多选设置不一致",
    ])
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
