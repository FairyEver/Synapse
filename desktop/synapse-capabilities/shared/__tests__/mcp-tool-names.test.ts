import { describe, expect, it } from "vitest"

import { withPrimaryMcpTools } from "../mcp-tool-names"
import type { McpToolDefinition } from "../types"

describe("withPrimaryMcpTools", () => {
  it("returns only primary names and rewrites tool references without rewriting domain identifiers", () => {
    const tools: McpToolDefinition[] = [{
      name: "workflow_node_type_describe",
      description: "Call workflow_node_type_describe for workflow_call, not workflow_call.",
      inputSchema: {
        type: "object",
        properties: {
          nodeType: {
            type: "string",
            description: "workflow_call",
          },
        },
      },
    }]

    const [primaryTool] = withPrimaryMcpTools(tools, {
      sourcePrefix: "workflow",
      primaryPrefix: "app_workflow",
    })

    expect(primaryTool.name).toBe("app_workflow_node_type_describe")
    expect(primaryTool.description).toBe(
      "Call app_workflow_node_type_describe for workflow_call, not workflow_call.",
    )
    expect(primaryTool.inputSchema.properties.nodeType.description).toBe("workflow_call")
    expect(withPrimaryMcpTools(tools, {
      sourcePrefix: "workflow",
      primaryPrefix: "app_workflow",
    })).toHaveLength(1)
  })
})
