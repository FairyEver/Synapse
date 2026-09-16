import { describe, expect, it } from "vitest"
import { processMcpRequest } from "../../../../database/shared/mcp-rpc"
import { createSynapseToolRouterSurface } from "../../../../electron/services/agent-runtime/synapse-tool-router"
import { JSON_REPAIR_MCP_TOOL_NAME } from "../../shared/capability"

const identity = { name: "test", version: "1.0.0" }

// Reached through the production surface, so the JSON Repair contract is proven
// to survive the search/invoke indirection.
const surfaceFor = (result: unknown) => createSynapseToolRouterSurface(async () => result)

describe("JSON Repair MCP contract", () => {
  it("returns only { json } for a successful tool call", async () => {
    const response = await processMcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "invoke",
        arguments: { toolName: JSON_REPAIR_MCP_TOOL_NAME, arguments: { text: "{ok:true}" } },
      },
    }, identity, surfaceFor({
      ok: true,
      data: { json: "{\"ok\":true}" },
    }))

    expect(response).toMatchObject({
      kind: "result",
      result: {
        content: [{
          type: "text",
          text: "{\n  \"json\": \"{\\\"ok\\\":true}\"\n}",
        }],
      },
    })
    expect(JSON.stringify(response)).not.toContain("affected")
  })

  it("marks failures as errors and exposes only the shared error payload", async () => {
    const error = {
      code: "NO_JSON_FOUND",
      message: "未找到可修复的 JSON 数据。",
      retryable: false,
    }
    const response = await processMcpRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "invoke",
        arguments: { toolName: JSON_REPAIR_MCP_TOOL_NAME, arguments: { text: "no json" } },
      },
    }, identity, surfaceFor({
      ok: false,
      code: error.code,
      error: error.message,
      data: error,
    }))

    expect(response).toMatchObject({
      kind: "result",
      result: {
        isError: true,
        content: [{
          type: "text",
          text: JSON.stringify(error, null, 2),
        }],
      },
    })
  })
})
