import { describe, expect, it } from "vitest"
import type { ValidationError, WorkflowDefinition } from "@/types/workflow"
import { buildWorkflowValidationDisplayItems } from "../validation-display"

describe("buildWorkflowValidationDisplayItems", () => {
  it("converts raw Zod issue arrays into friendly copy", () => {
    const errors: ValidationError[] = [{
      type: "invalid_config",
      nodeId: "prompt-1",
      message: JSON.stringify([
        {
          code: "invalid_type",
          expected: "string",
          received: "undefined",
          path: ["projectId"],
          message: "Required",
        },
      ]),
    }]

    const items = buildWorkflowValidationDisplayItems(definition(), errors)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: "node:prompt-1:0",
      summary: "请选择项目，或设置工作流默认项目。",
      location: "提示词节点",
      nodeId: "prompt-1",
      fieldKey: "projectId",
      type: "invalid_config",
    })
    expect(items[0].summary).not.toContain("invalid_type")
    expect(items[0].summary).not.toContain("projectId")
    expect(items[0].summary).not.toContain("[")
  })

  it("keeps branch and workflow-level validation copy concise", () => {
    const errors: ValidationError[] = [
      {
        type: "invalid_switch_edge",
        nodeId: "switch-1",
        message: "Switch 节点「判断」的分支「兜底」没有连接到下游节点",
      },
      {
        type: "missing_end_node",
        message: "工作流必须包含一个结束节点",
      },
    ]

    const items = buildWorkflowValidationDisplayItems(definition(), errors)

    expect(items[0]).toMatchObject({
      summary: "分支“兜底”需要连接到下游节点。",
      location: "判断",
      nodeId: "switch-1",
    })
    expect(items[1]).toMatchObject({
      summary: "工作流需要一个结束节点。",
      location: "工作流",
    })
    expect(items[1]).not.toHaveProperty("nodeId")
  })

  it("shows disconnected node errors with a blocking summary", () => {
    const errors: ValidationError[] = [{
      type: "disconnected_node",
      nodeId: "prompt-1",
      message: '节点 "提示词节点" 未连接',
    }]

    const items = buildWorkflowValidationDisplayItems(definition(), errors)

    expect(items[0]).toMatchObject({
      summary: "节点未连接，无法运行。",
      location: "提示词节点",
      nodeId: "prompt-1",
      type: "disconnected_node",
    })
  })

  it("maps Code X advanced config paths to field errors", () => {
    const errors: ValidationError[] = [{
      type: "invalid_config",
      nodeId: "prompt-1",
      message: JSON.stringify([
        {
          code: "custom",
          path: ["configOverrides", 1, "key"],
          message: "配置覆盖项 key 不能重复",
        },
      ]),
    }]

    const items = buildWorkflowValidationDisplayItems(definition(), errors)

    expect(items[0]).toMatchObject({
      summary: "配置覆盖项 key 不能重复或为空。",
      fieldKey: "configOverrides",
      type: "invalid_config",
    })
    expect(items[0].summary).not.toContain("[")
  })

  it("maps document template config paths to field errors", () => {
    const errors: ValidationError[] = [{
      type: "invalid_config",
      nodeId: "doc-1",
      message: JSON.stringify([
        {
          code: "too_small",
          path: ["templatePath"],
          message: "模板文件必填",
        },
      ]),
    }]

    const items = buildWorkflowValidationDisplayItems(definition(), errors)

    expect(items[0]).toMatchObject({
      summary: "模板文件不能为空。",
      fieldKey: "templatePath",
      location: "模板生成文档",
      type: "invalid_config",
    })
  })
})

function definition(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Demo",
    version: "v1",
    createdAt: 0,
    updatedAt: 0,
    layoutDirection: "horizontal" as const,
    params: [],
    nodes: [
      {
        id: "prompt-1",
        name: "提示词节点",
        type: "prompt",
        position: { x: 0, y: 0 },
        config: { variables: [], prompt: "" },
      },
      {
        id: "doc-1",
        name: "模板生成文档",
        type: "document_template_docx_generate",
        position: { x: 200, y: 0 },
        config: { variables: [], templatePath: "", outputPath: "", dataSource: "dataPath", dataPath: "", overwrite: false },
      },
      {
        id: "switch-1",
        name: "判断",
        type: "switch",
        position: { x: 100, y: 0 },
        config: { variables: [], prompt: "", branches: [{ id: "fallback", label: "兜底" }] },
      },
    ],
    edges: [],
  }
}
