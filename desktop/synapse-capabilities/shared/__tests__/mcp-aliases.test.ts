import { describe, expect, it } from "vitest"

import { withPrimaryAndLegacyMcpTools } from "../mcp-aliases"
import type { McpToolDefinition } from "../types"

describe("withPrimaryAndLegacyMcpTools", () => {
  it("rewrites MCP tool references without rewriting domain identifiers", () => {
    const tools: McpToolDefinition[] = [{
      name: "workflow_node_type_describe",
      description: "Call workflow_node_type_describe for workflow_call, not app_workflow_call.",
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

    const [primaryTool] = withPrimaryAndLegacyMcpTools(tools, {
      legacyPrefix: "workflow",
      primaryPrefix: "app_workflow",
    })

    expect(primaryTool.name).toBe("app_workflow_node_type_describe")
    expect(primaryTool.description).toBe(
      "Call app_workflow_node_type_describe for workflow_call, not app_workflow_call.",
    )
    expect(primaryTool.inputSchema.properties.nodeType.description).toBe("workflow_call")
  })
})
