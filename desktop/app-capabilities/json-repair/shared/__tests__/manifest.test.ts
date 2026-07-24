import { describe, expect, it } from "vitest"
import { jsonRepairCapabilityManifest } from "../manifest"

describe("JSON Repair capability manifest", () => {
  it("registers its capability, MCP tool, and Workflow node without a System App", () => {
    expect(jsonRepairCapabilityManifest).toEqual({
      id: "json-repair",
      app: null,
      capabilities: ["app.json_repair.text.repair"],
      mcpTools: ["app_json_repair_text_repair"],
      workflowNodes: ["json_repair_text_repair"],
      deepLinks: [],
    })
  })
})
