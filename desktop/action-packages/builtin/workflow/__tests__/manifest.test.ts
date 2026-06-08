import { describe, expect, it } from "vitest"
import { workflowActionManifest } from "../manifest"

describe("workflow action manifest", () => {
  it("declares the workflow action contract", () => {
    expect(workflowActionManifest.id).toBe("builtin.workflow")
    expect(workflowActionManifest.title).toBe("工作流")
    expect(workflowActionManifest.permissions).toEqual(["workflow.run"])
    expect(workflowActionManifest.defaultConfig).toEqual({
      workflowId: "",
      paramTemplates: {},
    })
    expect(workflowActionManifest.configFields.map((field) => field.name)).toEqual([
      "workflowId",
      "paramTemplates",
    ])
  })

  it("marks empty workflow id as needing update", () => {
    expect(workflowActionManifest.validateStoredConfig?.({
      workflowId: "",
      paramTemplates: {},
    })).toEqual({
      status: "needs_update",
      issues: [{ field: "workflowId", message: "选择工作流" }],
    })
  })
})
