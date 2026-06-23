import { describe, expect, it } from "vitest"
import { workflowCallNodeConfigSchema } from "../schema"
import { workflowCallNodeManifest } from "../manifest"

describe("workflow_call node schema", () => {
  it("accepts workflow id, variables, and param templates", () => {
    const result = workflowCallNodeConfigSchema.safeParse({
      workflowId: "child-1",
      variables: [{ name: "topic", source: { type: "param", param: "topic" } }],
      paramTemplates: { topic: "请总结 {{topic}}" },
      paramBindings: {},
    })

    expect(result.success).toBe(true)
  })

  it("accepts typed param bindings", () => {
    const result = workflowCallNodeConfigSchema.safeParse({
      workflowId: "child-1",
      variables: [{ name: "input", source: { type: "param", param: "input_file" } }],
      paramTemplates: {},
      paramBindings: {
        input_file: { mode: "value", source: { type: "param", param: "input_file" } },
        topic: { mode: "template", template: "总结 {{input}}" },
      },
    })

    expect(result.success).toBe(true)
  })

  it("rejects missing workflow id", () => {
    const result = workflowCallNodeConfigSchema.safeParse({
      workflowId: "",
      variables: [],
      paramTemplates: {},
      paramBindings: {},
    })

    expect(result.success).toBe(false)
  })

  it("declares a single input and single output", () => {
    expect(workflowCallNodeManifest.type).toBe("workflow_call")
    expect(workflowCallNodeManifest.ports).toEqual({
      inputs: [{ id: "in", label: "输入" }],
      outputs: [{ id: "out", label: "输出" }],
    })
  })
})
